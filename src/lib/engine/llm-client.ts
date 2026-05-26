import { db } from '@/lib/db';

export interface LLMCallOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  timeoutMs?: number;
  maxRetries?: number;
}

export interface LLMCallResult {
  content: string;
  parsedJson: Record<string, unknown> | null;
  model: string;
  tokenCount: number;
  latencyMs: number;
  provider: string;
}

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function parseStreamingChatCompletion(text: string): { content: string; tokenCount: number } | null {
  if (!text.includes('data:')) return null;

  let content = '';
  let tokenCount = 0;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;

    const payload = trimmed.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') continue;

    try {
      const chunk = JSON.parse(payload);
      content += chunk.choices?.[0]?.delta?.content || '';
      tokenCount = chunk.usage?.total_tokens || tokenCount;
    } catch {
      continue;
    }
  }

  return content ? { content, tokenCount } : null;
}

function isInvalidApiKey(key: string): boolean {
  if (!key || key.length < 20) return true;
  const invalidPatterns = [
    'your-api-key',
    'your-apikey',
    'change-this',
    'placeholder',
    'dummy',
    'test',
    'sk-test',
    'sk-dummy',
    'example',
  ];
  const lowerKey = key.toLowerCase();
  return invalidPatterns.some(pattern => lowerKey.includes(pattern));
}

function isPrivateOrLocalUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
    );
  } catch {
    return false;
  }
}

async function getProviderConfig(preferredModel?: string): Promise<ProviderConfig> {
  const strategySetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  const strategy = strategySetting ? JSON.parse(strategySetting.value) : {};

  const model = preferredModel || strategy.defaultModel || strategy.researchModel || 'paper_lite';

  let llmCred = await db.credential.findFirst({
    where: { service: { in: ['llm', 'LLM Provider', 'OpenAI', 'openai'] }, isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!llmCred) {
    llmCred = await db.credential.findFirst({
      where: { service: { in: ['OpenAI', 'openai'] }, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!llmCred || !llmCred.serviceUrl) {
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const apiKey = process.env.OPENAI_API_KEY || '';
    if (isInvalidApiKey(apiKey)) {
      throw new Error('Invalid or placeholder API key in environment. Please set a valid OPENAI_API_KEY in .env file');
    }
    return { baseUrl, apiKey, model };
  }

  let parsedData: Record<string, unknown> = {};
  try {
    if (llmCred.encryptedData) {
      const { isEncrypted, decrypt } = await import('@/lib/engine/crypto');
      const rawData = isEncrypted(llmCred.encryptedData) ? decrypt(llmCred.encryptedData) : llmCred.encryptedData;
      parsedData = JSON.parse(rawData);
    }
  } catch {
    try {
      if (llmCred.encryptedData) parsedData = JSON.parse(llmCred.encryptedData);
    } catch {}
  }

  const rawApiKey = String(parsedData.apiKey || '');
  const allowsNoAuth = isPrivateOrLocalUrl(llmCred.serviceUrl);
  const apiKey = rawApiKey.trim();

  if (!allowsNoAuth && isInvalidApiKey(apiKey)) {
    throw new Error('Invalid or placeholder API key in credential. Please update the LLM credential with a valid API key');
  }

  return {
    baseUrl: llmCred.serviceUrl.replace(/\/$/, ''),
    apiKey,
    model,
  };
}

export async function callLLM(options: LLMCallOptions): Promise<LLMCallResult> {
  const config = await getProviderConfig(options.model);
  const startTime = Date.now();

  const messages: Array<{ role: string; content: string }> = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: options.prompt });

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 2000,
  };

  if (options.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  const maxRetries = options.maxRetries ?? 0;
  const timeoutMs = options.timeoutMs ?? 60_000;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        lastError = new Error(`LLM API error ${response.status}: ${errorText}`);
        if (response.status === 429 || response.status >= 500) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }

      const responseText = await response.text();
      let content = '';
      let tokenCount = 0;

      // Strip reasoning_content BEFORE JSON.parse — reasoning models (DeepSeek R1, QwQ, etc.)
      // embed a long thinking block there that can contain unescaped characters and break parsing.
      const sanitized = responseText.replace(/"reasoning_content"\s*:\s*"(?:[^"\\]|\\.)*"/g, '"reasoning_content":""');

      try {
        const data = JSON.parse(sanitized);
        // Prefer actual content over reasoning trace
        content = data.choices?.[0]?.message?.content || '';
        tokenCount = data.usage?.total_tokens || 0;
      } catch {
        // sanitized regex failed (content > regex limit) — fall back to targeted extraction
        const contentMatch = responseText.match(/"content"\s*:\s*"((?:[^"\\]|\\.)*?)"\s*,\s*"role"/);
        if (contentMatch) {
          content = contentMatch[1]
            .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
            .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        }

        if (!content) {
          try {
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const data = JSON.parse(jsonMatch[0]);
              content = data.choices?.[0]?.message?.content || data.choices?.[0]?.delta?.content || '';
              tokenCount = data.usage?.total_tokens || 0;
            }
          } catch {}
        }

        if (!content) {
          const streamed = parseStreamingChatCompletion(responseText);
          if (!streamed) {
            throw new Error(`LLM response was not valid JSON or SSE chat completion: ${responseText.slice(0, 500)}`);
          }
          content = streamed.content;
          tokenCount = streamed.tokenCount;
        }
      }

      let parsedJson: Record<string, unknown> | null = null;
      if (options.responseFormat === 'json') {
        try {
          parsedJson = JSON.parse(content);
        } catch {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              parsedJson = JSON.parse(jsonMatch[0]);
            } catch {}
          }
        }
      }

      return {
        content,
        parsedJson,
        model: config.model,
        tokenCount,
        latencyMs: Date.now() - startTime,
        provider: config.baseUrl.includes('openai') ? 'openai' : config.baseUrl.includes('localhost:11434') ? 'ollama' : 'custom',
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error('LLM call failed');
}

export async function callLLMJson<T = Record<string, unknown>>(
  prompt: string,
  systemPrompt?: string,
  model?: string,
  timeoutMs?: number,
): Promise<{ data: T; meta: { model: string; tokenCount: number; latencyMs: number } }> {
  const result = await callLLM({
    prompt,
    systemPrompt,
    model,
    responseFormat: 'json',
    temperature: 0.3,
    timeoutMs: timeoutMs ?? 120_000,  // 2 min default — reasoning models need extra time
  });

  return {
    data: (result.parsedJson || {}) as T,
    meta: { model: result.model, tokenCount: result.tokenCount, latencyMs: result.latencyMs },
  };
}
