import { NextRequest, NextResponse } from 'next/server';
import { getAccuracyMetrics, resolvePaperBet } from '@/lib/engine/paper-bets';
import { runResolutionCycle } from '@/lib/engine/resolution-poller';
import { isPaperLoopTestMarketTitle } from '@/lib/engine/paper-loop-test-market';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25')));
    const limitForMetrics = Math.min(500, Math.max(limit, 100));

    const metrics = await getAccuracyMetrics(limitForMetrics);
    const filteredRecentBets = metrics.recentBets.filter((bet) => !isPaperLoopTestMarketTitle(bet.marketTitle));
    const excludedCount = metrics.recentBets.length - filteredRecentBets.length;

    // Return paginated data shape that the dashboard expects
    const startIdx = (page - 1) * limit;
    const paginatedBets = filteredRecentBets.slice(startIdx, startIdx + limit);
    const totalPages = Math.ceil(filteredRecentBets.length / limit);

    return NextResponse.json({
      data: paginatedBets,
      total: filteredRecentBets.length,
      totalPages,
      page,
      limit,
      // Include accuracy metrics as top-level fields for the stats cards
      totalBets: Math.max(0, metrics.totalBets - excludedCount),
      resolvedBets: Math.max(0, metrics.resolvedBets - excludedCount),
      pendingBets: Math.max(0, metrics.pendingBets),
      directionAccuracy: metrics.directionAccuracy,
      avgBrierScore: metrics.avgBrierScore,
      totalPnl: metrics.totalPnl,
      bidCount: metrics.bidCount,
      bidCorrect: metrics.bidCorrect,
      bidPnl: metrics.bidPnl,
      watchCount: metrics.watchCount,
      watchCorrect: metrics.watchCorrect,
      watchPnl: metrics.watchPnl,
      aPlusDirectionAccuracy: metrics.aPlusDirectionAccuracy,
      aPlusAvgBrierScore: metrics.aPlusAvgBrierScore,
      aPlusTotalPnl: metrics.aPlusTotalPnl,
    });
  } catch (error) {
    console.error('[PaperBets API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch accuracy metrics', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === 'resolve_poll') {
      const result = await runResolutionCycle();
      return NextResponse.json(result);
    }

    if (body.action === 'resolve_bet') {
      const { betId, actualOutcome, resolvedProb } = body;
      if (!betId || !actualOutcome) {
        return NextResponse.json({ error: 'betId and actualOutcome required' }, { status: 400 });
      }
      const result = await resolvePaperBet(betId, actualOutcome, resolvedProb);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Unknown action. Use: resolve_poll or resolve_bet' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process paper bet action' }, { status: 500 });
  }
}
