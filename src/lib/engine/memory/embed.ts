export interface EmbeddingResult {
  vector: number[];
  model: string;
  dims: number;
}

export async function getEmbedding(text: string): Promise<EmbeddingResult | null> {
  const { db } = await import('@/lib/db');
  const setting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  const strategy = setting ? JSON.parse(setting.value) : {};
  const provider = strategy.embeddingProvider || 'openai';

  if (provider === 'ollama') {
    return await getOllamaEmbedding(text, strategy.ollamaUrl);
  }
  return await getOpenAIEmbedding(text);
}

async function getOpenAIEmbedding(text: string): Promise<EmbeddingResult | null> {
  const { db } = await import('@/lib/db');
  const { isEncrypted, decrypt } = await import('@/lib/engine/crypto');

  const cred = await db.credential.findFirst({
    where: { service: { in: ['LLM Provider', 'OpenAI'] }, isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  const baseUrl = cred?.serviceUrl?.replace(/\/$/, '') || 'https://api.openai.com/v1';
  let apiKey = '';
  if (cred?.encryptedData) {
    try {
      const rawData = isEncrypted(cred.encryptedData) ? decrypt(cred.encryptedData) : cred.encryptedData;
      const parsed = JSON.parse(rawData);
      apiKey = String(parsed.apiKey || '');
    } catch {}
  }

  if (!apiKey) apiKey = process.env.OPENAI_API_KEY || '';

  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const vector: number[] = data.data?.[0]?.embedding || [];
    return { vector, model: 'text-embedding-3-small', dims: vector.length };
  } catch {
    return null;
  }
}

async function getOllamaEmbedding(text: string, ollamaUrl?: string): Promise<EmbeddingResult | null> {
  const { db } = await import('@/lib/db');
  let baseUrl = ollamaUrl;
  if (!baseUrl) {
    const cred = await db.credential.findFirst({
      where: { service: 'Ollama', isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    baseUrl = cred?.serviceUrl || 'http://localhost:11434';
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const vector: number[] = data.embedding || [];
    return { vector, model: 'nomic-embed-text', dims: vector.length };
  } catch {
    return null;
  }
}