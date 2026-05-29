export interface EmbeddingResult {
  vector: number[];
  model: string;
  dims: number;
}

export async function getEmbedding(text: string): Promise<EmbeddingResult | null> {
  const { db } = await import('@/lib/db');
  const setting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  const strategy = setting ? JSON.parse(setting.value) : {};
  const provider = strategy.stageRouting?.embeddingProvider || strategy.embeddingProvider || 'openai';
  const selectedModel = strategy.stageRouting?.embeddingModel || strategy.embeddingModel;

  if (provider === 'ollama') {
    return await getOllamaEmbedding(text, strategy.ollamaUrl, selectedModel);
  }
  return await getOpenAIEmbedding(text, selectedModel);
}

async function getOpenAIEmbedding(text: string, modelOverride?: string): Promise<EmbeddingResult | null> {
  const { getCredentialForService } = await import('@/lib/engine/research/search');

  const credResult = await getCredentialForService('llm');
  const baseUrl = credResult?.baseUrl?.replace(/\/$/, '') || 'https://api.openai.com/v1';
  const apiKey = credResult?.apiKey || process.env.OPENAI_API_KEY || '';

  const model = modelOverride || 'text-embedding-3-small';

  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, input: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const vector: number[] = data.data?.[0]?.embedding || [];
    return { vector, model, dims: vector.length };
  } catch {
    return null;
  }
}

async function getOllamaEmbedding(text: string, ollamaUrl?: string, modelOverride?: string): Promise<EmbeddingResult | null> {
  const { getCredentialForService } = await import('@/lib/engine/research/search');

  let baseUrl = ollamaUrl;
  if (!baseUrl) {
    const credResult = await getCredentialForService('ollama');
    baseUrl = credResult?.baseUrl || 'http://localhost:11434';
  }

  const model = modelOverride || 'nomic-embed-text';

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const vector: number[] = data.embedding || [];
    return { vector, model, dims: vector.length };
  } catch {
    return null;
  }
}