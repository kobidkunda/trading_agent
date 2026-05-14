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
import type { LiveActivityEvent, LiveMarketProgress, LivePipelineStage, Venue } from '@/lib/types';

type SimStatus = 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING';

interface LiveSimState {
  status: SimStatus;
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

const state: LiveSimState = {
  status: 'STOPPED',
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

let intervalHandle: ReturnType<typeof setTimeout> | null = null;

interface MarketTemplate {
  title: string;
  description: string;
  category: string;
  venue: Venue;
  impliedProbRange: [number, number];
  liquidityRange: [number, number];
  spreadRange: [number, number];
}

const MARKET_TEMPLATES: MarketTemplate[] = [
  { title: 'Will Bitcoin exceed $100,000 by end of 2026?', description: 'Resolves YES if BTC/USD reaches or exceeds $100,000 at any point before January 1, 2027, based on CoinGecko spot price.', category: 'crypto', venue: 'POLYMARKET', impliedProbRange: [0.35, 0.65], liquidityRange: [50000, 500000], spreadRange: [0.01, 0.03] },
  { title: 'Will the Federal Reserve cut rates at the June 2026 meeting?', description: 'Resolves YES if the Federal Open Market Committee lowers the federal funds rate at its June 2026 meeting.', category: 'economics', venue: 'KALSHI', impliedProbRange: [0.2, 0.55], liquidityRange: [30000, 200000], spreadRange: [0.015, 0.04] },
  { title: 'Will an AI model achieve human-level performance on the BAR exam by Q4 2026?', description: 'Resolves YES if any publicly available AI system scores above 90th percentile on the Multistate Bar Examination.', category: 'technology', venue: 'POLYMARKET', impliedProbRange: [0.4, 0.75], liquidityRange: [20000, 150000], spreadRange: [0.02, 0.05] },
  { title: 'Will the Lakers make the NBA playoffs in 2026?', description: 'Resolves YES if the Los Angeles Lakers qualify for the 2026 NBA Playoffs.', category: 'sports', venue: 'KALSHI', impliedProbRange: [0.3, 0.6], liquidityRange: [40000, 300000], spreadRange: [0.01, 0.03] },
  { title: 'Will a Category 5 hurricane make landfall in the US in 2026?', description: 'Resolves YES if the NHC confirms a Category 5 hurricane made landfall on the continental US.', category: 'weather', venue: 'POLYMARKET', impliedProbRange: [0.1, 0.35], liquidityRange: [10000, 80000], spreadRange: [0.02, 0.06] },
  { title: 'Will the FDA approve a new weight-loss drug class in 2026?', description: 'Resolves YES if the FDA grants approval to any drug in a novel pharmacological class for weight loss.', category: 'health', venue: 'POLYMARKET', impliedProbRange: [0.25, 0.55], liquidityRange: [15000, 120000], spreadRange: [0.015, 0.04] },
  { title: 'Will Tesla stock close above $400 by December 2026?', description: 'Resolves YES if TSLA closes at or above $400.00 on any trading day before January 1, 2027.', category: 'economics', venue: 'KALSHI', impliedProbRange: [0.15, 0.5], liquidityRange: [60000, 400000], spreadRange: [0.01, 0.025] },
  { title: 'Will a major social media platform launch a decentralized protocol by 2026?', description: 'Resolves YES if a platform with 100M+ MAU publicly launches a decentralized social protocol.', category: 'technology', venue: 'POLYMARKET', impliedProbRange: [0.2, 0.45], liquidityRange: [8000, 60000], spreadRange: [0.02, 0.05] },
  { title: 'Will there be a new COVID variant designated VOC by WHO in 2026?', description: 'Resolves YES if the WHO designates any new SARS-CoV-2 variant as a Variant of Concern.', category: 'health', venue: 'POLYMARKET', impliedProbRange: [0.15, 0.4], liquidityRange: [25000, 180000], spreadRange: [0.01, 0.035] },
  { title: 'Will Ethereum complete the Pectra upgrade successfully by Q2 2026?', description: 'Resolves YES if the Ethereum network successfully completes the Pectra upgrade without a critical consensus failure.', category: 'crypto', venue: 'POLYMARKET', impliedProbRange: [0.6, 0.85], liquidityRange: [35000, 250000], spreadRange: [0.01, 0.03] },
  { title: 'Will the US GDP growth exceed 3% in Q2 2026?', description: 'Resolves YES if the BEA reports annualized real GDP growth above 3.0% for Q2 2026.', category: 'economics', venue: 'KALSHI', impliedProbRange: [0.2, 0.5], liquidityRange: [45000, 350000], spreadRange: [0.01, 0.025] },
  { title: 'Will a team score 100+ points in a single NBA game during 2026 playoffs?', description: 'Resolves YES if any NBA team scores 100+ in a single game during the 2026 NBA Playoffs.', category: 'sports', venue: 'POLYMARKET', impliedProbRange: [0.5, 0.8], liquidityRange: [5000, 40000], spreadRange: [0.03, 0.07] },
  { title: 'Will SpaceX complete a successful Mars cargo mission by 2028?', description: 'Resolves YES if SpaceX successfully lands an uncrewed Starship on Mars by December 31, 2028.', category: 'science', venue: 'POLYMARKET', impliedProbRange: [0.05, 0.2], liquidityRange: [10000, 90000], spreadRange: [0.02, 0.06] },
  { title: 'Will an Oscar-winning film in 2026 be primarily AI-generated?', description: 'Resolves YES if any film winning an Academy Award credits AI as the primary creative tool.', category: 'entertainment', venue: 'POLYMARKET', impliedProbRange: [0.02, 0.15], liquidityRange: [5000, 50000], spreadRange: [0.03, 0.08] },
  { title: 'Will Apple release a foldable iPhone by end of 2026?', description: 'Resolves YES if Apple releases a foldable iPhone for sale before January 1, 2027.', category: 'technology', venue: 'KALSHI', impliedProbRange: [0.1, 0.3], liquidityRange: [70000, 500000], spreadRange: [0.008, 0.02] },
  { title: 'Will Solana surpass $500 by September 2026?', description: 'Resolves YES if SOL/USD reaches or exceeds $500.00 before October 1, 2026.', category: 'crypto', venue: 'POLYMARKET', impliedProbRange: [0.15, 0.4], liquidityRange: [20000, 180000], spreadRange: [0.015, 0.04] },
  { title: 'Will global temperatures set a new record high in 2026?', description: 'Resolves YES if NASA GISS reports 2026 as the highest annual global mean surface temperature on record.', category: 'science', venue: 'POLYMARKET', impliedProbRange: [0.35, 0.65], liquidityRange: [12000, 80000], spreadRange: [0.02, 0.05] },
  { title: 'Will a sitting US Senator switch parties in 2026?', description: 'Resolves YES if any currently serving US Senator changes party affiliation during 2026.', category: 'politics', venue: 'KALSHI', impliedProbRange: [0.05, 0.2], liquidityRange: [15000, 100000], spreadRange: [0.02, 0.05] },
  { title: 'Will ChatGPT reach 1 billion MAU by 2026?', description: 'Resolves YES if OpenAI announces ChatGPT reaching 1 billion monthly active users.', category: 'technology', venue: 'POLYMARKET', impliedProbRange: [0.25, 0.55], liquidityRange: [30000, 200000], spreadRange: [0.015, 0.035] },
  { title: 'Will the US unemployment rate exceed 5% in 2026?', description: 'Resolves YES if the BLS reports a seasonally adjusted unemployment rate above 5.0% for any month in 2026.', category: 'economics', venue: 'KALSHI', impliedProbRange: [0.15, 0.4], liquidityRange: [40000, 300000], spreadRange: [0.01, 0.025] },
];

function randRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function pickTemplates(venues: Venue[], categories: string[], count: number): MarketTemplate[] {
  let pool = MARKET_TEMPLATES.filter(
    (t) => (venues.length === 0 || venues.includes(t.venue)) && (categories.length === 0 || categories.includes(t.category))
  );
  if (pool.length === 0) pool = MARKET_TEMPLATES;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
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
    provider: event.provider,
    serviceName: event.serviceName,
    model: event.model,
    failureReason: event.failureReason,
    summary: event.summary,
    references: event.references,
  };
}

async function processMarket(template: MarketTemplate): Promise<void> {
  const impliedProb = Math.round(randRange(...template.impliedProbRange) * 1000) / 1000;
  const liquidity = Math.round(randRange(...template.liquidityRange));
  const spread = Math.round(randRange(...template.spreadRange) * 1000) / 1000;

  state.currentAgent = 'SCANNER';
  state.currentMarketTitle = template.title;

  console.log(`[LiveSim] Starting pipeline for: ${template.title}`);

  const market = await db.market.create({
    data: {
      externalId: `live_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      venue: template.venue,
      title: template.title,
      description: template.description,
      category: template.category,
      status: 'ACTIVE',
    },
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
      console.error(`[LiveSim] Pipeline error for ${template.title}: ${result.error}`);
    }

    if (result.triageStatus !== 'RELEVANT') {
      state.ordersSkipped++;
      recordActivity({
        marketId: market.id,
        marketTitle: market.title,
        stage: 'DECISION',
        type: 'skipped',
        message: 'Pipeline skipped market after triage',
        timestamp: new Date().toISOString(),
        provider: 'system',
      });
    } else {
      state.marketsRelevant++;
    }

    if (result.riskAction === 'BID') {
      state.ordersPlaced++;

      const latestOrder = await db.order.findFirst({
        where: { marketId: market.id },
        orderBy: { createdAt: 'desc' },
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

async function runLoop(): Promise<void> {
  if (state.status !== 'RUNNING') return;

  try {
    state.currentCycle++;

    state.currentAgent = 'RESOLUTION_CHECK';
    recordActivity({
      marketId: 'resolution-cycle',
      marketTitle: 'Resolution check',
      stage: 'RESOLUTION_CHECK',
      type: 'started',
      message: 'Checking paper bet resolutions',
      timestamp: new Date().toISOString(),
      provider: 'system',
    });

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

    const templates = pickTemplates(
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
    console.error('[LiveSim] Cycle error:', err);
  }

  if (state.status === 'RUNNING') {
    intervalHandle = setTimeout(runLoop, state.config.scanIntervalSec * 1000);
  }
}

export function getSimState(): LiveSimState {
  return { ...state };
}

export function startSimulation(config?: Partial<LiveSimState['config']>): LiveSimState {
  if (state.status === 'RUNNING') return state;

  Object.assign(state, {
    status: 'RUNNING' as SimStatus,
    startedAt: new Date().toISOString(),
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
  });

  if (config) {
    Object.assign(state.config, config);
  }

  intervalHandle = setTimeout(runLoop, 2000);

  return { ...state };
}

export function stopSimulation(): LiveSimState {
  if (state.status !== 'RUNNING') return state;

  state.status = 'STOPPING';
  state.stoppedAt = new Date().toISOString();

  if (intervalHandle) {
    clearTimeout(intervalHandle);
    intervalHandle = null;
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

export { createPipelineStageActivityEvent };
export type { LiveSimState };
