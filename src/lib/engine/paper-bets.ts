import { db } from '@/lib/db';
import type { PaperBetExecutionStatus } from '@/lib/types';

const EXECUTED_PAPER_BET_STATUSES: PaperBetExecutionStatus[] = ['FILLED', 'PARTIAL'];
const RESOLVED_PAPER_BET_STATUSES: PaperBetExecutionStatus[] = ['FILLED', 'PARTIAL'];

export interface PaperBetScore {
  betId: string;
  marketId: string;
  directionCorrect: boolean | null;
  probError: number | null;
  brierScore: number | null;
  pnl: number;
}

export async function createPaperBet(params: {
  marketId: string;
  decisionId: string;
  orderId?: string | null;
  predictionType: 'BID' | 'WATCH';
  setupType?: 'A_PLUS_BET' | 'STANDARD_BET';
  aPlusStatus?: 'PASSED' | 'FAILED' | 'HEURISTIC';
  executionStatus?: PaperBetExecutionStatus;
  executedAt?: Date | null;
  predictedProb: number;
  predictedSide: 'YES' | 'NO';
  impliedProb: number;
  edge: number;
  confidence: number;
  stake: number;
  entryPrice: number;
}): Promise<string> {
  const bet = await db.paperBet.create({
    data: {
      marketId: params.marketId,
      decisionId: params.decisionId,
      orderId: params.orderId ?? null,
      predictionType: params.predictionType,
      setupType: params.setupType ?? null,
      aPlusStatus: params.aPlusStatus ?? null,
      executionStatus: params.executionStatus ?? 'SUBMITTED',
      executedAt: params.executedAt ?? null,
      predictedProb: params.predictedProb,
      predictedSide: params.predictedSide,
      impliedProb: params.impliedProb,
      edge: params.edge,
      confidence: params.confidence,
      stake: params.stake,
      entryPrice: params.entryPrice,
    },
  });
  return bet.id;
}

export function isExecutedPaperBetStatus(status: string | null | undefined): status is PaperBetExecutionStatus {
return RESOLVED_PAPER_BET_STATUSES.includes(status as PaperBetExecutionStatus) || EXECUTED_PAPER_BET_STATUSES.includes(status as PaperBetExecutionStatus);
}

export function scorePaperBet(
  predictedProb: number,
  predictedSide: 'YES' | 'NO',
  entryPrice: number,
  stake: number,
  actualOutcome: 'YES' | 'NO' | 'CANCELLED',
  resolvedProb?: number,
): Omit<PaperBetScore, 'betId' | 'marketId'> {
  if (actualOutcome === 'CANCELLED') {
    return {
      directionCorrect: null,
      probError: null,
      brierScore: null,
      pnl: 0,
    };
  }

  const actualBinary = actualOutcome === 'YES' ? 1 : 0;
  const brierScore = (predictedProb - actualBinary) ** 2;
  const probError = Math.abs(predictedProb - actualBinary);

  const predictedDirection = predictedSide === 'YES' ? 'YES' : 'NO';
  const directionCorrect = predictedDirection === actualOutcome;

  let pnl: number;
  if (predictedSide === 'YES') {
    pnl = directionCorrect
      ? (1 - entryPrice) * stake
      : -entryPrice * stake;
  } else {
    pnl = directionCorrect
      ? entryPrice * stake
      : -(1 - entryPrice) * stake;
  }

  return { directionCorrect, probError, brierScore, pnl };
}

export async function resolvePaperBet(betId: string, actualOutcome: 'YES' | 'NO' | 'CANCELLED', resolvedProb?: number) {
  const bet = await db.paperBet.findUnique({ where: { id: betId } });
  if (!bet || bet.actualOutcome || !isExecutedPaperBetStatus(bet.executionStatus)) return null;

  const score = scorePaperBet(
    bet.predictedProb,
    bet.predictedSide as 'YES' | 'NO',
    bet.entryPrice,
    bet.stake,
    actualOutcome,
    resolvedProb,
  );

  const updated = await db.paperBet.update({
    where: { id: betId },
    data: {
      actualOutcome,
      resolvedProb: resolvedProb ?? null,
      resolvedAt: new Date(),
      directionCorrect: score.directionCorrect,
      probError: score.probError,
      brierScore: score.brierScore,
      pnl: Math.round(score.pnl * 100) / 100,
    },
  });

  return updated;
}

export async function resolveAllPaperBetsForMarket(marketId: string, actualOutcome: 'YES' | 'NO' | 'CANCELLED', resolvedProb?: number) {
  const bets = await db.paperBet.findMany({
    where: { marketId, actualOutcome: null, executionStatus: { in: RESOLVED_PAPER_BET_STATUSES } },
  });

  const results: Array<Awaited<ReturnType<typeof resolvePaperBet>>> = [];
  for (const bet of bets) {
    const result = await resolvePaperBet(bet.id, actualOutcome, resolvedProb);
    results.push(result);
  }

  const positions = await db.position.findMany({
    where: { marketId, status: { in: ['OPEN', 'WATCH'] } },
  });

  for (const pos of positions) {
    const realizedPnl = actualOutcome === 'CANCELLED'
      ? 0
      : pos.side === actualOutcome
        ? (pos.side === 'YES' ? (1 - pos.entryPrice) : pos.entryPrice) * pos.currentSize
        : (pos.side === 'YES' ? -pos.entryPrice : -(1 - pos.entryPrice)) * pos.currentSize;

    await db.position.update({
      where: { id: pos.id },
      data: {
        realizedPnl: Math.round(realizedPnl * 100) / 100,
        unrealizedPnl: 0,
        status: 'CLOSED',
        closedAt: new Date(),
      },
    });
  }

  return results;
}

