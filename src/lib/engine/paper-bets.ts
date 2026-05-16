import { db } from '@/lib/db';

export interface PaperBetScore {
  betId: string;
  marketId: string;
  directionCorrect: boolean;
  probError: number;
  brierScore: number;
  pnl: number;
}

export async function createPaperBet(params: {
  marketId: string;
  decisionId: string;
  predictionType: 'BID' | 'WATCH';
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
      predictionType: params.predictionType,
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
      directionCorrect: false,
      probError: 1,
      brierScore: 1,
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
  if (!bet || bet.actualOutcome) return null;

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
    where: { marketId, actualOutcome: null },
  });

  const results: Array<Awaited<ReturnType<typeof resolvePaperBet>>> = [];
  for (const bet of bets) {
    const result = await resolvePaperBet(bet.id, actualOutcome, resolvedProb);
    results.push(result);
  }

  if (actualOutcome !== 'CANCELLED') {
    const positions = await db.position.findMany({
      where: { marketId, status: { in: ['OPEN', 'WATCH'] } },
    });

    for (const pos of positions) {
      const actualBinary = actualOutcome === 'YES' ? 1 : 0;
      const realizedPnl = pos.side === actualOutcome
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
  }

  return results;
}

export interface AccuracyMetrics {
  totalBets: number;
  resolvedBets: number;
  pendingBets: number;
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
    where: {},
    include: { market: { select: { title: true } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const resolved = bets.filter((b) => b.actualOutcome !== null && b.actualOutcome !== undefined);
  const pending = bets.filter((b) => b.actualOutcome === null || b.actualOutcome === undefined);

  let directionCorrect = 0;
  let totalBrier = 0;
  let totalProbError = 0;
  let totalPnl = 0;
  let bidCount = 0;
  let bidCorrect = 0;
  let bidPnl = 0;
  let watchCount = 0;
  let watchCorrect = 0;
  let watchPnl = 0;

  for (const b of resolved) {
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
  }

  return {
    totalBets: bets.length,
    resolvedBets: resolved.length,
    pendingBets: pending.length,
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
      actualOutcome: b.actualOutcome,
      directionCorrect: b.directionCorrect,
      brierScore: b.brierScore,
      pnl: b.pnl,
      createdAt: b.createdAt,
      resolvedAt: b.resolvedAt,
    })),
  };
}
