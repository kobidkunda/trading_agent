import { db } from '@/lib/db';
import { getEmbedding } from './embed';
import { getVectorConfig } from '@/lib/engine/service-routing';

async function getQdrantConfig(): Promise<{ baseUrl: string; apiKey: string; collectionName: string } | null> {
  try {
    const setting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
    const strategy = setting ? JSON.parse(setting.value) : {};
    const routing = strategy.stageRouting || {};

    const vectorConfig = await getVectorConfig(routing);
    return {
      baseUrl: vectorConfig.baseUrl,
      apiKey: vectorConfig.apiKey,
      collectionName: vectorConfig.collection,
    };
  } catch {
    return null;
  }
}

async function qdrantFetch(path: string, method: string, body?: unknown): Promise<Response | null> {
  const config = await getQdrantConfig();
  if (!config) return null;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  try {
    return await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return null;
  }
}

export async function writeResearchToQdrant(
  marketId: string,
  title: string,
  researchContext: string,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const embedding = await getEmbedding(`${title}\n\n${researchContext.slice(0, 6000)}`);
  if (!embedding) return false;

  const config = await getQdrantConfig();
  if (!config) return false;

  const point = {
    id: marketId,
    vector: embedding.vector,
    payload: {
      marketId,
      title,
      text: researchContext.slice(0, 8000),
      ...metadata,
      createdAt: new Date().toISOString(),
    },
  };

  const response = await qdrantFetch(`/collections/${config.collectionName}/points`, 'PUT', {
    points: [point],
  });

  return response?.ok || false;
}

export async function retrieveSimilarMarkets(
  queryTitle: string,
  queryDescription: string,
  limit: number = 5,
): Promise<Array<{ marketId: string; title: string; score: number; payload: Record<string, unknown> }>> {
  const embedding = await getEmbedding(`${queryTitle}\n\n${queryDescription.slice(0, 3000)}`);
  if (!embedding) return [];

  const config = await getQdrantConfig();
  if (!config) return [];

  const response = await qdrantFetch(`/collections/${config.collectionName}/search`, 'POST', {
    vector: embedding.vector,
    limit,
    with_payload: true,
  });

  if (!response?.ok) return [];

  try {
    const data = await response.json();
    return (data.result || []).map((r: Record<string, unknown>) => ({
      marketId: String(r.payload?.marketId || r.id),
      title: String(r.payload?.title || ''),
      score: Number(r.score || 0),
      payload: (r.payload || {}) as Record<string, unknown>,
    }));
  } catch {
    return [];
  }
}