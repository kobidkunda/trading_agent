import type { LiveActivityEvent, LiveMarketProgress, LivePipelineStage } from '@/lib/types';

export interface OperatorSimulationState {
  status: 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING';
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
  currentStage: LivePipelineStage | null;
  currentStageStartedAt: string | null;
  currentMarketTitle: string | null;
  activityEvents: LiveActivityEvent[];
  marketProgress: LiveMarketProgress[];
  lastCompletedMarket: {
    marketId: string;
    marketTitle: string;
    completedAt: string;
  } | null;
  error: string | null;
  config: {
    venues: string[];
    categories: string[];
    scanIntervalSec: number;
    marketsPerScan: number;
    maxPortfolioExposure: number;
  };
}

type TradingMode = 'DEMO' | 'PAPER' | 'LIVE';
type ExecutionMode = 'SIMULATED' | 'REAL';
type AttemptResult = 'WON' | 'LOST' | 'PENDING' | 'CANCELLED' | 'EXPIRED' | 'FAILED';

interface MarketSourceRecord {
  id: string;
  title: string;
  venue: string;
  category: string;
  status: string;
  resolutionTime: Date | null;
  updatedAt: Date;
  snapshots: Array<{
    impliedProb: number;
    liquidity: number;
    spread: number;
    volume24h: number;
    bestBid: number | null;
    bestAsk: number | null;
    timestamp: Date;
  }>;
  tradeCandidates: Array<{
    stage: string;
    triageStatus: string | null;
    updatedAt: Date;
  }>;
  decisions: Array<{
    id: string;
    action: string;
    side: string | null;
    reason: string | null;
    confidence: number | null;
    edge: number | null;
    urgency: string | null;
    mode?: TradingMode;
    executionMode?: ExecutionMode;
    createdAt: Date;
  }>;
  orders: Array<{
    id: string;
    venueOrderId: string | null;
    side: string;
    price: number;
    size: number;
    filledSize: number;
    remainingSize: number;
    avgFillPrice: number | null;
    status: string;
    lifecycleStatus: string;
    executionMode: ExecutionMode;
    submittedAt: Date | null;
    filledAt: Date | null;
    cancelledAt: Date | null;
    expiredAt: Date | null;
    failureReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  paperBets: Array<{
    id: string;
    predictionType: string;
    predictedProb: number;
    predictedSide: string;
    impliedProb: number;
    edge: number;
    confidence: number;
    stake: number;
    entryPrice: number;
    actualOutcome: string | null;
    resolvedProb: number | null;
    resolvedAt: Date | null;
    directionCorrect: boolean | null;
    pnl: number | null;
    decision: {
      id: string;
      action: string;
      side: string | null;
      reason: string | null;
      mode?: TradingMode;
      executionMode?: ExecutionMode;
      createdAt: Date;
    };
    createdAt: Date;
    updatedAt: Date;
  }>;
  outcomes: Array<{
    result: string;
    resolvedProb: number | null;
    resolvedAt: Date;
  }>;
  researchRuns: Array<{
    status: string;
    startedAt: Date | null;
    completedAt: Date | null;
    createdAt: Date;
    agentOutputs: Array<{
      role: string;
      summary: string | null;
      output: string;
      failureReason: string | null;
      createdAt: Date;
    }>;
  }>;
}

export interface OperatorAttempt {
  id: string;
  kind: 'ORDER' | 'PAPER_BET' | 'DECISION';
  mode: TradingMode;
  executionMode: ExecutionMode;
  label: string;
  side: string | null;
  price: number | null;
  size: number | null;
  filledSize: number | null;
  fillStatus: string;
  status: string;
  result: AttemptResult;
  outcomeLabel: string;
  placedAt: string | null;
  updatedAt: string | null;
  rationale: string | null;
  confidence: number | null;
  edge: number | null;
}

export interface OperatorMarketItem {
  marketId: string;
  title: string;
  venue: string;
  category: string;
  marketStatus: string;
  resolutionTime: string | null;
  impliedProb: number | null;
  liquidity: number | null;
  spread: number | null;
  pipelineStage: string;
  triageStatus: string | null;
  lastActivityAt: string | null;
  latestDecision: string;
  latestAttemptStatus: string;
  latestOutcome: string;
  winLoss: AttemptResult;
  attemptCount: number;
  isActive: boolean;
  mode: TradingMode;
  executionType: ExecutionMode;
  bullThesis: string | null;
  bearThesis: string | null;
  judgeConclusion: string | null;
  riskDecision: string | null;
  attempts: OperatorAttempt[];
}

export interface OperatorFocusCard {
  marketId: string | null;
  title: string;
  venue: string | null;
  mode: TradingMode;
  executionType: ExecutionMode;
  stage: string;
  status: string;
  startedAt: string | null;
  lastUpdatedAt: string | null;
  nextAction: string;
  bullThesis: string | null;
  bearThesis: string | null;
  judgeConclusion: string | null;
  riskDecision: string | null;
}

export interface OperatorDashboardPayload {
  mode: TradingMode;
  summary: {
    currentlyPlaying: string;
    openBets: number;
    pendingDecisions: number;
    wins: number;
    losses: number;
    resolvedToday: number;
    exposure: number;
    pipelineAlerts: number;
  };
  focus: OperatorFocusCard;
  markets: OperatorMarketItem[];
  simulation: OperatorSimulationState;
}

function toIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function firstLine(value: string | null | undefined, fallback: string | null = null): string | null {
  if (!value) return fallback;
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact ? compact.slice(0, 240) : fallback;
}

function inferResultFromResolvedSide(side: string | null, actualOutcome: string | null): AttemptResult {
  if (!actualOutcome) return 'PENDING';
  if (actualOutcome === 'CANCELLED') return 'CANCELLED';
  if (!side) return 'PENDING';
  return side === actualOutcome ? 'WON' : 'LOST';
}

function orderResult(order: MarketSourceRecord['orders'][number], marketOutcome: MarketSourceRecord['outcomes'][number] | undefined): AttemptResult {
  if (order.lifecycleStatus === 'CANCELLED') return 'CANCELLED';
  if (order.lifecycleStatus === 'EXPIRED') return 'EXPIRED';
  if (order.lifecycleStatus === 'FAILED') return 'FAILED';
  return inferResultFromResolvedSide(order.side, marketOutcome?.result ?? null);
}

function paperBetResult(paperBet: MarketSourceRecord['paperBets'][number]): AttemptResult {
  if (paperBet.actualOutcome === 'CANCELLED') return 'CANCELLED';
  if (paperBet.actualOutcome) {
    return inferResultFromResolvedSide(paperBet.predictedSide, paperBet.actualOutcome);
  }
  if (paperBet.pnl != null) {
    return paperBet.pnl >= 0 ? 'WON' : 'LOST';
  }
  return 'PENDING';
}

function fillStatusForOrder(order: MarketSourceRecord['orders'][number]): string {
  if (order.lifecycleStatus === 'FILLED') return 'FILLED';
  if (order.lifecycleStatus === 'PARTIALLY_FILLED') return 'PARTIAL';
  if (order.lifecycleStatus === 'SUBMITTED') return 'SUBMITTED';
  if (order.lifecycleStatus === 'PLANNED') return 'PLANNED';
  return order.lifecycleStatus;
}

function attemptStatusLabel(result: AttemptResult, status: string): string {
  if (result === 'WON' || result === 'LOST') return 'RESOLVED';
  return status;
}

function outcomeLabel(result: AttemptResult, marketOutcome: MarketSourceRecord['outcomes'][number] | undefined): string {
  if (result === 'PENDING') return marketOutcome ? marketOutcome.result : 'Pending';
  if (result === 'WON') return 'Won';
  if (result === 'LOST') return 'Lost';
  if (result === 'CANCELLED') return 'Cancelled';
  if (result === 'EXPIRED') return 'Expired';
  return 'Failed';
}

function buildResearchNarrative(run: MarketSourceRecord['researchRuns'][number] | undefined) {
  const outputs = run?.agentOutputs ?? [];
  const pick = (matcher: (role: string) => boolean) =>
    outputs.find((output) => matcher(output.role));

  return {
    bullThesis: firstLine(pick((role) => role === 'BULL' || role.includes('BULL'))?.summary)
      ?? firstLine(pick((role) => role === 'BULL' || role.includes('BULL'))?.output),
    bearThesis: firstLine(pick((role) => role === 'BEAR' || role.includes('BEAR'))?.summary)
      ?? firstLine(pick((role) => role === 'BEAR' || role.includes('BEAR'))?.output),
    judgeConclusion: firstLine(pick((role) => role === 'JUDGE' || role.includes('JUDGE') || role.includes('ARBITER'))?.summary)
      ?? firstLine(pick((role) => role === 'JUDGE' || role.includes('JUDGE') || role.includes('ARBITER'))?.output),
  };
}

function latestTimestamp(attempts: OperatorAttempt[]): string | null {
  const timestamps = attempts
    .map((attempt) => attempt.updatedAt ?? attempt.placedAt)
    .filter(Boolean) as string[];
  return timestamps.sort((a, b) => (a < b ? 1 : -1))[0] ?? null;
}

function compareByNewest(a: string | null, b: string | null): number {
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? 1 : -1;
}

function inferActiveMarketId(markets: OperatorMarketItem[], simulation: OperatorSimulationState): string | null {
  const runningMarket = simulation.marketProgress.find((market) => market.status === 'running');
  if (runningMarket) return runningMarket.marketId;

  if (simulation.currentMarketTitle) {
    const byTitle = markets.find((market) => market.title === simulation.currentMarketTitle);
    if (byTitle) return byTitle.marketId;
  }

  const openMarket = markets.find((market) => market.isActive);
  return openMarket?.marketId ?? null;
}

export function buildOperatorDashboardPayload({
  mode,
  markets,
  simulation,
}: {
  mode: TradingMode;
  markets: MarketSourceRecord[];
  simulation: OperatorSimulationState;
}): OperatorDashboardPayload {
  const normalizedMarkets = markets.map((market): OperatorMarketItem => {
    const latestSnapshot = market.snapshots[0];
    const latestCandidate = market.tradeCandidates[0];
    const latestDecision = market.decisions[0];
    const latestResearch = market.researchRuns[0];
    const marketOutcome = market.outcomes[0];
    const narrative = buildResearchNarrative(latestResearch);

    let attempts: OperatorAttempt[] = [];

    if (market.orders.length > 0) {
      attempts = market.orders.map((order) => {
        const result = orderResult(order, marketOutcome);
        const status = attemptStatusLabel(result, fillStatusForOrder(order));
        return {
          id: order.id,
          kind: 'ORDER',
          label: order.executionMode === 'REAL' ? 'Live order' : 'Simulated order',
          mode,
          executionMode: order.executionMode,
          side: order.side,
          price: order.avgFillPrice ?? order.price,
          size: order.size,
          filledSize: order.filledSize,
          fillStatus: fillStatusForOrder(order),
          status,
          result,
          outcomeLabel: outcomeLabel(result, marketOutcome),
          placedAt: toIso(order.submittedAt ?? order.createdAt),
          updatedAt: toIso(order.filledAt ?? order.cancelledAt ?? order.expiredAt ?? order.updatedAt),
          rationale: order.failureReason,
          confidence: latestDecision?.confidence ?? null,
          edge: latestDecision?.edge ?? null,
        };
      });
    } else if (market.paperBets.length > 0) {
      attempts = market.paperBets.map((paperBet) => {
        const result = paperBetResult(paperBet);
        const status = attemptStatusLabel(result, paperBet.predictionType);
        return {
          id: paperBet.id,
          kind: 'PAPER_BET',
          label: paperBet.decision.mode === 'DEMO' ? 'Demo attempt' : 'Paper attempt',
          mode: paperBet.decision.mode ?? mode,
          executionMode: paperBet.decision.executionMode ?? 'SIMULATED',
          side: paperBet.predictedSide,
          price: paperBet.entryPrice,
          size: paperBet.stake,
          filledSize: paperBet.stake,
          fillStatus: paperBet.predictionType,
          status,
          result,
          outcomeLabel: outcomeLabel(result, marketOutcome),
          placedAt: toIso(paperBet.createdAt),
          updatedAt: toIso(paperBet.resolvedAt ?? paperBet.updatedAt),
          rationale: paperBet.decision.reason,
          confidence: paperBet.confidence,
          edge: paperBet.edge,
        };
      });
    } else {
      attempts = market.decisions.map((decision) => ({
        id: decision.id,
        kind: 'DECISION',
        label: decision.action === 'SKIP' ? 'Watch decision' : 'Queued decision',
        mode: decision.mode ?? mode,
        executionMode: decision.executionMode ?? 'SIMULATED',
        side: decision.side,
        price: latestSnapshot?.impliedProb ?? null,
        size: null,
        filledSize: null,
        fillStatus: decision.action,
        status: decision.action === 'SKIP' ? 'WATCH' : 'PENDING',
        result: 'PENDING',
        outcomeLabel: 'Pending',
        placedAt: toIso(decision.createdAt),
        updatedAt: toIso(decision.createdAt),
        rationale: decision.reason,
        confidence: decision.confidence,
        edge: decision.edge,
      }));
    }

    attempts.sort((a, b) => compareByNewest(a.updatedAt ?? a.placedAt, b.updatedAt ?? b.placedAt));

    const leadAttempt = attempts[0];
    const isActive = attempts.some((attempt) => ['PLANNED', 'SUBMITTED', 'PARTIAL', 'PENDING', 'WATCH', 'RESOLVED'].indexOf(attempt.status) === -1
      ? false
      : ['PENDING', 'WATCH', 'PLANNED', 'SUBMITTED', 'PARTIAL'].includes(attempt.status));

    return {
      marketId: market.id,
      title: market.title,
      venue: market.venue,
      category: market.category,
      marketStatus: market.status,
      resolutionTime: toIso(market.resolutionTime),
      impliedProb: latestSnapshot?.impliedProb ?? null,
      liquidity: latestSnapshot?.liquidity ?? null,
      spread: latestSnapshot?.spread ?? null,
      pipelineStage: latestCandidate?.stage ?? 'IDLE',
      triageStatus: latestCandidate?.triageStatus ?? null,
      lastActivityAt: latestTimestamp(attempts) ?? toIso(latestResearch?.completedAt ?? latestResearch?.startedAt ?? market.updatedAt),
      latestDecision: latestDecision?.action ?? 'NONE',
      latestAttemptStatus: leadAttempt?.status ?? 'NONE',
      latestOutcome: leadAttempt?.outcomeLabel ?? (marketOutcome?.result ?? 'Pending'),
      winLoss: leadAttempt?.result ?? 'PENDING',
      attemptCount: attempts.length,
      isActive,
      mode: leadAttempt?.mode ?? mode,
      executionType: leadAttempt?.executionMode ?? 'SIMULATED',
      bullThesis: narrative.bullThesis,
      bearThesis: narrative.bearThesis,
      judgeConclusion: narrative.judgeConclusion,
      riskDecision: firstLine(latestDecision?.reason, latestDecision?.action ?? null),
      attempts,
    };
  });

  normalizedMarkets.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return compareByNewest(a.lastActivityAt, b.lastActivityAt);
  });

  const activeMarketId = inferActiveMarketId(normalizedMarkets, simulation);
  const focusMarket = normalizedMarkets.find((market) => market.marketId === activeMarketId) ?? normalizedMarkets[0];
  const focusAttempt = focusMarket?.attempts[0];

  const wins = normalizedMarkets.filter((market) => market.winLoss === 'WON').length;
  const losses = normalizedMarkets.filter((market) => market.winLoss === 'LOST').length;
  const resolvedToday = normalizedMarkets.filter((market) => {
    if (!market.lastActivityAt) return false;
    const day = new Date(market.lastActivityAt);
    const now = new Date();
    return day.getUTCFullYear() === now.getUTCFullYear()
      && day.getUTCMonth() === now.getUTCMonth()
      && day.getUTCDate() === now.getUTCDate()
      && ['WON', 'LOST', 'CANCELLED', 'EXPIRED', 'FAILED'].includes(market.winLoss);
  }).length;

  return {
    mode,
    summary: {
      currentlyPlaying: focusMarket?.title ?? 'No active market',
      openBets: normalizedMarkets.filter((market) => market.attempts.some((attempt) => ['PLANNED', 'SUBMITTED', 'PARTIAL'].includes(attempt.status))).length,
      pendingDecisions: normalizedMarkets.filter((market) => market.attempts.some((attempt) => ['PENDING', 'WATCH'].includes(attempt.status))).length,
      wins,
      losses,
      resolvedToday,
      exposure: simulation.totalExposure,
      pipelineAlerts: [simulation.error, simulation.status === 'STOPPED' ? 'stopped' : null].filter(Boolean).length,
    },
    focus: {
      marketId: focusMarket?.marketId ?? null,
      title: focusMarket?.title ?? 'No active market',
      venue: focusMarket?.venue ?? null,
      mode: focusAttempt?.mode ?? mode,
      executionType: focusAttempt?.executionMode ?? 'SIMULATED',
      stage: simulation.currentStage ?? focusMarket?.pipelineStage ?? 'IDLE',
      status: focusAttempt?.status ?? simulation.status,
      startedAt: simulation.currentStageStartedAt ?? focusAttempt?.placedAt ?? null,
      lastUpdatedAt: focusMarket?.lastActivityAt ?? simulation.lastActivity ?? null,
      nextAction: simulation.status === 'RUNNING'
        ? (simulation.currentStage === 'RISK' ? 'Awaiting risk decision' : 'Continue pipeline')
        : 'Start operator loop',
      bullThesis: focusMarket?.bullThesis ?? null,
      bearThesis: focusMarket?.bearThesis ?? null,
      judgeConclusion: focusMarket?.judgeConclusion ?? null,
      riskDecision: focusMarket?.riskDecision ?? null,
    },
    markets: normalizedMarkets,
    simulation,
  };
}
