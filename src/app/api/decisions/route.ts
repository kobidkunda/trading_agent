import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { computeRisk } from '@/lib/engine/risk';
import { buildPaginatedResponse, parsePaginationParams, RiskEngineInput } from '@/lib/types';
import { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId');
    const candidateId = searchParams.get('candidateId');
    const action = searchParams.get('action');
    const venue = searchParams.get('venue');
    const mode = searchParams.get('mode');
    const dataSource = searchParams.get('dataSource');
    const pagination = parsePaginationParams(searchParams);
    const allowedSortFields = new Set([
      'createdAt',
      'judgeProbability',
      'impliedProb',
      'edge',
      'confidence',
      'maxSize',
    ]);
    const sortBy = allowedSortFields.has(pagination.sortBy ?? '') ? pagination.sortBy ?? 'createdAt' : 'createdAt';
    const sortOrder = pagination.sortOrder ?? 'desc';

    const where: Prisma.DecisionWhereInput = {};
    if (marketId) where.marketId = marketId;
    if (candidateId) where.candidateId = candidateId;
    if (action) where.action = action;
    if (mode) where.mode = mode as Prisma.EnumTradingModeFilter<'Decision'>;
    if (dataSource) where.dataSource = dataSource as Prisma.EnumDataSourceFilter<'Decision'>;
    if (venue || pagination.search) {
      where.market = {};
      if (venue) where.market.venue = venue;
      if (pagination.search) {
        where.market.OR = [
          { title: { contains: pagination.search } },
          { category: { contains: pagination.search } },
          { venue: { contains: pagination.search } },
        ];
      }
    }

    const [decisions, total, summary] = await Promise.all([
      db.decision.findMany({
        where,
        include: {
          market: { select: { id: true, title: true, venue: true, category: true, status: true } },
          candidate: { select: { id: true, stage: true } },
        },
        orderBy: { [sortBy]: sortOrder },
        take: pagination.limit,
        skip: (pagination.page - 1) * pagination.limit,
      }),
      db.decision.count({ where }),
      db.decision.groupBy({
        by: ['action'],
        where,
        _count: { _all: true },
        _avg: { edge: true },
        _sum: { maxSize: true },
      }),
    ]);

    const bids = summary.find((row) => row.action === 'BID')?._count._all ?? 0;
    const watches = summary.find((row) => row.action === 'WATCH')?._count._all ?? 0;
    const skips = summary.find((row) => row.action === 'SKIP')?._count._all ?? 0;
    const totalSize = summary.reduce((sum, row) => sum + (row._sum.maxSize ?? 0), 0);
    const totalActions = summary.reduce((sum, row) => sum + row._count._all, 0);
    const avgEdge = totalActions > 0
      ? summary.reduce((sum, row) => sum + (row._avg.edge ?? 0) * row._count._all, 0) / totalActions
      : 0;
    const payload = buildPaginatedResponse(decisions, total, pagination);

    return NextResponse.json({
      ...payload,
      decisions: payload.data,
      summaryStats: { total, bids, watches, skips, avgEdge, totalSize },
    });
  } catch (error) {
    console.error('[Decisions API] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch decisions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.marketId) {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
    }

    // Fetch market data for risk engine inputs
    const market = await db.market.findUnique({
      where: { id: body.marketId },
      include: {
        snapshots: { orderBy: { timestamp: 'desc' }, take: 1 },
      },
    });

    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 });
    }

    const latestSnapshot = market.snapshots[0];

    // Build risk engine input
    const riskInput: RiskEngineInput = {
      impliedProbability: body.impliedProb ?? latestSnapshot?.impliedProb ?? 0.5,
      judgeProbability: body.judgeProbability ?? 0.5,
      confidence: body.confidence ?? 0.5,
      uncertainty: body.uncertainty ?? 0.2,
      fees: body.fees ?? 0.02,
      slippage: body.slippage ?? 0.01,
      venue: market.venue as RiskEngineInput['venue'],
      category: market.category,
      dailyExposure: body.dailyExposure ?? 0,
      categoryExposure: body.categoryExposure ?? 0,
      openPositions: body.openPositions ?? 0,
      marketLiquidity: latestSnapshot?.liquidity ?? 0,
      marketSpread: latestSnapshot?.spread ?? 0.05,
      catalystTiming: body.catalystTiming,
    };

    // Run the risk engine
    const riskResult = computeRisk(riskInput);

    // Create the decision record
    const decision = await db.decision.create({
      data: {
        marketId: body.marketId,
        candidateId: body.candidateId || null,
        action: riskResult.action,
        side: riskResult.side ?? null,
        reasonCode: riskResult.reasonCode ?? null,
        reason: riskResult.reason,
        judgeProbability: riskInput.judgeProbability,
        impliedProb: riskInput.impliedProbability,
        edge: riskResult.edge,
        confidence: riskInput.confidence,
        uncertainty: riskInput.uncertainty,
        maxSize: riskResult.maxSize,
        urgency: riskResult.urgency,
        fees: riskResult.fees,
        slippage: riskResult.slippage,
        dryRun: body.dryRun ?? true,
      },
      include: {
        market: { select: { id: true, title: true, venue: true } },
      },
    });

    await db.auditLog.create({
      data: {
        action: 'CREATE_DECISION',
        entityType: 'Decision',
        entityId: decision.id,
        details: `Decision ${decision.action} for market ${market.title} (edge: ${riskResult.edge.toFixed(4)}, urgency: ${riskResult.urgency})`,
      },
    });

    return NextResponse.json(decision, { status: 201 });
  } catch (error) {
    console.error('[Decisions API] POST error:', error);
    return NextResponse.json({ error: 'Failed to create decision' }, { status: 500 });
  }
}
