// ── Continuous Simulation Engine ─────────────────────────────────────────────
// Runs the trading pipeline continuously like a live system.
// Scans markets periodically, processes them through the full agent pipeline,
// and records simulated orders in the DB — the system believes trades are real.
// ──────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { computeRisk, DEFAULT_STRATEGY } from '@/lib/engine/risk';
import type { Venue, StrategySettings, JudgeOutput, RiskEngineOutput } from '@/lib/types';

// ── In-memory state ──────────────────────────────────────────────────────────

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
  lastActivity: string | null;
  currentAgent: string | null;
  currentMarketTitle: string | null;
  error: string | null;
  config: {
    venues: Venue[];
    categories: string[];
    scanIntervalSec: number;
    marketsPerScan: number;
    maxPortfolioExposure: number;
  };
}

// Global singleton state (persists across requests in the same Node.js process)
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
  lastActivity: null,
  currentAgent: null,
  currentMarketTitle: null,
  error: null,
  config: {
    venues: DEFAULT_STRATEGY.enabledVenues as Venue[],
    categories: DEFAULT_STRATEGY.enabledCategories,
    scanIntervalSec: 8,
    marketsPerScan: 3,
    maxPortfolioExposure: 50000,
  },
};

let intervalHandle: ReturnType<typeof setTimeout> | null = null;

// ── Market Templates ─────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

