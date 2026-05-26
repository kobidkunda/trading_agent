import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { getEffectiveTradingConfig, STRATEGY_SETTINGS_KEY, TRADING_CONFIG_KEY, TRADING_MODE_KEY } from '@/lib/engine/trading-settings';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/types';

function parseCriteriaList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item)).filter(Boolean);
    }
  } catch {
    // Older rows may be semicolon-delimited.
  }
  return value.split(';').map((item) => item.trim()).filter(Boolean);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pagination = parsePaginationParams(searchParams);

    const stage = searchParams.get('stage');
    const minScoreParam = searchParams.get('minScore');
    const minScore = minScoreParam ? parseFloat(minScoreParam) : undefined;
    const aplusOnly = searchParams.get('aplus') === 'true';
    const excludeCooldown = searchParams.get('excludeCooldown') === 'true';
    const excludeExecuted = searchParams.get('excludeExecuted') === 'true';
    const allowedSortFields = new Set(['candidateScore', 'biasAdjustedProb', 'adjustedEdge', 'createdAt', 'updatedAt']);
    const sortBy = allowedSortFields.has(pagination.sortBy ?? '') ? pagination.sortBy ?? 'candidateScore' : 'candidateScore';
    const sortOrder = pagination.sortOrder || 'desc';

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
    if (aplusOnly) {
      where.candidateScore = { gte: 90 };
    }
    if (excludeExecuted) {
      where.stage = { notIn: ['EXECUTED', 'EXECUTION_PENDING'] };
    }
    const marketWhere: Prisma.MarketWhereInput = {
      status: 'ACTIVE',
      isActive: true,
    };

    const marketFilters: Prisma.MarketWhereInput[] = [];
    if (pagination.search) {
      marketFilters.push({
        OR: [
          { title: { contains: pagination.search } },
          { category: { contains: pagination.search } },
          { venue: { contains: pagination.search } },
        ],
      });
    }

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

    if (tradingConfig.mode !== 'DEMO') {
      marketWhere.NOT = {
        OR: [
          { externalId: { startsWith: 'live_' } },
          { externalId: { startsWith: 'sim_' } },
          { title: { startsWith: 'yes ' } },
          { title: { startsWith: 'no ' } },
          { title: { contains: ',yes ' } },
          { title: { contains: ',no ' } },
        ],
      };
    }
    if (marketFilters.length > 0) {
      marketWhere.AND = marketFilters;
    }
    where.market = marketWhere;

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
              resolutionTime: true,
            },
          },
        },
      }),
    ]);

    const enriched = candidates.map(c => ({
      ...c,
      marketTitle: c.market?.title ?? null,
      venue: c.market?.venue ?? null,
      category: c.market?.category ?? null,
      riskFlags: parseCriteriaList(c.rejectedCriteria),
      acceptedCriteriaList: parseCriteriaList(c.acceptedCriteria),
      rejectedCriteriaList: parseCriteriaList(c.rejectedCriteria),
      modelDisagreement: ((c.contradictionPenalty ?? 0) + (c.uncertaintyPenalty ?? 0)) > 0.5 ? 0.4 : 0,
    }));

    const payload = buildPaginatedResponse(enriched, totalCount, pagination);
    return NextResponse.json({
      ...payload,
      candidates: payload.data,
    });
  } catch (error) {
    console.error('[Candidates API] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch candidates', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
