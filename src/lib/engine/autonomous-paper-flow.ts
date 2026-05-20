import { db } from '@/lib/db';
import { runMarketLoopOnce } from '@/lib/engine/market-loop';
import { normalizeTradingMode } from '@/lib/engine/mode';
import {
  runExecuteStage,
  runJudgeStage,
  runResearchStage,
  runRiskStage,
  runTriageStage,
  type PipelineStageEvent,
} from '@/lib/engine/pipeline';
import { fillAllPendingPaperOrders } from '@/lib/engine/paper-order-loop';
import { STRATEGY_SETTINGS_KEY, TRADING_CONFIG_KEY, TRADING_MODE_KEY, getEffectiveTradingConfig, setScopedConfigOverride } from '@/lib/engine/trading-settings';
import type { JobType, ResearchDepth } from '@/lib/types';

type FlowEvent = PipelineStageEvent & { marketId?: string };

export interface AutonomousPaperFlowOptions {
  maxCandidates?: number;
  researchDepth?: ResearchDepth;
  fillAfterOrder?: boolean;
  onEvent?: (event: FlowEvent) => void | Promise<void>;
}

export interface AutonomousPaperFlowResult {
  marketLoop: {
    scanned: number;
    candidatesCreated: number;
    candidatesSkipped: number;
    jobsCreated: number;
    mode: string;
  };
  attempts: Array<{
    marketId: string;
    title: string;
    triageStatus?: string;
    riskAction?: string | null;
    orderId?: string | null;
    error?: string;
  }>;
  order: {
    id: string;
    marketId: string;
    title: string;
    venue: string;
    marketDataSource: string;
    executionMode: string;
    lifecycleStatus: string;
    fillModel: string | null;
    side: string;
    price: number;
    size: number;
    paperBetStatus: string | null;
    decisionAction: string | null;
  };
  fillResult: Awaited<ReturnType<typeof fillAllPendingPaperOrders>> | null;
}

interface CandidatePick {
  marketId: string;
  candidateId: string | null;
  title: string;
}

const AUTONOMOUS_STRATEGY_OVERRIDES = {
  enabledVenues: ['POLYMARKET', 'KALSHI'],
  stageRouting: {
    triageModel: 'frontier_flash',
    bullModel: 'frontier_flash',
    bearModel: 'frontier_flash',
    contradictionModel: 'frontier_flash',
    judgeModel: 'frontier_flash',
    // deerflowModel removed — DeerFlow disabled
    newsAnalystModel: 'frontier_flash',
    sentimentAnalystModel: 'frontier_flash',
    technicalAnalystModel: 'frontier_flash',
    analystDeepThinkLlm: 'frontier_flash',
    analystQuickThinkLlm: 'frontier_flash',
    researchDepth: 'STANDARD',
  },
} as const;

function parsePayload(payload: string | null): Record<string, unknown> {
  if (!payload) return {};
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function containsFallbackContext(researchContext: string): boolean {
  const normalized = researchContext.trim();
  if (!normalized) return true;
  if (normalized.includes('FALLBACK_CONTEXT')) return true;
  const nonFailedLines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('FAILED:') && !line.includes('FAILED:'));
  return nonFailedLines.length === 0;
}

async function assertPaperMode(): Promise<void> {
  const [strategySetting, tradingConfigSetting, tradingModeSetting] = await Promise.all([
    db.settings.findUnique({ where: { key: STRATEGY_SETTINGS_KEY } }),
    db.settings.findUnique({ where: { key: TRADING_CONFIG_KEY } }),
    db.settings.findUnique({ where: { key: TRADING_MODE_KEY } }),
  ]);

  const config = getEffectiveTradingConfig({
    strategySettings: strategySetting ? JSON.parse(strategySetting.value) : null,
    tradingConfig: tradingConfigSetting ? JSON.parse(tradingConfigSetting.value) : null,
    tradingMode: tradingModeSetting?.value ?? null,
  });
  const mode = normalizeTradingMode(config.mode);

  if (mode !== 'PAPER' || config.dataSource !== 'REAL' || config.executionMode !== 'SIMULATED') {
    throw new Error(`Autonomous paper flow requires PAPER/REAL/SIMULATED, got ${mode}/${config.dataSource}/${config.executionMode}`);
  }
}

