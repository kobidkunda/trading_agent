import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { reconcileMarketResolution, runResolutionCycle } from '@/lib/engine/resolution-poller';
import { getAccuracyMetrics } from '@/lib/engine/paper-bets';

export async function GET() {
  try {
    const metrics = await getAccuracyMetrics(500);

    const decisions = await db.decision.findMany({
      where: { judgeProbability: { not: null } },
      include: { market: { include: { outcomes: true } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const resolved = decisions.filter((d) => d.market.outcomes.length > 0);
    const unresolved = decisions.filter((d) => d.market.outcomes.length === 0);

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

    return NextResponse.json({
      totalDecisions: decisions.length,
      resolved: totalResolved,
      unresolved: unresolved.length,
      accuracy: totalResolved > 0 ? (correctPredictions / totalResolved * 100).toFixed(1) : null,
      bidAccuracy: bidTotal > 0 ? (bidCorrect / bidTotal * 100).toFixed(1) : null,
      watchAccuracy: watchTotal > 0 ? (watchCorrect / watchTotal * 100).toFixed(1) : null,
      skipAccuracy: skipTotal > 0 ? (skipCorrect / skipTotal * 100).toFixed(1) : null,
      bidCount: bidTotal,
      watchCount: watchTotal,
      skipCount: skipTotal,
      totalPnl: Math.round(totalPnl * 100) / 100,
      paperBets: metrics,
      recentResolved: resolved.slice(0, 20).map((d) => ({
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
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to compute accuracy' }, { status: 500 });
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
    return NextResponse.json({ error: 'Failed to create outcome' }, { status: 500 });
  }
}

export async function PUT() {
  try {
    const result = await runResolutionCycle();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Resolution poll failed' }, { status: 500 });
  }
}