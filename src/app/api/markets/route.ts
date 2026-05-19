import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { getKalshiMarkets } from '@/lib/venues/kalshi';
import { getEffectiveTradingConfig, STRATEGY_SETTINGS_KEY, TRADING_CONFIG_KEY, TRADING_MODE_KEY } from '@/lib/engine/trading-settings';
import { filterMarketsForMode } from '@/lib/engine/market-triage-mode-filter';
import { runScanner } from '@/lib/engine/scanner';
import { upsertScannedMarket } from '@/lib/engine/scanner-upsert';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/types';
import type { ScannerMarketInput } from '@/lib/engine/scanner-upsert';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pagination = parsePaginationParams(searchParams);

    const venue = searchParams.get('venue');
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const onlyNew = searchParams.get('onlyNew') === 'true';
    const onlyChanged = searchParams.get('onlyChanged') === 'true';
    const onlyAPlus = searchParams.get('onlyAPlus') === 'true';
    const excludeCooldown = searchParams.get('excludeCooldown') === 'true';
    const excludeExecuted = searchParams.get('excludeExecuted') === 'true';
    const excludeRecentlyResearched = searchParams.get('excludeRecentlyResearched') === 'true';
    const minCandidateScore = parseInt(searchParams.get('minCandidateScore') || '0');
    const sortPriority = searchParams.get('sortPriority') === 'score';

    // Use sortBy from pagination params; fall back to existing sortBy param for backward compat
    const effectiveSortBy = searchParams.get('sortBy') || pagination.sortBy || 'updatedAt';
    const effectiveSortOrder = (searchParams.get('sortOrder') as 'asc' | 'desc') || pagination.sortOrder || 'desc';

    const now = new Date();
    const freshThreshold = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const where: Prisma.MarketWhereInput = {};
    if (venue) where.venue = venue;
    if (status) where.status = status;
    if (category) where.category = category;
    if (pagination.search) {
      where.OR = [
        { title: { contains: pagination.search } },
        { category: { contains: pagination.search } },
        { venue: { contains: pagination.search } },
      ];
    }

    // Build candidate-level filters
    const candidateWhere: Prisma.TradeCandidateWhereInput | undefined =
      onlyNew || onlyChanged || onlyAPlus || excludeCooldown || excludeExecuted || excludeRecentlyResearched || minCandidateScore > 0
        ? {}
        : undefined;

    if (candidateWhere) {
      if (onlyNew) {
        if (candidateWhere.OR) {
          (candidateWhere.OR as Prisma.TradeCandidateWhereInput[]).push(
            { lastProcessedAt: null },
            { stage: 'SCANNED' },
          );
        } else {
          candidateWhere.OR = [
            { lastProcessedAt: null },
            { stage: 'SCANNED' },
          ];
        }
      }
      if (onlyChanged) {
        if (candidateWhere.AND) {
          (candidateWhere.AND as Prisma.TradeCandidateWhereInput[]).push({
            reprocessReason: { not: null },
            stage: { notIn: ['DECIDED', 'EXECUTED', 'SETTLED'] },
          });
        } else {
          candidateWhere.AND = [{
            reprocessReason: { not: null },
            stage: { notIn: ['DECIDED', 'EXECUTED', 'SETTLED'] },
          }];
        }
      }
      if (onlyAPlus) {
        if (candidateWhere.AND) {
          (candidateWhere.AND as Prisma.TradeCandidateWhereInput[]).push({
            candidateScore: { gte: 90 },
            stage: { notIn: ['DECIDED', 'EXECUTED', 'SETTLED'] },
          });
        } else {
          candidateWhere.AND = [{
            candidateScore: { gte: 90 },
            stage: { notIn: ['DECIDED', 'EXECUTED', 'SETTLED'] },
          }];
        }
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
        if (candidateWhere.NOT) {
          candidateWhere.NOT = { stage: { in: ['EXECUTED', 'SETTLED'] } };
        } else {
          candidateWhere.NOT = { stage: { in: ['EXECUTED', 'SETTLED'] } };
        }
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
        if (candidateWhere.AND) {
          (candidateWhere.AND as Prisma.TradeCandidateWhereInput[]).push({
            candidateScore: { gte: minCandidateScore },
          });
        } else {
          candidateWhere.candidateScore = { gte: minCandidateScore };
        }
      }

      where.tradeCandidates = { some: candidateWhere };
    }

    if (onlyNew && !candidateWhere) {
      where.tradeCandidates = { none: {} };
      where.firstSeenAt = { gte: freshThreshold };
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

    // Determine sort order — sortPriority=score overrides pagination.sortBy
    let orderBy: Prisma.MarketOrderByWithRelationInput;
    if (sortPriority) {
      orderBy = { tradeCandidates: { _count: 'desc' } };
    } else if (effectiveSortBy === 'score' || effectiveSortBy === 'candidateScore') {
      orderBy = { tradeCandidates: { _count: 'desc' } };
    } else if (effectiveSortBy === 'firstSeen') {
      orderBy = { firstSeenAt: 'desc' };
    } else {
      orderBy = { updatedAt: effectiveSortOrder };
    }

    const [markets, totalCount] = await Promise.all([
      db.market.findMany({
        where,
        include: {
          snapshots: { orderBy: { timestamp: 'desc' }, take: 1 },
          tradeCandidates: { orderBy: { updatedAt: 'desc' }, take: 1 },
        },
        orderBy,
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      db.market.count({ where }),
    ]);

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
        reprocessReason: candidate?.reprocessReason ?? null,
        firstSeenAt: market.firstSeenAt ?? null,
      };
    });

    return NextResponse.json(
      buildPaginatedResponse(enrichedMarkets, totalCount, pagination),
    );
  } catch {
    return NextResponse.json({ error: 'Failed to fetch markets' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === 'sync_kalshi') {
      const scanResult = await runScanner(['KALSHI'], [], { suppressCandidateJobEnqueue: true });
      const scanRunId = scanResult.scanRunId || 'manual-sync';

      const kalshiResult = await getKalshiMarkets();
      const kalshiMarkets = kalshiResult.markets;
      let imported = 0;

      for (const m of kalshiMarkets) {
        try {
          const scannerInput: ScannerMarketInput = {
            externalId: m.ticker,
            title: m.title,
            description: m.subtitle || '',
            category: m.category || 'other',
            venue: 'KALSHI',
            status: m.status === 'active' ? 'ACTIVE' : 'INACTIVE',
            impliedProb: m.last_price / 100,
            liquidity: m.volume,
            spread: Math.max(0.01, (m.yes_ask - m.yes_bid) / 100),
            volume24h: m.volume,
            bestBid: m.yes_bid / 100,
            bestAsk: m.yes_ask / 100,
            resolutionTime: m.close_time ? new Date(m.close_time) : null,
            dataSource: 'REAL',
          };
          const result = await upsertScannedMarket({ market: scannerInput, scanRunId: scanRunId as string });
          if (result.created) imported++;
        } catch (e) {
          console.error('Failed to import Kalshi market', m.ticker, e);
        }
      }

      return NextResponse.json({ imported, total: kalshiMarkets.length });
    }

    const scanRun = await db.scanRun.create({
      data: {
        venue: body.venue || 'POLYMARKET',
        status: 'COMPLETED' as const,
        mode: 'PAPER',
        startedAt: new Date(),
        finishedAt: new Date(),
      },
    });

    const scannerInput: ScannerMarketInput = {
      externalId: body.externalId,
      title: body.title,
      description: body.description || '',
      category: body.category || 'other',
      venue: body.venue || 'POLYMARKET',
      status: body.status || 'ACTIVE',
      impliedProb: body.impliedProb ?? 0.5,
      liquidity: body.liquidity ?? 0,
      spread: body.spread ?? 0.05,
      volume24h: body.volume24h ?? 0,
      resolutionTime: body.resolutionTime ? new Date(body.resolutionTime) : null,
      dataSource: body.dataSource || 'REAL',
    };

    const result = await upsertScannedMarket({
      market: scannerInput,
      scanRunId: scanRun.id,
    });

    const market = await db.market.findFirst({
      where: { externalId: body.externalId, venue: body.venue || 'POLYMARKET' },
    });

    return NextResponse.json({ market, created: result.created, updated: result.updated }, { status: result.created ? 201 : 200 });
  } catch {
    return NextResponse.json({ error: 'Failed to create market' }, { status: 500 });
  }
}
