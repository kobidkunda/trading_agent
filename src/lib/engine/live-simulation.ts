import { db } from '@/lib/db';
import {
  applyLiveActivityEventToState,
  createInitialActivityState,
} from '@/lib/engine/live-sim-events';
import {
  runPipelineForMarket,
  type PipelineStageEvent,
} from '@/lib/engine/pipeline';
import { runResolutionCycle } from '@/lib/engine/resolution-poller';
import { DEFAULT_STRATEGY } from '@/lib/engine/risk';
import { runMarketLoopOnce } from '@/lib/engine/market-loop';
import { processNextQueuedJobOnce } from '@/lib/engine/worker';
import { getEffectiveTradingConfig } from '@/lib/engine/trading-settings';
import { getModeState, normalizeTradingMode, type TradingMode } from '@/lib/engine/mode';
import { pickDemoTemplates, type DemoMarketTemplate } from '@/lib/engine/demo-mode';
import { createMarketCompat } from '@/lib/engine/prisma-runtime-compat';
import type { LiveActivityEvent, LiveMarketProgress, LivePipelineStage, Venue } from '@/lib/types';

type SimStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING';

interface LiveSimState {
  status: SimStatus;
  mode: TradingMode;
  dataSource: 'MOCK' | 'REAL';
  startedAt: string | null;
  stoppedAt: string | null;
  currentCycle: number;
  marketsScanned: number;
  marketsRelevant: number;
  ordersPlaced: number;
  ordersSkipped: number;
  totalExposure: number;
  totalEstimatedPnl: number;
  paperBetsResolved: number;
  paperBetAccuracy: number;
  lastActivity: string | null;
  currentAgent: string | null;
  currentStage: LivePipelineStage | null;
  currentStageStartedAt: string | null;
  currentMarketTitle: string | null;
  activityEvents: LiveActivityEvent[];
  marketProgress: LiveMarketProgress[];
  lastCompletedMarket: { marketId: string; marketTitle: string; completedAt: string } | null;
  error: string | null;
  config: {
    venues: Venue[];
    categories: string[];
    scanIntervalSec: number;
    marketsPerScan: number;
    maxPortfolioExposure: number;
  };
}

type LiveSimGlobal = typeof globalThis & {
  __tradingLiveSimState?: LiveSimState;
  __tradingLiveSimIntervalHandle?: ReturnType<typeof setTimeout> | null;
};

const defaultMode: TradingMode = 'PAPER';

const liveSimGlobal = globalThis as LiveSimGlobal;

const state: LiveSimState = liveSimGlobal.__tradingLiveSimState ?? {
  status: 'STOPPED',
  mode: defaultMode,
  dataSource: 'MOCK',
  startedAt: null,
  stoppedAt: null,
  currentCycle: 0,
  marketsScanned: 0,
  marketsRelevant: 0,
  ordersPlaced: 0,
  ordersSkipped: 0,
  totalExposure: 0,
  totalEstimatedPnl: 0,
  paperBetsResolved: 0,
  paperBetAccuracy: 0,
  ...createInitialActivityState(),
  currentAgent: null,
  error: null,
  config: {
    venues: DEFAULT_STRATEGY.enabledVenues as Venue[],
    categories: DEFAULT_STRATEGY.enabledCategories,
    scanIntervalSec: 120,
    marketsPerScan: 1,
    maxPortfolioExposure: 50000,
  },
};
liveSimGlobal.__tradingLiveSimState = state;

let intervalHandle: ReturnType<typeof setTimeout> | null = liveSimGlobal.__tradingLiveSimIntervalHandle ?? null;

function setSimulationTimeout(handle: ReturnType<typeof setTimeout> | null): void {
  intervalHandle = handle;
  liveSimGlobal.__tradingLiveSimIntervalHandle = handle;
}

function randRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function recordActivity(event: LiveActivityEvent): void {
  Object.assign(state, applyLiveActivityEventToState(state, event));
}

function createPipelineStageActivityEvent(
  marketId: string,
  marketTitle: string,
  event: PipelineStageEvent,
  timestamp = new Date().toISOString(),
): LiveActivityEvent {
  return {
    marketId,
    marketTitle,
    stage: event.stage,
    type: event.type ?? 'started',
    message: event.message,
    timestamp,
    provider: event.provider as any,
    serviceName: event.serviceName,
    model: event.model,
    failureReason: event.failureReason,
    summary: event.summary,
    references: event.references,
  };
}