export interface AccuracyMetrics {
  totalBets: number;
  resolvedBets: number;
  pendingBets: number;
  aPlusResolvedBets: number;
  aPlusPendingBets: number;
  aPlusDirectionAccuracy: number;
  aPlusAvgBrierScore: number;
  aPlusTotalPnl: number;
  directionAccuracy: number;
  avgBrierScore: number;
  avgProbError: number;
  totalPnl: number;
  bidCount: number;
  bidCorrect: number;
  bidPnl: number;
  watchCount: number;
  watchCorrect: number;
  watchPnl: number;
  recentBets: Array<{
    id: string;
    marketTitle: string;
    predictionType: string;
    predictedProb: number;
    predictedSide: string;
    impliedProb: number;
    edge: number;
    confidence: number;
    stake: number;
    entryPrice: number;
    executionStatus: string | null;
    actualOutcome: string | null;
    directionCorrect: boolean | null;
    brierScore: number | null;
    pnl: number | null;
    createdAt: Date;
    resolvedAt: Date | null;
  }>;
}

export async function getAccuracyMetrics(limit: number = 100): Promise<AccuracyMetrics> {
  const bets = await db.paperBet.findMany({
    where: {
      market: { dataSource: 'REAL' },
      decision: { mode: 'PAPER' },
      executionStatus: { in: EXECUTED_PAPER_BET_STATUSES },
    },
    include: { market: { select: { title: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const resolved = bets.filter((b) => b.actualOutcome !== null && b.actualOutcome !== undefined);
  const scoredResolved = resolved.filter((b) => b.actualOutcome !== 'CANCELLED');
  const pending = bets.filter((b) => b.actualOutcome === null || b.actualOutcome === undefined);
  const aPlusResolved = resolved.filter((b) => b.setupType === 'A_PLUS_BET' || b.aPlusStatus === 'PASSED');
  const aPlusPending = pending.filter((b) => b.setupType === 'A_PLUS_BET' || b.aPlusStatus === 'PASSED');

  let directionCorrect = 0;
  let totalBrier = 0;
  let totalProbError = 0;
  let totalPnl = 0;
  let aPlusDirectionCorrect = 0;
  let aPlusTotalBrier = 0;
  let aPlusTotalPnl = 0;
  let bidCount = 0;
  let bidCorrect = 0;
  let bidPnl = 0;
  let watchCount = 0;
  let watchCorrect = 0;
  let watchPnl = 0;

  for (const b of scoredResolved) {
    if (b.directionCorrect) directionCorrect++;
    totalBrier += b.brierScore ?? 0;
    totalProbError += b.probError ?? 0;
    totalPnl += b.pnl ?? 0;

    if (b.predictionType === 'BID') {
      bidCount++;
      if (b.directionCorrect) bidCorrect++;
      bidPnl += b.pnl ?? 0;
    } else if (b.predictionType === 'WATCH') {
      watchCount++;
      if (b.directionCorrect) watchCorrect++;
      watchPnl += b.pnl ?? 0;
    }

    if (b.setupType === 'A_PLUS_BET' || b.aPlusStatus === 'PASSED') {
      if (b.directionCorrect) aPlusDirectionCorrect++;
      aPlusTotalBrier += b.brierScore ?? 0;
      aPlusTotalPnl += b.pnl ?? 0;
    }
  }

  return {
    totalBets: bets.length,
    resolvedBets: resolved.length,
    pendingBets: pending.length,
    aPlusResolvedBets: aPlusResolved.length,
    aPlusPendingBets: aPlusPending.length,
    aPlusDirectionAccuracy: aPlusResolved.length > 0 ? Math.round((aPlusDirectionCorrect / aPlusResolved.length) * 10000) / 100 : 0,
    aPlusAvgBrierScore: aPlusResolved.length > 0 ? Math.round((aPlusTotalBrier / aPlusResolved.length) * 10000) / 10000 : 0,
    aPlusTotalPnl: Math.round(aPlusTotalPnl * 100) / 100,
    directionAccuracy: resolved.length > 0 ? Math.round((directionCorrect / resolved.length) * 10000) / 100 : 0,
    avgBrierScore: resolved.length > 0 ? Math.round((totalBrier / resolved.length) * 10000) / 10000 : 0,
    avgProbError: resolved.length > 0 ? Math.round((totalProbError / resolved.length) * 10000) / 10000 : 0,
    totalPnl: Math.round(totalPnl * 100) / 100,
    bidCount,
    bidCorrect,
    bidPnl: Math.round(bidPnl * 100) / 100,
    watchCount,
    watchCorrect,
    watchPnl: Math.round(watchPnl * 100) / 100,
    recentBets: bets.map((b) => ({
      id: b.id,
      marketTitle: b.market.title,
      predictionType: b.predictionType,
      predictedProb: b.predictedProb,
      predictedSide: b.predictedSide,
      impliedProb: b.impliedProb,
      edge: b.edge,
      confidence: b.confidence,
      stake: b.stake,
      entryPrice: b.entryPrice,
      executionStatus: b.executionStatus,
      actualOutcome: b.actualOutcome,
      directionCorrect: b.directionCorrect,
      brierScore: b.brierScore,
      pnl: b.pnl,
      createdAt: b.createdAt,
      resolvedAt: b.resolvedAt,
    })),
  };
}
