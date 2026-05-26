import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAccuracyMetrics } from '@/lib/engine/paper-bets';
import { reconcileMarketResolution, runResolutionCycle } from '@/lib/engine/resolution-poller';
import { getPaperSettlementReadiness, getProfitEvidenceSummary } from '@/lib/engine/profit-evidence';
import { PAPER_LOOP_TEST_MARKET_EXTERNAL_ID, PAPER_LOOP_TEST_MARKET_TITLE } from '@/lib/engine/paper-loop-test-market';
import type { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '25')));
    const limitForMetrics = Math.min(500, Math.max(limit, 100));
    const search = searchParams.get('search')?.trim();
    const type = searchParams.get('type')?.trim();
    const requestedSortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = (searchParams.get('sortOrder') === 'asc' ? 'asc' : 'desc') as Prisma.SortOrder;
    const allowedSortFields = new Set(['edge', 'confidence', 'brierScore', 'pnl', 'createdAt']);
    const sortBy = allowedSortFields.has(requestedSortBy) ? requestedSortBy : 'createdAt';

    const where: Prisma.PaperBetWhereInput = {
      market: {
        dataSource: 'REAL',
        externalId: { not: PAPER_LOOP_TEST_MARKET_EXTERNAL_ID },
        title: { not: PAPER_LOOP_TEST_MARKET_TITLE },
      },
      decision: { mode: 'PAPER' },
    };
    if (type && type !== 'ALL') {
      where.predictionType = type;
    }
    if (search) {
      where.market = {
        ...(where.market as Prisma.MarketWhereInput),
        OR: [
          { title: { contains: search } },
          { venue: { contains: search } },
          { category: { contains: search } },
        ],
      };
    }

    const [metrics, bets, total, statusCounts, profitEvidence, settlementReadiness] = await Promise.all([
      getAccuracyMetrics(limitForMetrics),
      db.paperBet.findMany({
        where,
        include: { market: { select: { title: true, venue: true } } },
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.paperBet.count({ where }),
      db.paperBet.groupBy({ by: ['executionStatus'], where, _count: { _all: true } }),
      getProfitEvidenceSummary(),
      getPaperSettlementReadiness(),
    ]);

    const paginatedBets = bets.map((bet) => ({
      id: bet.id,
      marketTitle: bet.market.title,
      market: bet.market.title,
      venue: bet.market.venue,
      predictionType: bet.predictionType,
      predictedProb: bet.predictedProb,
      predictedSide: bet.predictedSide,
      impliedProb: bet.impliedProb,
      edge: bet.edge,
      confidence: bet.confidence,
      stake: bet.stake,
      entryPrice: bet.entryPrice,
      executionStatus: bet.executionStatus,
      actualOutcome: bet.actualOutcome,
      directionCorrect: bet.directionCorrect,
      brierScore: bet.brierScore,
      pnl: bet.pnl,
      createdAt: bet.createdAt,
      resolvedAt: bet.resolvedAt,
    }));
    const totalPages = Math.ceil(total / limit);
    const executionStatusCounts = Object.fromEntries(
      statusCounts.map((row) => [row.executionStatus, row._count._all]),
    );
    const cancelledBets = Number(executionStatusCounts.CANCELLED ?? 0);

    return NextResponse.json({
      data: paginatedBets,
      total,
      totalPages,
      page,
      limit,
      // Include accuracy metrics as top-level fields for the stats cards
      totalBets: total,
      executedBets: metrics.totalBets,
      resolvedBets: metrics.resolvedBets,
      pendingBets: metrics.pendingBets,
      cancelledBets,
      executionStatusCounts,
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
      profitEvidence,
      settlementReadiness,
      nextResolutionAt: settlementReadiness.nextResolutionAt,
      nextResolutionMarket: settlementReadiness.nextResolutionMarket,
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
      if (!['YES', 'NO', 'CANCELLED'].includes(actualOutcome)) {
        return NextResponse.json({ error: 'actualOutcome must be YES, NO, or CANCELLED' }, { status: 400 });
      }

      const bet = await db.paperBet.findUnique({
        where: { id: betId },
        select: { id: true, marketId: true },
      });
      if (!bet) {
        return NextResponse.json({ error: 'Paper bet not found' }, { status: 404 });
      }

      const reconciliation = await reconcileMarketResolution({
        marketId: bet.marketId,
        outcome: actualOutcome,
        resolvedProb,
        source: 'PAPER_BET_MANUAL_RESOLVE',
      });
      const updatedBet = await db.paperBet.findUnique({ where: { id: betId } });
      return NextResponse.json({
        paperBet: updatedBet,
        outcome: reconciliation.outcomeRecord,
        outcomeCreated: reconciliation.outcomeCreated,
      });
    }

    return NextResponse.json({ error: 'Unknown action. Use: resolve_poll or resolve_bet' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process paper bet action' }, { status: 500 });
  }
}