function stageForJobType(jobType: string): LivePipelineStage {
  if (jobType.includes('TRIAGE')) return 'TRIAGE';
  if (jobType.includes('RESEARCH')) return 'WEB_SEARCH';
  if (jobType.includes('JUDGE')) return 'JUDGE';
  if (jobType.includes('RISK')) return 'RISK';
  if (jobType.includes('ORDER')) return 'DECISION';
  if (jobType.includes('SETTLE') || jobType.includes('RESOLUTION')) return 'RESOLUTION_CHECK';
  return 'SCAN';
}

async function refreshPaperExecutionMetrics(): Promise<void> {
  const [openOrders, resolvedBetCount, correctBetCount] = await Promise.all([
    db.order.findMany({
      where: {
        executionMode: 'SIMULATED',
        lifecycleStatus: { in: ['PLANNED', 'SUBMITTED', 'PARTIALLY_FILLED', 'FILLED'] },
      },
      select: {
        size: true,
        price: true,
        side: true,
      },
    }),
    db.paperBet.count({ where: { actualOutcome: { not: null } } }),
    db.paperBet.count({ where: { actualOutcome: { not: null }, directionCorrect: true } }),
  ]);

  state.ordersPlaced = openOrders.length;
  state.totalExposure = Math.round(
    openOrders.reduce((sum, order) => sum + order.size, 0) * 100,
  ) / 100;
  state.totalEstimatedPnl = Math.round(
    openOrders.reduce((sum, order) => {
      const exposureSide = order.side === 'YES' ? 1 - order.price : order.price;
      return sum + exposureSide * order.size;
    }, 0) * 100,
  ) / 100;
  state.paperBetAccuracy = resolvedBetCount > 0
    ? Math.round((correctBetCount / resolvedBetCount) * 10000) / 100
    : 0;
}

