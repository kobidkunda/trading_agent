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
  } catch {}
  return { ...DEFAULT_STAGE_ROUTING };
}

export function getModelForStage(stage: string, routing: StageServiceMapping, defaultModel?: string): string | undefined {
  const stageModelMap: Record<string, string | undefined> = {
    triage: routing.triageModel,
    bull: routing.bullModel,
    bear: routing.bearModel,
    contradiction: routing.contradictionModel,
    judge: routing.judgeModel,
    deerflow: routing.deerflowModel,
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
  return { baseUrl: process.env.SEARXNG_URL || 'http://localhost:8888', apiKey: '' };
}

export async function getVectorConfig(routing: StageServiceMapping): Promise<{ baseUrl: string; apiKey: string; collection: string }> {
  const cred = await getCredentialForService('qdrant');
  const baseUrl = cred?.baseUrl || 'http://localhost:6333';
  const apiKey = cred?.apiKey || '';
  const collection = routing.vectorDbCollection || 'research_memory';
  return { baseUrl, apiKey, collection };
}

export type ResearchProvider = 'deerflow' | 'firecrawl' | 'tradingagents' | 'agent_reach';

export async function resolveResearchProvider(): Promise<ResearchProvider> {
  try {
    const setting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
    let fallbackProvider: string | undefined;

    if (setting) {
      const parsed = JSON.parse(setting.value);
      fallbackProvider = parsed.stageRouting?.researchFallbackProvider;
    }

    const deerflowHealth = await checkServiceHealth('deerflow');
    if (deerflowHealth.status === 'UP') {
      return 'deerflow';
    }

    console.log('[ServiceRouting] DeerFlow is DOWN, checking fallbacks...');

    const fallbackCandidates: ResearchProvider[] = [];
    const normalizedFallback = fallbackProvider?.trim().toLowerCase().replace(/[-\s]+/g, '_');
    if (normalizedFallback === 'firecrawl') fallbackCandidates.push('firecrawl');
    if (normalizedFallback === 'tradingagents') fallbackCandidates.push('tradingagents');
    if (normalizedFallback === 'agent_reach' || normalizedFallback === 'agentreach') {
      fallbackCandidates.push('agent_reach');
    }

    for (const candidate of ['tradingagents', 'agent_reach', 'firecrawl'] as ResearchProvider[]) {
      if (!fallbackCandidates.includes(candidate)) {
        fallbackCandidates.push(candidate);
      }
    }

    for (const candidate of fallbackCandidates) {
      const health = await checkServiceHealth(candidate);
      if (health.status === 'UP') {
        console.log(`[ServiceRouting] Routing research to ${candidate} fallback`);
        return candidate;
      }
    }

    console.log('[ServiceRouting] All research providers unavailable, defaulting to deerflow');
    return 'deerflow';
  } catch (error) {
    console.log('[ServiceRouting] Error resolving research provider:', error);
    return 'deerflow';
  }
}

export async function getAvailableResearchProviders(): Promise<ResearchProvider[]> {
  const providers: ResearchProvider[] = ['deerflow', 'firecrawl', 'tradingagents', 'agent_reach'];
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