function randRange(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}
function randInt(min: number, max: number): number {
  return Math.floor(randRange(min, max + 1));
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function pickTemplates(venues: Venue[], categories: string[], count: number): MarketTemplate[] {
  let pool = MARKET_TEMPLATES.filter(
    (t) => (venues.length === 0 || venues.includes(t.venue)) && (categories.length === 0 || categories.includes(t.category))
  );
  if (pool.length === 0) pool = MARKET_TEMPLATES;
  // Shuffle and pick
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ── Agent simulators ─────────────────────────────────────────────────────────

function simTriage(title: string, category: string) {
  const relevant = Math.random() > 0.3;
  if (relevant) {
    return {
      status: 'RELEVANT' as const,
      reason: `Market "${title}" has clear resolution criteria and falls within ${category} — suitable for analysis`,
      worthResearch: true,
    };
  }
  return {
    status: pick(['IRRELEVANT', 'AMBIGUOUS'] as const),
    reason: `Market "${title}" has ambiguous resolution criteria or insufficient data availability`,
    worthResearch: false,
  };
}

function simBull(title: string, impliedProb: number) {
  const shift = randRange(0.02, 0.15);
  return {
    thesis: `Analysis suggests "${title}" probability is underestimated. Multiple converging signals indicate positive outcome likelihood.`,
    keyArguments: [
      `Historical base rate supports YES at ${(randRange(55, 80)).toFixed(0)}% rate`,
      `Recent developments not yet reflected in market pricing indicate positive shift`,
      `Expert consensus assigns higher probability than current market price`,
    ].slice(0, randInt(2, 4)),
    estimatedProbability: Math.min(0.95, impliedProb + shift),
    confidence: randRange(0.45, 0.85),
  };
}

function simBear(title: string, impliedProb: number) {
  const shift = randRange(0.03, 0.18);
  return {
    thesis: `Contrarian analysis identifies critical risk factors suggesting "${title}" probability is overestimated.`,
    keyArguments: [
      `Base rate for this event type is only ${(Math.max(0.1, impliedProb - shift) * 100).toFixed(1)}%`,
      `Availability cascade from recent news inflates perceived probability`,
      `Structural headwinds make YES outcome materially harder than priced`,
    ].slice(0, randInt(2, 4)),
    estimatedProbability: Math.max(0.05, impliedProb - shift),
    confidence: randRange(0.4, 0.8),
  };
}

function simJudge(title: string, impliedProb: number, bull: ReturnType<typeof simBull>, bear: ReturnType<typeof simBear>) {
  const w = bull.confidence + bear.confidence || 1;
  let prob = (bull.estimatedProbability * bull.confidence + bear.estimatedProbability * bear.confidence) / w;
  prob = Math.max(0.05, Math.min(0.95, prob + randRange(-0.05, 0.05)));
  const confidence = randRange(0.35, 0.85);
  const uncertainty = randRange(0.1, 0.4);
  return {
    trueProbability: Math.round(prob * 1000) / 1000,
    confidence: Math.round(confidence * 1000) / 1000,
    uncertainty: Math.round(uncertainty * 1000) / 1000,
    proEvidence: bull.keyArguments.slice(0, 2),
    antiEvidence: bear.keyArguments.slice(0, 2),
    catalystTiming: pick(['NONE', 'NONE', 'NONE', 'FAR', 'CLOSE'] as const),
    skipReason: confidence < 0.4 ? 'Insufficient confidence in probability estimate' : undefined,
  };
}

// ── Process single market through full pipeline ─────────────────────────────

async function processMarket(template: MarketTemplate, strategy: StrategySettings): Promise<void> {
  const impliedProb = Math.round(randRange(...template.impliedProbRange) * 1000) / 1000;
  const liquidity = Math.round(randRange(...template.liquidityRange));
  const spread = Math.round(randRange(...template.spreadRange) * 1000) / 1000;

  // ── 1. SCAN ──
  state.currentAgent = 'SCANNER';
  state.currentMarketTitle = template.title;
  state.lastActivity = new Date().toISOString();
  await delay(randInt(400, 1200));

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

  const candidate = await db.tradeCandidate.create({
    data: { marketId: market.id, stage: 'SCANNED' },
  });

  await db.job.create({
    data: {
      type: 'SCAN', status: 'COMPLETED', priority: 5,
      payload: JSON.stringify({ marketId: market.id, marketTitle: template.title }),
      result: JSON.stringify({ impliedProb, liquidity, spread }),
      startedAt: new Date(), completedAt: new Date(),
    },
  });

  state.marketsScanned++;
  state.lastActivity = new Date().toISOString();

  // ── 2. TRIAGE ──
  state.currentAgent = 'TRIAGE';
  await delay(randInt(600, 2000));

  const triage = simTriage(template.title, template.category);

  await db.job.create({
    data: {
      type: 'TRIAGE', status: 'COMPLETED', priority: 7,
      payload: JSON.stringify({ marketId: market.id, marketTitle: template.title }),
      result: JSON.stringify(triage),
      startedAt: new Date(), completedAt: new Date(),
    },
  });

  await db.tradeCandidate.update({
    where: { id: candidate.id },
    data: {
      stage: 'TRIAGED',
      triageStatus: triage.status,
      triageReason: triage.reason,
      researchQueued: triage.status === 'RELEVANT',
    },
  });

  state.lastActivity = new Date().toISOString();

  // Skip if not relevant
  if (triage.status !== 'RELEVANT') {
    state.ordersSkipped++;
    state.currentAgent = null;
    state.currentMarketTitle = null;
    return;
  }

  state.marketsRelevant++;

  // ── 3. RESEARCH (Bull + Bear + Contradiction) ──
  state.currentAgent = 'RESEARCH';
  await delay(randInt(1000, 3000));

  const researchRun = await db.researchRun.create({
    data: {
      marketId: market.id,
      candidateId: candidate.id,
      status: 'RUNNING',
      depth: 'DEEP',
      startedAt: new Date(),
    },
  });

  await db.tradeCandidate.update({
    where: { id: candidate.id },
    data: { stage: 'RESEARCHING' },
  });

  const bull = simBull(template.title, impliedProb);
  const bear = simBear(template.title, impliedProb);

  await db.agentOutput.create({
    data: {
      researchRunId: researchRun.id, role: 'BULL', modelUsed: 'live-sim-engine',
      promptVersion: '1', output: JSON.stringify(bull),
      tokenCount: randInt(800, 2000), latencyMs: randInt(500, 1500),
    },
  });

  await db.agentOutput.create({
    data: {
      researchRunId: researchRun.id, role: 'BEAR', modelUsed: 'live-sim-engine',
      promptVersion: '1', output: JSON.stringify(bear),
      tokenCount: randInt(800, 2000), latencyMs: randInt(500, 1500),
    },
  });

  await db.agentOutput.create({
    data: {
      researchRunId: researchRun.id, role: 'CONTRADICTION', modelUsed: 'live-sim-engine',
      promptVersion: '1',
      output: JSON.stringify({ contradictions: ['Bull/bear cite same source but reach opposite conclusions'], overlookedRisks: ['Black swan potential not adequately accounted for'], alternativeInterpretations: ['Resolution criteria may be interpreted differently'], reliabilityAssessment: randRange(0.4, 0.75) }),
      tokenCount: randInt(600, 1500), latencyMs: randInt(400, 1200),
    },
  });

  await db.researchRun.update({
    where: { id: researchRun.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  await db.job.create({
    data: {
      type: 'RESEARCH', status: 'COMPLETED', priority: 7,
      payload: JSON.stringify({ marketId: market.id, marketTitle: template.title, depth: 'DEEP' }),
      result: JSON.stringify({ researchRunId: researchRun.id }),
      startedAt: new Date(), completedAt: new Date(),
    },
  });

  state.lastActivity = new Date().toISOString();

  // ── 4. JUDGE ──
  state.currentAgent = 'JUDGE';
  await delay(randInt(600, 2000));

  const judge = simJudge(template.title, impliedProb, bull, bear);

  await db.tradeCandidate.update({
    where: { id: candidate.id },
    data: { stage: 'JUDGED' },
  });

  await db.agentOutput.create({
    data: {
      researchRunId: researchRun.id, role: 'JUDGE', modelUsed: 'live-sim-engine',
      promptVersion: '1', output: JSON.stringify(judge),
      tokenCount: randInt(600, 1500), latencyMs: randInt(300, 900),
    },
  });

  await db.job.create({
    data: {
      type: 'JUDGE', status: 'COMPLETED', priority: 8,
      payload: JSON.stringify({ marketId: market.id, marketTitle: template.title }),
      result: JSON.stringify(judge),
      startedAt: new Date(), completedAt: new Date(),
    },
  });

  state.lastActivity = new Date().toISOString();

  // ── 5. RISK ENGINE ──
  state.currentAgent = 'RISK';
  await delay(randInt(300, 1000));

  let riskResult: RiskEngineOutput;
  if (judge.skipReason) {
    riskResult = {
      action: 'SKIP', maxSize: 0, adjustedSize: 0, urgency: 'LOW',
      reasonCode: 'LOW_CONFIDENCE', reason: judge.skipReason,
      edge: Math.abs(judge.trueProbability - impliedProb), fees: 0.02, slippage: 0.01,
    };
  } else {
    riskResult = computeRisk({
      impliedProbability: impliedProb,
      judgeProbability: judge.trueProbability,
      confidence: judge.confidence,
      uncertainty: judge.uncertainty,
      fees: 0.02,
      slippage: 0.01,
      venue: template.venue,
      category: template.category,
      dailyExposure: state.totalExposure,
      categoryExposure: randRange(0, 8000),
      openPositions: state.ordersPlaced,
      marketLiquidity: liquidity,
      marketSpread: spread,
      catalystTiming: judge.catalystTiming === 'CLOSE' ? 'CLOSE' : undefined,
    });
  }

  await db.decision.create({
    data: {
      marketId: market.id, candidateId: candidate.id,
      action: riskResult.action,
      side: riskResult.side ?? null,
      reasonCode: riskResult.reasonCode ?? null,
      reason: riskResult.reason,
      judgeProbability: judge.trueProbability,
      impliedProb, edge: riskResult.edge,
      confidence: judge.confidence,
      uncertainty: judge.uncertainty,
      maxSize: riskResult.maxSize,
      urgency: riskResult.urgency,
      fees: riskResult.fees,
      slippage: riskResult.slippage,
      dryRun: false, // System thinks it's real!
    },
  });

  await db.tradeCandidate.update({
    where: { id: candidate.id },
    data: { stage: 'DECIDED' },
  });

  await db.job.create({
    data: {
      type: 'RISK', status: 'COMPLETED', priority: 9,
      payload: JSON.stringify({ marketId: market.id, marketTitle: template.title }),
      result: JSON.stringify(riskResult),
      startedAt: new Date(), completedAt: new Date(),
    },
  });

  state.lastActivity = new Date().toISOString();

  // ── 6. EXECUTE (Simulated but recorded as real) ──
  state.currentAgent = 'EXECUTOR';
  await delay(randInt(300, 800));

  if (riskResult.action === 'BUY') {
    const orderSize = riskResult.adjustedSize || riskResult.maxSize;
    const orderPrice = riskResult.side === 'YES' ? impliedProb : 1 - impliedProb;
    const estimatedPnl = riskResult.side === 'YES'
      ? (judge.trueProbability - orderPrice) * orderSize
      : ((1 - judge.trueProbability) - orderPrice) * orderSize;

    // Record order — system thinks it's a real fill
    await db.order.create({
      data: {
        marketId: market.id,
        venueOrderId: `LIVE_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        side: riskResult.side ?? 'YES',
        price: orderPrice,
        size: orderSize,
        filledSize: orderSize,
        status: 'FILLED',
        submittedAt: new Date(),
        filledAt: new Date(),
      },
    });

    // Open a position
    await db.position.create({
      data: {
        marketId: market.id,
        side: riskResult.side ?? 'YES',
        entryPrice: orderPrice,
        currentSize: orderSize,
        avgEntryPrice: orderPrice,
        unrealizedPnl: estimatedPnl,
        realizedPnl: 0,
        status: 'OPEN',
      },
    });

    await db.tradeCandidate.update({
      where: { id: candidate.id },
      data: { stage: 'EXECUTED' },
    });

    await db.job.create({
      data: {
        type: 'EXECUTE', status: 'COMPLETED', priority: 10,
        payload: JSON.stringify({
          marketId: market.id, marketTitle: template.title,
          side: riskResult.side, size: orderSize, price: orderPrice,
        }),
        result: JSON.stringify({ status: 'FILLED', filledSize: orderSize }),
        startedAt: new Date(), completedAt: new Date(),
      },
    });

    state.ordersPlaced++;
    state.totalExposure += orderSize;
    state.totalEstimatedPnl += estimatedPnl;
  } else {
    state.ordersSkipped++;
  }

  state.currentAgent = null;
  state.currentMarketTitle = null;
  state.lastActivity = new Date().toISOString();
}

// ── Main loop ────────────────────────────────────────────────────────────────

async function runLoop(): Promise<void> {
  if (state.status !== 'RUNNING') return;

  try {
    state.currentCycle++;
    const templates = pickTemplates(
      state.config.venues,
      state.config.categories,
      state.config.marketsPerScan,
    );

    for (const template of templates) {
      if (state.status !== 'RUNNING') break;
      await processMarket(template, DEFAULT_STRATEGY);
    }
  } catch (err) {
    state.error = err instanceof Error ? err.message : 'Unknown error';
    console.error('[LiveSim] Cycle error:', err);
  }

  // Schedule next cycle if still running
  if (state.status === 'RUNNING') {
    intervalHandle = setTimeout(runLoop, state.config.scanIntervalSec * 1000);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getSimState(): LiveSimState {
  return { ...state };
}

export function startSimulation(config?: Partial<LiveSimState['config']>): LiveSimState {
  if (state.status === 'RUNNING') return state;

  // Reset stats
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
    lastActivity: null,
    currentAgent: null,
    currentMarketTitle: null,
    error: null,
  });

  if (config) {
    Object.assign(state.config, config);
  }

  // Start the loop
  intervalHandle = setTimeout(runLoop, 1000);

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
  state.currentMarketTitle = null;
  state.lastActivity = new Date().toISOString();

  return { ...state };
}

export function updateConfig(config: Partial<LiveSimState['config']>): LiveSimState {
  Object.assign(state.config, config);
  return { ...state };
}

export type { LiveSimState };
