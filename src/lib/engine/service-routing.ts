import { db } from '@/lib/db';
import { getCredentialForService } from '@/lib/engine/research/search';
import { checkServiceHealth } from '@/lib/engine/health-check';
import type { StageServiceMapping, ResearchDepth } from '@/lib/types';
import { DEFAULT_STAGE_ROUTING } from '@/lib/engine/risk';

export interface ServiceConfig {
  model?: string;
  searchBaseUrl?: string;
  searchApiKey?: string;
  vectorCollection?: string;
  embeddingProvider?: string;
}

export async function getStageRouting(): Promise<StageServiceMapping> {
  try {
    const setting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
    if (setting) {
      const parsed = JSON.parse(setting.value);
      if (parsed.stageRouting) {
        return { ...DEFAULT_STAGE_ROUTING, ...parsed.stageRouting };
      }
    }
  } catch (error) {
    throw new Error(`Failed to load stage routing: ${error instanceof Error ? error.message : String(error)}`);
  }
  return { ...DEFAULT_STAGE_ROUTING };
}

export function getModelForStage(stage: string, routing: StageServiceMapping, defaultModel?: string): string | undefined {
  const stageModelMap: Record<string, string | undefined> = {
    triage: routing.triageModel,
    bull: routing.bullModel,
    bear: routing.bearModel,
    contradiction: routing.contradictionModel,
    judge: routing.judgeModel,
    // deerflow removed — service disabled
  };
  return stageModelMap[stage] || defaultModel || undefined;
}

export function getResearchDepth(routing: StageServiceMapping): ResearchDepth {
  return routing.researchDepth || 'DEEP';
}

export async function getSearchConfig(routing: StageServiceMapping): Promise<{ baseUrl: string; apiKey: string }> {
  const customService = routing.searchService;
  if (customService) {
    const cred = await getCredentialForService(customService);
    if (cred) return cred;
  }
  const defaultCred = await getCredentialForService('searxng');
  if (defaultCred) return defaultCred;
  return {
    baseUrl: process.env.SEARXNG_URL || process.env.TA_SEARXNG_URL || process.env.SEARXNG_BASE_URL || 'http://localhost:8888',
    apiKey: '',
  };
}

export async function getVectorConfig(routing: StageServiceMapping): Promise<{ baseUrl: string; apiKey: string; collection: string }> {
  const cred = await getCredentialForService('qdrant');
  const baseUrl = cred?.baseUrl || 'http://localhost:6333';
  const apiKey = cred?.apiKey || '';
  const collection = routing.vectorDbCollection || 'research_memory';
  return { baseUrl, apiKey, collection };
}

export type ResearchProvider = 'firecrawl' | 'tradingagents' | 'agent_reach';

export async function resolveResearchProvider(): Promise<ResearchProvider> {
  // DeerFlow removed — service unreachable. Try tradingagents first.
  const taHealth = await checkServiceHealth('tradingagents');
  if (taHealth.status === 'UP') {
    return 'tradingagents';
  }
  throw new Error(`No research provider available: tradingagents=${taHealth.status}`);
}

export async function getAvailableResearchProviders(): Promise<ResearchProvider[]> {
  const providers: ResearchProvider[] = ['firecrawl', 'tradingagents', 'agent_reach'];
  const available: ResearchProvider[] = [];

  const results = await Promise.all(
    providers.map(async (p) => {
      const health = await checkServiceHealth(p);
      return { provider: p, status: health.status };
    })
  );

  for (const { provider, status } of results) {
    if (status === 'UP') {
      available.push(provider);
    }
  }

  console.log(`[ServiceRouting] Available research providers: ${available.join(', ') || 'none'}`);
  return available;
}