async function processMarket(template: DemoMarketTemplate): Promise<void> {
  const impliedProb = Math.round(randRange(...template.impliedProbRange) * 1000) / 1000;
  const liquidity = Math.round(randRange(...template.liquidityRange));
  const spread = Math.round(randRange(...template.spreadRange) * 1000) / 1000;

  state.currentAgent = 'SCANNER';
  state.currentMarketTitle = template.title;

  console.log(`[LiveSim] Starting DEMO pipeline for: ${template.title}`);

  const market = await createMarketCompat({
    externalId: `demo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    venue: template.venue,
    title: template.title,
    description: template.description,
    category: template.category,
    status: 'ACTIVE',
    dataSource: 'MOCK',
  });

  await db.marketSnapshot.create({
    data: {
      marketId: market.id,
      impliedProb,
      liquidity,
      spread,
      volume24h: Math.round(liquidity * randRange(0.05, 0.3)),
      bestBid: impliedProb - spread / 2,
      bestAsk: impliedProb + spread / 2,
    },
  });

  await db.tradeCandidate.create({
    data: { marketId: market.id, stage: 'SCANNED' },
  });

  const scanStartedAt = new Date().toISOString();
  recordActivity({
    marketId: market.id,
    marketTitle: market.title,
    stage: 'SCAN',
    type: 'started',
    message: 'Scanning market',
    timestamp: scanStartedAt,
    provider: 'system',
  });

  const scanProgressAt = new Date().toISOString();
  recordActivity({
    marketId: market.id,
    marketTitle: market.title,
    stage: 'SCAN',
    type: 'progress',
    message: 'Market created and queued',
    timestamp: scanProgressAt,
    provider: 'system',
  });

  state.marketsScanned++;
  state.currentAgent = 'PIPELINE';

  try {
    const result = await runPipelineForMarket(market.id, {
      onStage: async (event) => {
        recordActivity(createPipelineStageActivityEvent(market.id, market.title, event));
      },
    });

    console.log(`[LiveSim] Pipeline completed for: ${template.title} — action=${result.riskAction}, stages=${result.stages.join('→')}`);

    if (result.error) {
      state.error = result.error;
      state.ordersSkipped++;
      recordActivity({
        marketId: market.id,
        marketTitle: market.title,
        stage: 'DECISION',
        type: 'failed',
        message: result.error,
        timestamp: new Date().toISOString(),
        provider: 'system',
      });
      return;
    }

    if (result.riskAction === 'BID' && result.orderId) {
      state.ordersPlaced++;

      const latestOrder = await db.order.findFirst({
        where: { venueOrderId: result.orderId },
      });

      if (latestOrder) {
        state.totalExposure += latestOrder.size;
        if (latestOrder.side === 'YES') {
          const debateProb = result.debateResult?.finalProbability ?? impliedProb;
          state.totalEstimatedPnl += (debateProb - latestOrder.price) * latestOrder.size;
        } else {
          const debateProb = result.debateResult?.finalProbability ?? impliedProb;
          state.totalEstimatedPnl += ((1 - debateProb) - latestOrder.price) * latestOrder.size;
        }
      }

      const completedAt = new Date().toISOString();
      recordActivity({
        marketId: market.id,
        marketTitle: market.title,
        stage: 'DECISION',
        type: 'completed',
        terminal: 'completed',
        message: 'Pipeline completed successfully',
        timestamp: completedAt,
        provider: 'system',
      });
    } else if (result.triageStatus === 'RELEVANT') {
      state.ordersSkipped++;
      recordActivity({
        marketId: market.id,
        marketTitle: market.title,
        stage: 'DECISION',
        type: 'skipped',
        message: 'Pipeline completed without placing an order',
        timestamp: new Date().toISOString(),
        provider: 'system',
      });
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : 'Pipeline failed';
    console.error(`[LiveSim] Pipeline exception for ${template.title}:`, err);
    state.ordersSkipped++;
    recordActivity({
      marketId: market.id,
      marketTitle: market.title,
      stage: 'DECISION',
      type: 'failed',
      message: state.error,
      timestamp: new Date().toISOString(),
      provider: 'system',
    });
  }

  state.currentAgent = null;
  state.currentMarketTitle = null;
}

async function runDemoLoop(): Promise<void> {
  if (state.status !== 'RUNNING') return;

  try {
    state.currentCycle++;
    state.currentAgent = 'RESOLUTION_CHECK';

    try {
      const resolutionResult = await runResolutionCycle();
      if (resolutionResult.resolved > 0) {
        state.paperBetsResolved += resolutionResult.scored;
        const totalBets = await db.paperBet.count({ where: { actualOutcome: { not: null } } });
        const correctBets = await db.paperBet.count({ where: { actualOutcome: { not: null }, directionCorrect: true } });
        state.paperBetAccuracy = totalBets > 0 ? Math.round((correctBets / totalBets) * 10000) / 100 : 0;
        console.log(`[LiveSim] Resolved ${resolutionResult.resolved} markets, scored ${resolutionResult.scored} paper bets`);
      }
    } catch (e) {
      console.error('[LiveSim] Resolution poll failed:', e);
    }

    const templates = pickDemoTemplates(
      state.config.venues ?? DEFAULT_STRATEGY.enabledVenues as Venue[],
      state.config.categories ?? DEFAULT_STRATEGY.enabledCategories,
      state.config.marketsPerScan,
    );

    for (const template of templates) {
      if (state.status !== 'RUNNING') break;
      await processMarket(template);
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : 'Unknown error';
    console.error('[LiveSim] Demo cycle error:', err);
  }

  if (state.status === 'RUNNING') {
    setSimulationTimeout(setTimeout(runDemoLoop, state.config.scanIntervalSec * 1000));
  }
}

async function runPaperLoop(): Promise<void> {
  if (state.status !== 'RUNNING') return;

  try {
    state.currentCycle++;
    state.currentAgent = 'MARKET_LOOP';
    state.error = null;

    recordActivity({
      marketId: 'paper-scan-cycle',
      marketTitle: `Paper scan cycle #${state.currentCycle}`,
      stage: 'SCAN',
      type: 'started',
      message: 'Running paper market loop',
      timestamp: new Date().toISOString(),
      provider: 'system',
    });

    const marketLoopResult = await runMarketLoopOnce();
    state.marketsScanned += marketLoopResult.scanned;
    state.marketsRelevant += marketLoopResult.candidatesCreated;

    recordActivity({
      marketId: 'paper-scan-cycle',
      marketTitle: `Paper scan cycle #${state.currentCycle}`,
      stage: 'SCAN',
      type: 'completed',
      message: `Scanned ${marketLoopResult.scanned} real markets, queued ${marketLoopResult.jobsCreated} pipeline jobs`,
      timestamp: new Date().toISOString(),
      provider: 'system',
    });

    const maxJobPasses = Math.max(1, marketLoopResult.jobsCreated, state.config.marketsPerScan);
    for (let pass = 0; pass < maxJobPasses; pass++) {
      const processedJob = await processNextQueuedJobOnce();
      if (!processedJob) break;

      state.currentAgent = processedJob.jobType;
      state.lastActivity = new Date().toISOString();

      if (processedJob.marketId) {
        const market = await db.market.findUnique({
          where: { id: processedJob.marketId },
          select: { title: true },
        });

        recordActivity({
          marketId: processedJob.marketId,
          marketTitle: market?.title || processedJob.marketId,
          stage: stageForJobType(processedJob.jobType),
          type: processedJob.status === 'COMPLETED' ? 'completed' : 'failed',
          message: processedJob.status === 'COMPLETED'
            ? `${processedJob.jobType} completed`
            : `${processedJob.jobType} failed: ${processedJob.error || 'Unknown error'}`,
          timestamp: new Date().toISOString(),
          provider: 'system',
          failureReason: processedJob.error,
        });
      }

      if (processedJob.status !== 'COMPLETED') {
        state.error = processedJob.error || `${processedJob.jobType} failed`;
      }
    }

    state.currentAgent = 'RESOLUTION_CHECK';
    try {
      const resolutionResult = await runResolutionCycle();
      if (resolutionResult.resolved > 0) {
        state.paperBetsResolved += resolutionResult.scored;
      }
    } catch (e) {
      console.error('[LiveSim] Resolution poll failed:', e);
    }

    await refreshPaperExecutionMetrics();
    state.currentAgent = null;
  } catch (err) {
    state.error = err instanceof Error ? err.message : 'Unknown error';
    console.error('[LiveSim] Paper cycle error:', err);
  }

  if (state.status === 'RUNNING') {
    setSimulationTimeout(setTimeout(runPaperLoop, state.config.scanIntervalSec * 1000));
  }
}

