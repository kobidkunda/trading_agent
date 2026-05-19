import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { getEffectiveTradingConfig, STRATEGY_SETTINGS_KEY, TRADING_CONFIG_KEY, TRADING_MODE_KEY } from '@/lib/engine/trading-settings';
import { filterMarketsForMode } from '@/lib/engine/market-triage-mode-filter';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pagination = parsePaginationParams(searchParams);

    const stage = searchParams.get('stage');
    const minScoreParam = searchParams.get('minScore');
    const minScore = minScoreParam ? parseFloat(minScoreParam) : undefined;
    const excludeCooldown = searchParams.get('excludeCooldown') === 'true';
    const excludeExecuted = searchParams.get('excludeExecuted') === 'true';

    const where: Prisma.TradeCandidateWhereInput = {};
    if (stage) {
      where.stage = stage;
    }
    if (minScore !== undefined) {
      where.candidateScore = { gte: minScore };
    }
    if (excludeCooldown) {
      where.cooldownUntil = { lt: new Date() };
    }
    if (excludeExecuted) {
      where.stage = { notIn: ['EXECUTED', 'EXECUTION_PENDING'] };
    }

    // Server-side search across market title, category, venue
    const search = pagination.search;
    if (search) {
      where.market = {
        OR: [
          { title: { contains: search } },
          { category: { contains: search } },
          { venue: { contains: search } },
        ],
      };
    }

    // Server-side sort
    const sortBy = pagination.sortBy || 'candidateScore';
    const sortOrder = pagination.sortOrder || 'desc';
    let orderBy: Prisma.TradeCandidateOrderByWithRelationInput;
    if (sortBy === 'candidateScore') {
      orderBy = { candidateScore: sortOrder };
    } else if (sortBy === 'biasAdjustedProb') {
      orderBy = { biasAdjustedProb: sortOrder };
    } else if (sortBy === 'adjustedEdge') {
      orderBy = { adjustedEdge: sortOrder };
    } else if (sortBy === 'createdAt') {
      orderBy = { createdAt: sortOrder };
    } else if (sortBy === 'updatedAt') {
      orderBy = { market: { updatedAt: sortOrder } };
    } else {
      orderBy = { candidateScore: 'desc' };
    }

    const [strategySetting, tradingConfigSetting, tradingModeSetting] = await Promise.all([
      db.settings.findUnique({ where: { key: STRATEGY_SETTINGS_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_CONFIG_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_MODE_KEY } }),
    ]);

    const tradingConfig = getEffectiveTradingConfig({
      strategySettings: strategySetting ? JSON.parse(strategySetting.value) : null,
      tradingConfig: tradingConfigSetting ? JSON.parse(tradingConfigSetting.value) : null,
      tradingMode: tradingModeSetting?.value ?? null,
    });

    // Count total for pagination BEFORE mode filtering, fetch candidates in parallel
    const [totalCount, candidates] = await Promise.all([
      db.tradeCandidate.count({ where }),
      db.tradeCandidate.findMany({
        where,
        orderBy,
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
        include: {
          market: {
            select: {
              id: true,
              title: true,
              venue: true,
              category: true,
              status: true,
            },
          },
        },
      }),
    ]);

    const visibleCandidates = filterMarketsForMode(
      candidates.map((candidate) => ({
        ...candidate,
        externalId: candidate.market.id,
      })),
      tradingConfig.mode,
    ).map(({ externalId: _externalId, ...candidate }) => candidate);

    return NextResponse.json(
      buildPaginatedResponse(visibleCandidates, totalCount, pagination),
    );
  } catch {
    return NextResponse.json({ error: 'Failed to fetch candidates' }, { status: 500 });
  }
}
