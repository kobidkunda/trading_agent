import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { reconcileMarketResolution, runResolutionCycle } from '@/lib/engine/resolution-poller';
import { getAccuracyMetrics } from '@/lib/engine/paper-bets';
import { getPaperSettlementReadiness, getProfitEvidenceSummary } from '@/lib/engine/profit-evidence';

const VALID_MARKET_DUPLICATE_FILTER = {
  OR: [
    { duplicateStatus: null },
    { duplicateStatus: { not: 'INVALID_KALSHI_COMBO' } },
  ],
};

export async function GET() {
  try {
    const metrics = await getAccuracyMetrics(500);
    const now = new Date();

    const decisions = await db.decision.findMany({
      where: { judgeProbability: { not: null } },
      include: { market: { include: { outcomes: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const [
      dueForResolution,
      nextPendingMarket,
      profitEvidence,
      settlementReadiness,
    ] = await Promise.all([
      db.market.count({
        where: {
          AND: [
            VALID_MARKET_DUPLICATE_FILTER,
            {
              OR: [
                { status: { in: ['CLOSED', 'RESOLVED'] } },
                { resolutionTime: { lte: now } },
              ],
            },
          ],
          decisions: { some: { dryRun: true } },
          outcomes: { none: {} },
          venue: { in: ['POLYMARKET', 'KALSHI'] },
        },
      }),
      db.market.findFirst({
        where: {
          ...VALID_MARKET_DUPLICATE_FILTER,
          decisions: { some: { dryRun: true } },
          outcomes: { none: {} },
          venue: { in: ['POLYMARKET', 'KALSHI'] },
          resolutionTime: { gt: now },
        },
        select: { id: true, title: true, resolutionTime: true },
        orderBy: { resolutionTime: 'asc' },
      }),
      getProfitEvidenceSummary(),
      getPaperSettlementReadiness(now),
    ]);

    const validDecisions = decisions.filter((d) => d.market.duplicateStatus !== 'INVALID_KALSHI_COMBO');
    const resolved = validDecisions.filter((d) => d.market.outcomes.length > 0);
    const unresolved = validDecisions.filter((d) => d.market.outcomes.length === 0);

    let correctPredictions = 0;
    let totalResolved = 0;
    let bidCorrect = 0;
    let bidTotal = 0;
    let watchCorrect = 0;
    let watchTotal = 0;
    let skipCorrect = 0;
    let skipTotal = 0;
    let totalPnl = 0;

    for (const d of resolved) {
      const outcome = d.market.outcomes[0];
      if (!outcome || outcome.result === 'CANCELLED') continue;

      const predictedYes = (d.judgeProbability ?? 0) > 0.5;
      const actualYes = outcome.result === 'YES';
      const isCorrect = (predictedYes && actualYes) || (!predictedYes && !actualYes);

      totalResolved++;
      if (isCorrect) correctPredictions++;

      if (d.action === 'BID') {
        bidTotal++;
        if (isCorrect) bidCorrect++;
        const sideMultiplier = d.side === 'YES' ? 1 : -1;
        const pnl = isCorrect ? Math.abs((d.judgeProbability ?? 0.5) - (d.impliedProb ?? 0.5)) * (d.maxSize ?? 0) : -Math.abs((d.judgeProbability ?? 0.5) - (d.impliedProb ?? 0.5)) * (d.maxSize ?? 0) * 0.5;
        totalPnl += pnl * sideMultiplier;
      } else if (d.action === 'WATCH') {
        watchTotal++;
        if (isCorrect) watchCorrect++;
      } else {
        skipTotal++;
        const missedEdge = Math.abs((d.judgeProbability ?? 0) - (d.impliedProb ?? 0));
        if (missedEdge < 0.03) skipCorrect++;
      }
    }

    const recentResolved = resolved.slice(0, 20).map((d) => ({
      marketId: d.marketId,
      title: d.market.title,
      action: d.action,
      side: d.side,
      predictedProb: d.judgeProbability,
      impliedProb: d.impliedProb,
      actualOutcome: d.market.outcomes[0]?.result,
      correct: (() => {
        const outcome = d.market.outcomes[0]?.result;
        if (outcome === 'CANCELLED') return null;
        const predictedYes = (d.judgeProbability ?? 0) > 0.5;
        const actualYes = outcome === 'YES';
        return (predictedYes && actualYes) || (!predictedYes && !actualYes);
      })(),
      createdAt: d.createdAt,
    }));

    return NextResponse.json({
      data: recentResolved,
      total: totalResolved,
      page: 1,
      limit: 20,
      totalPages: totalResolved > 0 ? 1 : 0,
      totalDecisions: validDecisions.length,
      resolved: totalResolved,
      unresolved: unresolved.length,
      dueForResolution,
      pendingFuture: Math.max(0, unresolved.length - dueForResolution),
      nextResolutionAt: nextPendingMarket?.resolutionTime?.toISOString() ?? null,
      nextResolutionMarket: nextPendingMarket ? {
        id: nextPendingMarket.id,
        title: nextPendingMarket.title,
      } : null,
      accuracy: totalResolved > 0 ? (correctPredictions / totalResolved * 100).toFixed(1) : null,
      bidAccuracy: bidTotal > 0 ? (bidCorrect / bidTotal * 100).toFixed(1) : null,
      watchAccuracy: watchTotal > 0 ? (watchCorrect / watchTotal * 100).toFixed(1) : null,
      skipAccuracy: skipTotal > 0 ? (skipCorrect / skipTotal * 100).toFixed(1) : null,
      bidCount: bidTotal,
      watchCount: watchTotal,
      skipCount: skipTotal,
      totalPnl: Math.round(totalPnl * 100) / 100,
      paperBets: metrics,
      profitEvidence,
      settlementReadiness,
      recentResolved,
    });
  } catch (error) {
    console.error('[Outcomes API] GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to compute accuracy' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { marketId, result, resolvedProb } = body;

    if (!marketId || !result) {
      return NextResponse.json({ error: 'marketId and result required' }, { status: 400 });
    }

    const existing = await db.outcome.findMany({ where: { marketId }, orderBy: { resolvedAt: 'desc' }, take: 2 });
    if (existing.length > 1) {
      return NextResponse.json({ error: 'Duplicate outcomes detected for market', outcomes: existing }, { status: 409 });
    }
    const firstExisting = existing[0];
    if (firstExisting) {
      return NextResponse.json({ error: 'Outcome already exists', outcome: firstExisting }, { status: 409 });
    }

    const reconciliation = await reconcileMarketResolution({
      marketId,
      outcome: result,
      resolvedProb: resolvedProb ?? undefined,
      source: 'MANUAL_OUTCOME_POST',
    });

    return NextResponse.json(reconciliation.outcomeRecord, { status: 201 });
  } catch (error) {
    console.error('[Outcomes API] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create outcome' },
      { status: 500 },
    );
  }
}

export async function PUT(request?: NextRequest) {
  try {
    const { searchParams } = new URL(request?.url ?? 'http://localhost/api/outcomes');
    const parsedLimit = Number(searchParams.get('limit') ?? 25);
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 25;
    const result = await runResolutionCycle({ limit });
    return NextResponse.json(result);
  } catch (error) {
    console.error('[Outcomes API] PUT error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Resolution poll failed' },
      { status: 500 },
    );
  }
}