function startEngine(): void {
  state.status = 'RUNNING';
  state.startedAt = new Date().toISOString();
  state.stoppedAt = null;
  state.currentCycle = 0;
  state.marketsScanned = 0;
  state.marketsRelevant = 0;
  state.ordersPlaced = 0;
  state.ordersSkipped = 0;
  state.totalExposure = 0;
  state.totalEstimatedPnl = 0;
  state.paperBetsResolved = 0;
  state.paperBetAccuracy = 0;
  state.error = null;
  Object.assign(state, createInitialActivityState());
  state.currentAgent = null;
  state.currentStage = null;
  state.currentStageStartedAt = null;
  state.currentMarketTitle = null;

  if (state.mode === 'DEMO') {
    console.log('[LiveSim] Starting in DEMO mode (mock templates)');
    state.dataSource = 'MOCK';
    setSimulationTimeout(setTimeout(runDemoLoop, 2000));
  } else {
    // PAPER or LIVE — use real scanner
    state.dataSource = 'REAL';
    console.log(`[LiveSim] Starting in ${state.mode} mode (real scanner)`);
    setSimulationTimeout(setTimeout(runPaperLoop, 2000));
  }
}

export function getSimState(): LiveSimState {
  return { ...state };
}

export async function startSimulation(config?: Partial<LiveSimState['config']>): Promise<LiveSimState> {
  if (state.status === 'RUNNING' || state.status === 'STARTING') return state;

  if (config) {
    Object.assign(state.config, config);
  }

  // Read current trading mode from backend settings
  try {
    const setting = await db.settings.findUnique({ where: { key: 'trading_mode' } });
    if (setting?.value) {
      state.mode = normalizeTradingMode(setting.value);
    }
  } catch {
    // Default mode stays as-is
  }

  startEngine();

  return { ...state };
}

export function stopSimulation(): LiveSimState {
  if (state.status !== 'RUNNING') return state;

  state.status = 'STOPPING';
  state.stoppedAt = new Date().toISOString();

  if (intervalHandle) {
    clearTimeout(intervalHandle);
    setSimulationTimeout(null);
  }

  state.status = 'STOPPED';
  state.currentAgent = null;
  state.currentStage = null;
  state.currentStageStartedAt = null;
  state.currentMarketTitle = null;
  state.lastActivity = new Date().toISOString();

  return { ...state };
}

export function updateConfig(config: Partial<LiveSimState['config']>): LiveSimState {
  Object.assign(state.config, config);
  return { ...state };
}

export function reloadMode(): void {
  const savedMode = normalizeTradingMode(state.mode);
  state.mode = savedMode;
  console.log(`[LiveSim] Mode reloaded: ${savedMode}`);
}

export { createPipelineStageActivityEvent };
export type { LiveSimState };