async function withAutonomousStrategySettings<T>(task: () => Promise<T>): Promise<T> {
  const overrides = {
    ...AUTONOMOUS_STRATEGY_OVERRIDES,
    stageRouting: {
      ...AUTONOMOUS_STRATEGY_OVERRIDES.stageRouting,
    },
  };
  
  setScopedConfigOverride(overrides);

  try {
    return await task();
  } finally {
    setScopedConfigOverride(null);
  }
}

async function loadCandidatePicks(startedAt: Date, limit: number): Promise<CandidatePick[]> {
  const jobTypes: JobType[] = ['TRIAGE_MARKET', 'STANDARD_RESEARCH', 'DEEP_RESEARCH'];
  const jobs = await db.job.findMany({
    where: {
      type: { in: jobTypes },
      createdAt: { gte: startedAt },
      status: { in: ['PENDING', 'RETRYING'] },
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    take: Math.max(limit * 4, limit),
  });

  const seen = new Set<string>();
  const picks: CandidatePick[] = [];

  for (const job of jobs) {
    const payload = parsePayload(job.payload);
    const marketId = typeof payload.marketId === 'string' ? payload.marketId : null;
    if (!marketId || seen.has(marketId)) continue;

    const market = await db.market.findUnique({
      where: { id: marketId },
      include: { snapshots: { take: 1, orderBy: { timestamp: 'desc' } } },
    });
    if (!market) continue;
    if (market.dataSource !== 'REAL' || market.status !== 'ACTIVE') continue;
    if (/test/i.test(market.title)) continue;
    if (market.latestPrice == null && market.snapshots.length === 0) continue;

    const candidate = await db.tradeCandidate.findFirst({
      where: { marketId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    seen.add(marketId);
    picks.push({
      marketId,
      candidateId: candidate?.id ?? null,
      title: market.title,
    });
    if (picks.length >= limit) break;
  }

  if (picks.length >= limit) return picks;

  const candidates = await db.tradeCandidate.findMany({
    where: {
      market: {
        dataSource: 'REAL',
        status: 'ACTIVE',
        OR: [
          { latestPrice: { not: null } },
          { snapshots: { some: {} } },
        ],
        NOT: [{ title: { contains: 'Test' } }],
      },
    },
    orderBy: [{ candidateScore: 'desc' }, { createdAt: 'asc' }],
    take: Math.max(limit - picks.length, 0),
    include: { market: true },
  });

  picks.push(...candidates
    .filter((candidate) => !seen.has(candidate.marketId))
    .map((candidate) => ({
    marketId: candidate.marketId,
    candidateId: candidate.id,
    title: candidate.market.title,
  })));

  return picks.slice(0, limit);
}

async function loadOrderProof(orderId: string): Promise<AutonomousPaperFlowResult['order']> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { market: true, paperBet: { include: { decision: true } } },
  });
  if (!order) throw new Error(`Order disappeared after execute stage: ${orderId}`);
  if (order.market.dataSource !== 'REAL') throw new Error(`Order ${orderId} is not backed by REAL market data`);
  if (order.executionMode !== 'SIMULATED') throw new Error(`Order ${orderId} is not SIMULATED execution`);
  if (order.paperBet?.decision.action !== 'BID') throw new Error(`Order ${orderId} is not linked to BID decision`);
  if (!order.paperBet || order.paperBet.predictionType !== 'BID') throw new Error(`Order ${orderId} is not linked to BID paper bet`);

  return {
    id: order.id,
    marketId: order.marketId,
    title: order.market.title,
    venue: order.market.venue,
    marketDataSource: order.market.dataSource,
    executionMode: order.executionMode,
    lifecycleStatus: order.lifecycleStatus,
    fillModel: order.fillModel,
    side: order.side,
    price: order.price,
    size: order.size,
    paperBetStatus: order.paperBet.executionStatus,
    decisionAction: order.paperBet.decision.action,
  };
}

export async function runAutonomousPaperFlowUntilOrder(
  options: AutonomousPaperFlowOptions = {},
): Promise<AutonomousPaperFlowResult> {
  return withAutonomousStrategySettings(async () => {
    await assertPaperMode();

    const startedAt = new Date();
    const maxCandidates = Math.max(1, options.maxCandidates ?? 8);
    const researchDepth = options.researchDepth ?? 'STANDARD';
    const fillAfterOrder = options.fillAfterOrder ?? true;
    const attempts: AutonomousPaperFlowResult['attempts'] = [];
    const emit = async (event: FlowEvent) => options.onEvent?.(event);

    const loopResult = await runMarketLoopOnce();
    const marketLoop = {
      scanned: loopResult.scanned,
      candidatesCreated: loopResult.candidatesCreated,
      candidatesSkipped: loopResult.candidatesSkipped,
      jobsCreated: loopResult.jobsCreated,
      mode: loopResult.mode,
    };
    if (marketLoop.mode !== 'PAPER') {
      throw new Error(`Market loop did not run in PAPER mode: ${marketLoop.mode}`);
    }
    const picks = await loadCandidatePicks(startedAt, maxCandidates);
    if (picks.length === 0) {
      throw new Error(
        `No REAL POLYMARKET candidate with stored snapshot selected after scan: scanned=${marketLoop.scanned}, candidatesCreated=${marketLoop.candidatesCreated}, candidatesSkipped=${marketLoop.candidatesSkipped}`,
      );
    }

    for (const pick of picks) {
      const attempt: AutonomousPaperFlowResult['attempts'][number] = {
        marketId: pick.marketId,
        title: pick.title,
      };
      attempts.push(attempt);

      try {
        await emit({ stage: 'TRIAGE', marketId: pick.marketId, message: `Triaging ${pick.title}` });
        const triage = await runTriageStage(pick.marketId, { onStage: (event) => emit({ ...event, marketId: pick.marketId }) });
        attempt.triageStatus = triage.triageStatus;
        if (triage.triageResult.reason?.includes('defaulting to RELEVANT')) {
          throw new Error(`Triage fallback forbidden: ${triage.triageResult.reason}`);
        }
        if (!triage.worthResearch) {
          throw new Error(`Triage rejected market: ${triage.triageStatus}`);
        }

        await emit({ stage: 'TRADINGAGENTS', marketId: pick.marketId, message: `Researching ${pick.title}` });
        const research = await runResearchStage(pick.marketId, researchDepth, { onStage: (event) => emit({ ...event, marketId: pick.marketId }) });
        if (containsFallbackContext(research.researchContext)) {
          throw new Error('Research produced fallback/failed-only context; refusing synthetic analysis');
        }

        await emit({ stage: 'JUDGE', marketId: pick.marketId, message: `Judging ${pick.title}` });
        const judge = await runJudgeStage(
          pick.marketId,
          research.researchRunId,
          research.researchContext,
          research.depth,
          { onStage: (event) => emit({ ...event, marketId: pick.marketId }) },
        );
        if (!judge.debateResult) {
          throw new Error('Judge stage produced no debate result; refusing fallback probability');
        }

        await emit({ stage: 'RISK', marketId: pick.marketId, message: `Risk checking ${pick.title}` });
        const risk = await runRiskStage(
          pick.marketId,
          judge.judgeProbability,
          judge.judgeConfidence,
          judge.judgeUncertainty,
          judge.ensembleUncertaintyBoost,
          judge.modelDisagreement,
          judge.disagreementLevel,
          { onStage: (event) => emit({ ...event, marketId: pick.marketId }) },
        );
        attempt.riskAction = risk.riskAction;
        if (risk.riskAction !== 'BID') {
          throw new Error(`Risk action was ${risk.riskAction}; no paper BID order allowed`);
        }

        await emit({ stage: 'DECISION', marketId: pick.marketId, message: `Executing paper BID for ${pick.title}` });
        const executed = await runExecuteStage(
          pick.marketId,
          risk.decisionId,
          risk.gatedRiskResult,
          risk.aPlusGatePassed,
          judge.judgeProbability,
          judge.judgeConfidence,
          judge.judgeUncertainty,
          { onStage: (event) => emit({ ...event, marketId: pick.marketId }) },
        );
        attempt.orderId = executed.orderId;
        if (!executed.orderId) {
          throw new Error('Execute stage returned no orderId');
        }

        const fillResult = fillAfterOrder ? await fillAllPendingPaperOrders() : null;
        const order = await loadOrderProof(executed.orderId);
        return { marketLoop, attempts, order, fillResult };
      } catch (error) {
        attempt.error = error instanceof Error ? error.message : String(error);
        await emit({
          stage: 'DECISION',
          type: 'failed',
          marketId: pick.marketId,
          message: attempt.error,
          provider: 'system',
          serviceName: 'autonomous-paper-flow',
          failureReason: attempt.error,
        });
      }
    }

    throw new Error(`No paper BID order placed after ${attempts.length} real candidates: ${attempts.map((a) => `${a.marketId}:${a.error}`).join(' | ')}`);
  });
}
