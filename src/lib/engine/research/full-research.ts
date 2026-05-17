import { runAgentReachResearch } from './agent-reach';
import { runDeerFlowResearch } from './deerflow';
import { runTradingAgentsSimple } from './tradingagents-api';
import { canRunStage, isServiceReachable } from '@/lib/engine/health-check';
import type { StageServiceMapping } from '@/lib/types';

export interface FullResearchInput {
  marketId: string;
  marketTitle: string;
  marketDescription: string;
  impliedProbability: number;
  routing: StageServiceMapping;
  agentReachTargetSourceCount?: number;
}

export interface FullResearchResult {
  status: 'completed' | 'degraded' | 'failed';
  providers: Array<'deerflow' | 'tradingagents' | 'agent_reach'>;
  deerflow: Awaited<ReturnType<typeof runDeerFlowResearch>> | null;
  tradingagents: Awaited<ReturnType<typeof runTradingAgentsSimple>> | null;
  agentReach: Awaited<ReturnType<typeof runAgentReachResearch>> | null;
  skippedProviders: Array<{ provider: string; reason: string }>;
}

export async function runFullResearch(input: FullResearchInput): Promise<FullResearchResult> {
  const providers: Array<'deerflow' | 'tradingagents' | 'agent_reach'> = [];
  const skippedProviders: Array<{ provider: string; reason: string }> = [];

  // Health check: DeerFlow
  const deerflowHealth = await canRunStage('DEERFLOW');
  if (!deerflowHealth.canRun) {
    // Fallback: try direct connectivity check
    const fallbackUrl = process.env.DEERFLOW_URL || 'http://localhost:2026';
    const reachable = await isServiceReachable('deerflow', fallbackUrl);
    if (reachable) {
      console.warn(`[FullResearch] DeerFlow canRunStage failed but service is reachable, proceeding...`);
      providers.push('deerflow');
    } else {
      console.warn(`[FullResearch] Skipping DeerFlow: ${deerflowHealth.skipReason}`);
      skippedProviders.push({ provider: 'deerflow', reason: deerflowHealth.skipReason || 'Service unavailable' });
    }
  } else {
    providers.push('deerflow');
  }

  // Health check: TradingAgents (always required for FULL)
  const taHealth = await canRunStage('TRADINGAGENTS');
  if (!taHealth.canRun) {
    const fallbackUrl = process.env.TRADINGAGENTS_URL || 'http://localhost:6503';
    const reachable = await isServiceReachable('tradingagents', fallbackUrl);
    if (reachable) {
      console.warn(`[FullResearch] TradingAgents canRunStage failed but service is reachable, proceeding...`);
      providers.push('tradingagents');
    } else {
      console.warn(`[FullResearch] Skipping TradingAgents: ${taHealth.skipReason}`);
      skippedProviders.push({ provider: 'tradingagents', reason: taHealth.skipReason || 'Service unavailable' });
    }
  } else {
    providers.push('tradingagents');
  }

  // Health check: Agent-Reach (optional)
  if (input.routing.agentReachEnabled) {
    const arHealth = await canRunStage('AGENT_REACH');
    if (!arHealth.canRun) {
      const fallbackUrl = process.env.AGENT_REACH_URL || '';
      const reachable = await isServiceReachable('agent-reach', fallbackUrl);
      if (reachable) {
        console.warn(`[FullResearch] Agent-Reach canRunStage failed but service is reachable, proceeding...`);
        providers.push('agent_reach');
      } else {
        console.warn(`[FullResearch] Skipping Agent-Reach: ${arHealth.skipReason}`);
        skippedProviders.push({ provider: 'agent_reach', reason: arHealth.skipReason || 'Service unavailable' });
      }
    } else {
      providers.push('agent_reach');
    }
  }

  // If no providers are healthy, fail early
  if (providers.length === 0) {
    console.error('[FullResearch] No research providers are healthy. Cannot proceed.');
    return {
      status: 'failed',
      providers: [],
      deerflow: null,
      tradingagents: null,
      agentReach: null,
      skippedProviders,
    };
  }

  const deerflowPromise = providers.includes('deerflow')
    ? runDeerFlowResearch(input.marketTitle, input.marketDescription, input.impliedProbability, input.routing)
    : Promise.resolve(null);

  const tradingagentsPromise = providers.includes('tradingagents')
    ? runTradingAgentsSimple(
        input.marketTitle,
        new Date().toISOString().split('T')[0],
        input.routing.analystDeepThinkLlm,
        input.routing.analystQuickThinkLlm,
        input.routing.analystLlmProvider,
        input.routing.analystMaxDebateRounds,
      )
    : Promise.resolve(null);

  let agentReachPromise: Promise<Awaited<ReturnType<typeof runAgentReachResearch>>> = Promise.resolve(null);
  if (providers.includes('agent_reach')) {
    console.log(`[FullResearch] Agent-Reach is ENABLED, starting research...`);
    agentReachPromise = runAgentReachResearch(input.marketTitle, {
      routing: input.routing,
      targetSourceCount: input.agentReachTargetSourceCount,
    });
  } else if (input.routing.agentReachEnabled) {
    console.log(`[FullResearch] Agent-Reach enabled but health check failed, skipping...`);
  } else {
    console.log(`[FullResearch] Agent-Reach is DISABLED, skipping...`);
  }

  console.log(`[FullResearch] Starting ${providers.length} healthy research providers for: ${input.marketTitle?.substring(0, 50)}...`);
  if (skippedProviders.length > 0) {
    console.warn(`[FullResearch] Skipped providers:`, skippedProviders.map(s => `${s.provider}: ${s.reason}`).join('; '));
  }

  const [deerflow, tradingagents, agentReach] = await Promise.allSettled([
    deerflowPromise,
    tradingagentsPromise,
    agentReachPromise,
  ]);
  console.log(`[FullResearch] All providers completed`);
  console.log(`[FullResearch] DeerFlow: ${deerflow.status}${deerflow.status === 'fulfilled' && deerflow.value ? ' (has data)' : ''}`);
  console.log(`[FullResearch] TradingAgents: ${tradingagents.status}${tradingagents.status === 'fulfilled' && tradingagents.value ? ` (reddit: ${tradingagents.value?.redditReport ? 'YES' : 'NO'})` : ''}`);
  console.log(`[FullResearch] AgentReach: ${agentReach.status}`);

  const resolved = {
    deerflow: deerflow.status === 'fulfilled' ? deerflow.value : null,
    tradingagents: tradingagents.status === 'fulfilled' ? tradingagents.value : null,
    agentReach: agentReach.status === 'fulfilled' ? agentReach.value : null,
  };

  const successStates = [
    Boolean(resolved.deerflow),
    resolved.tradingagents?.status === 'completed',
    input.routing.agentReachEnabled ? resolved.agentReach?.status === 'completed' : undefined,
  ].filter((value): value is boolean => typeof value === 'boolean');
  const successCount = successStates.filter(Boolean).length;
  const expectedCount = successStates.length;

  return {
    status: successCount === 0 ? 'failed' : successCount === expectedCount ? 'completed' : 'degraded',
    providers,
    ...resolved,
    skippedProviders,
  };
}
