import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { getKalshiMarkets } from '@/lib/venues/kalshi';
import { getEffectiveTradingConfig, STRATEGY_SETTINGS_KEY, TRADING_CONFIG_KEY, TRADING_MODE_KEY } from '@/lib/engine/trading-settings';
import { filterMarketsForMode } from '@/lib/engine/market-triage-mode-filter';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const venue = searchParams.get('venue');
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const onlyNew = searchParams.get('onlyNew') === 'true';
    const onlyChanged = searchParams.get('onlyChanged') === 'true';
    const excludeCooldown = searchParams.get('excludeCooldown') === 'true';
    const excludeExecuted = searchParams.get('excludeExecuted') === 'true';
    const excludeRecentlyResearched = searchParams.get('excludeRecentlyResearched') === 'true';
    const minCandidateScore = parseInt(searchParams.get('minCandidateScore') || '0');
    const sortBy = searchParams.get('sortBy') || 'updatedAt';

    const now = new Date();

    const where: Prisma.MarketWhereInput = {};
    if (venue) where.venue = venue;
    if (status) where.status = status;
    if (category) where.category = category;
    if (search) where.title = { contains: search };

    // Build candidate-level filters
    const candidateWhere: Prisma.TradeCandidateWhereInput | undefined =
      onlyNew || onlyChanged || excludeCooldown || excludeExecuted || excludeRecentlyResearched || minCandidateScore > 0
        ? {}
        : undefined;

    if (candidateWhere) {
      if (onlyNew) {
        // Markets with NO candidate or candidate created within last 24h
        candidateWhere.OR = [
          { lastProcessedAt: null },
          { stage: 'SCANNED' },
        ];
      }
      if (onlyChanged) {
        // Markets where price moved meaningfully (candidate updated after first scan)
        candidateWhere.lastProcessedAt = { not: null };
        candidateWhere.stage = { not: 'SCANNED' };
      }
      if (excludeCooldown) {
        candidateWhere.AND = candidateWhere.AND || [];
        (candidateWhere.AND as Prisma.TradeCandidateWhereInput[]).push({
          OR: [
            { cooldownUntil: null },
            { cooldownUntil: { lt: now } },
          ],
        });
        (candidateWhere.AND as Prisma.TradeCandidateWhereInput[]).push({
          OR: [
            { nextEligibleAt: null },
            { nextEligibleAt: { lt: now } },
          ],
        });
      }
      if (excludeExecuted) {
        candidateWhere.NOT = { stage: 'EXECUTED' };
      }
      if (excludeRecentlyResearched) {
        const researchCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        if (candidateWhere.AND) {
          (candidateWhere.AND as Prisma.TradeCandidateWhereInput[]).push({
            OR: [
              { lastResearchAt: null },
              { lastResearchAt: { lt: researchCutoff } },
            ],
          });
        } else {
          candidateWhere.OR = [
            { lastResearchAt: null },
            { lastResearchAt: { lt: researchCutoff } },
          ];
        }
      }
      if (minCandidateScore > 0) {
        candidateWhere.candidateScore = { gte: minCandidateScore };
      }

      where.tradeCandidates = { some: candidateWhere };
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

    // Determine sort order
    const orderBy: Prisma.MarketOrderByWithRelationInput =
      sortBy === 'score'
        ? { tradeCandidates: { _count: 'desc' } }
        : sortBy === 'firstSeen'
          ? { firstSeenAt: 'desc' }
          : { updatedAt: 'desc' };

    const markets = await db.market.findMany({
      where,
      include: {
        snapshots: { orderBy: { timestamp: 'desc' }, take: 1 },
        tradeCandidates: { orderBy: { updatedAt: 'desc' }, take: 1 },
      },
      orderBy,
      take: limit,
      skip: offset,
    });

    const visibleMarkets = filterMarketsForMode(markets, tradingConfig.mode);

    const enrichedMarkets = visibleMarkets.map((market) => {
      const candidate = market.tradeCandidates[0];
      const now = new Date();
      const isCooldown =
        (candidate?.cooldownUntil && new Date(candidate.cooldownUntil) > now) ||
        (candidate?.nextEligibleAt && new Date(candidate.nextEligibleAt) > now);
      const hasActiveLock = candidate?.processingLock != null && candidate?.lockExpiresAt && new Date(candidate.lockExpiresAt) > now;

      let reprocessStatus = 'FRESH';
      if (candidate?.stage === 'EXECUTED') {
        reprocessStatus = 'EXECUTED';
      } else if (isCooldown) {
        reprocessStatus = 'COOLDOWN';
      } else if (hasActiveLock) {
        reprocessStatus = 'PROCESSING';
      } else if (candidate?.stage === 'DECIDED') {
        reprocessStatus = 'DECIDED';
      } else if (candidate?.stage === 'WATCHING') {
        reprocessStatus = 'WATCHING';
      }

      return {
        ...market,
        duplicateStatus: reprocessStatus,
        candidateStage: candidate?.stage ?? null,
        candidateScore: candidate?.candidateScore ?? null,
        lastDecisionAt: candidate?.lastDecisionAt ?? null,
        lastResearchAt: candidate?.lastResearchAt ?? null,
        lastExecutionAt: candidate?.lastExecutionAt ?? null,
        nextEligibleAt: candidate?.nextEligibleAt ?? null,
        cooldownUntil: candidate?.cooldownUntil ?? null,
      };
    });

    return NextResponse.json({
      markets: enrichedMarkets,
      total: enrichedMarkets.length,
      limit,
      offset,
      appliedFilters: {
        onlyNew,
        onlyChanged,
        excludeCooldown,
        excludeExecuted,
        excludeRecentlyResearched,
        minCandidateScore,
        sortBy,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch markets' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === 'sync_kalshi') {
      const kalshiResult = await getKalshiMarkets(); const kalshiMarkets = kalshiResult.markets;
      
      const created: string[] = [];
      for (const market of kalshiMarkets) {
        try {
          const existing = await db.market.findFirst({
            where: { externalId: market.ticker, venue: 'KALSHI' }
          });

          if (!existing) {
            const createdMarket = await db.market.create({
              data: {
                externalId: market.ticker,
                venue: 'KALSHI',
                title: market.title,
                description: market.subtitle || '',
                category: market.category || 'other',
                status: market.status === 'active' ? 'ACTIVE' : 'INACTIVE',
                resolutionTime: new Date(market.close_time),
              }
            });
            created.push(createdMarket.id);

            await db.marketSnapshot.create({
              data: {
                marketId: createdMarket.id,
                impliedProb: market.last_price / 100,
                liquidity: market.volume,
                spread: Math.max(0.01, (market.yes_ask - market.yes_bid) / 100),
                volume24h: market.volume,
                bestBid: market.yes_bid / 100,
                bestAsk: market.yes_ask / 100,
              }
            });
          } else {
            await db.marketSnapshot.create({
              data: {
                marketId: existing.id,
                impliedProb: market.last_price / 100,
                liquidity: market.volume,
                spread: Math.max(0.01, (market.yes_ask - market.yes_bid) / 100),
                volume24h: market.volume,
                bestBid: market.yes_bid / 100,
                bestAsk: market.yes_ask / 100,
              }
            });
          }
        } catch (e) {
          console.error('Failed to import Kalshi market', market.ticker, e);
        }
      }

      return NextResponse.json({ imported: created.length, total: kalshiMarkets.length });
    }

    const market = await db.market.create({
      data: {
        externalId: body.externalId,
        venue: body.venue,
        title: body.title,
        description: body.description || '',
        category: body.category || 'other',
        status: body.status || 'ACTIVE',
        resolutionTime: body.resolutionTime ? new Date(body.resolutionTime) : null,
      },
    });
    return NextResponse.json(market, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create market' }, { status: 500 });
  }
}
