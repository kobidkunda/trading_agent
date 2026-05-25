import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { orderbookEngine, type PriceLevel } from '@/lib/engine/orderbook-microstructure';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/types';
import { Prisma } from '@prisma/client';

type OrderbookDashboardRow = {
  id: string;
  marketId: string;
  marketTitle: string | null;
  venue: string | null;
  category: string | null;
  status: string | null;
  isResolved: boolean | number | null;
  resolutionTime: Date | number | string | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  bidDepth: number | null;
  askDepth: number | null;
  depthImbalance: number | null;
  largeBidWall: number | null;
  largeAskWall: number | null;
  thinBookDanger: boolean | number | null;
  priceImpact: number | null;
  fillProbability: number | null;
  capturedAt: Date | number | string;
};

function hasExecutableTwoSidedBook(row: {
  bestBid: number | null;
  bestAsk: number | null;
  bidDepth: number | null;
  askDepth: number | null;
}) {
  return row.bestBid != null &&
    row.bestBid > 0 &&
    row.bestAsk != null &&
    row.bestAsk > 0 &&
    row.bestAsk < 1 &&
    row.bestAsk > row.bestBid &&
    row.bidDepth != null &&
    row.bidDepth > 0 &&
    row.askDepth != null &&
    row.askDepth > 0;
}

function isDegenerateBook(row: { bestBid: number | null; bestAsk: number | null; bidDepth: number | null; askDepth: number | null }) {
  return !hasExecutableTwoSidedBook(row);
}

function normalizeCapturedAt(value: Date | number | string): Date {
  if (value instanceof Date) return value;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
}

function deriveOrderbookMetrics(row: {
  spread: number | null;
  bidDepth: number | null;
  askDepth: number | null;
  depthImbalance?: number | null;
  fillProbability?: number | null;
  priceImpact?: number | null;
}) {
  const bidDepth = row.bidDepth ?? 0;
  const askDepth = row.askDepth ?? 0;
  const spread = row.spread ?? 0.05;
  const hasDepth = bidDepth > 0 || askDepth > 0;
  const analysis = hasDepth
    ? orderbookEngine.analyze({
        spread,
        bidDepth,
        askDepth,
        orderSize: 1000,
      })
    : null;

  return {
    depthImbalance: row.depthImbalance ?? analysis?.depthImbalance?.imbalance ?? null,
    fillProbability: row.fillProbability ?? analysis?.fillProbability ?? null,
    priceImpact: row.priceImpact ?? analysis?.priceImpact ?? null,
    thinBookDanger: analysis?.thinBookDanger ?? false,
  };
}

function mapOrderbookRow(row: OrderbookDashboardRow) {
  const executable = hasExecutableTwoSidedBook(row);
  const degenerate = !executable;
  const derived = executable ? deriveOrderbookMetrics(row) : null;
  const isSettled = Boolean(row.isResolved) || row.status === 'RESOLVED';
  return {
    id: row.id,
    marketId: row.marketId,
    marketTitle: row.marketTitle ?? '',
    venue: row.venue ?? '',
    category: row.category ?? '',
    settlementStatus: isSettled ? 'SETTLED' : 'PENDING',
    tentativeSettlementAt: row.resolutionTime ? normalizeCapturedAt(row.resolutionTime) : null,
    bestBid: row.bestBid == null || row.bestBid <= 0 ? null : row.bestBid,
    bestAsk: row.bestAsk == null || row.bestAsk <= 0 || row.bestAsk >= 1 ? null : row.bestAsk,
    spread: executable ? row.spread : null,
    bidDepth: row.bidDepth,
    askDepth: row.askDepth,
    depthImbalance: executable ? derived?.depthImbalance ?? null : null,
    largeBidWall: row.largeBidWall,
    largeAskWall: row.largeAskWall,
    thinBookDanger: degenerate ? true : Boolean(row.thinBookDanger || derived?.thinBookDanger),
    thinBookWarning: degenerate ? true : Boolean(row.thinBookDanger || derived?.thinBookDanger),
    priceImpact: executable ? derived?.priceImpact ?? null : null,
    fillProbability: executable ? derived?.fillProbability ?? null : null,
    capturedAt: normalizeCapturedAt(row.capturedAt),
    lastUpdated: normalizeCapturedAt(row.capturedAt),
    dataQuality: executable ? 'REAL_ORDERBOOK' : 'INCOMPLETE_ORDERBOOK',
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId');
    const pagination = parsePaginationParams(searchParams);

    if (!marketId) {
      const search = pagination.search?.trim();
      const sortMap: Record<string, Prisma.Sql> = {
        capturedAt: Prisma.sql`capturedAt`,
        spread: Prisma.sql`spread`,
        bidDepth: Prisma.sql`bidDepth`,
        askDepth: Prisma.sql`askDepth`,
        depthImbalance: Prisma.sql`depthImbalance`,
        fillProbability: Prisma.sql`fillProbability`,
      };
      const sortColumn = sortMap[pagination.sortBy ?? 'capturedAt'] ?? sortMap.capturedAt;
      const sortDirection = pagination.sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
      const searchClause = search
        ? Prisma.sql`where marketTitle like ${`%${search}%`} or venue like ${`%${search}%`} or category like ${`%${search}%`}`
        : Prisma.empty;
      const offset = (pagination.page - 1) * pagination.limit;

      const rows = await db.$queryRaw<OrderbookDashboardRow[]>`
        with ranked as (
          select
            o.id,
            o.marketId,
            m.title as marketTitle,
            m.venue as venue,
            m.category as category,
            m.status as status,
            m.isResolved as isResolved,
            m.resolutionTime as resolutionTime,
            o.bestBid,
            o.bestAsk,
            o.spread,
            o.bidDepth,
            o.askDepth,
            o.depthImbalance,
            o.largeBidWall,
            o.largeAskWall,
            o.thinBookDanger,
            o.priceImpact,
            o.fillProbability,
            o.capturedAt,
            row_number() over (
              partition by o.marketId
              order by
                case
                  when (o.bestBid is null or o.bestBid <= 0)
                   and (o.bestAsk is null or o.bestAsk >= 1)
                   and (o.bidDepth is null or o.bidDepth <= 0)
                   and (o.askDepth is null or o.askDepth <= 0)
                  then 1 else 0
                end asc,
                o.capturedAt desc
            ) as rn
          from OrderbookSnapshot o
          left join Market m on m.id = o.marketId
          where m.status = 'ACTIVE'
            and m.isActive = true
            and not (
              lower(m.title) glob 'yes *,yes *'
              or lower(m.title) glob 'yes *,no *'
              or lower(m.title) glob 'no *,yes *'
              or lower(m.title) glob 'no *,no *'
            )
        ),
        latest as (
          select * from ranked where rn = 1
        )
        select * from latest
        ${searchClause}
        order by ${sortColumn} ${sortDirection}
        limit ${pagination.limit} offset ${offset}
      `;

      const totalRows = await db.$queryRaw<Array<{ total: bigint | number }>>`
        with ranked as (
          select
            o.marketId,
            m.title as marketTitle,
            m.venue as venue,
            m.category as category,
            m.status as status,
            m.isResolved as isResolved,
            m.resolutionTime as resolutionTime,
            row_number() over (
              partition by o.marketId
              order by
                case
                  when (o.bestBid is null or o.bestBid <= 0)
                   and (o.bestAsk is null or o.bestAsk >= 1)
                   and (o.bidDepth is null or o.bidDepth <= 0)
                   and (o.askDepth is null or o.askDepth <= 0)
                  then 1 else 0
                end asc,
                o.capturedAt desc
            ) as rn
          from OrderbookSnapshot o
          left join Market m on m.id = o.marketId
          where m.status = 'ACTIVE'
            and m.isActive = true
            and not (
              lower(m.title) glob 'yes *,yes *'
              or lower(m.title) glob 'yes *,no *'
              or lower(m.title) glob 'no *,yes *'
              or lower(m.title) glob 'no *,no *'
            )
        ),
        latest as (
          select * from ranked where rn = 1
        )
        select count(*) as total from latest
        ${searchClause}
      `;

      const total = Number(totalRows[0]?.total ?? 0);
      const mapped = rows.map(mapOrderbookRow);
      
      return NextResponse.json(buildPaginatedResponse(mapped, total, pagination));
    }

    const snapshot = await db.orderbookSnapshot.findFirst({
      where: { marketId },
      orderBy: { capturedAt: 'desc' },
      include: {
        market: {
          select: {
            id: true,
            title: true,
            venue: true,
            category: true,
            externalId: true,
            status: true,
            latestPrice: true,
            latestSpread: true,
            latestLiquidity: true,
            lastSnapshotAt: true,
            isResolved: true,
            resolutionTime: true,
          },
        },
      },
    });

    if (!snapshot) {
      return NextResponse.json(
        { error: 'No orderbook snapshot found for this market', marketId },
        { status: 404 },
      );
    }

    const recentSnapshots = await db.orderbookSnapshot.findMany({
      where: { marketId },
      orderBy: { capturedAt: 'desc' },
      take: 12,
    });

    const levels: PriceLevel[] = snapshot.rawJson
      ? (() => {
          try {
            const parsed = JSON.parse(snapshot.rawJson);
            if (parsed.levels && Array.isArray(parsed.levels)) {
              return parsed.levels.map((l: { price: number; size: number; side?: 'BID' | 'ASK' }) => ({
                price: l.price,
                size: l.size,
                side: l.side,
              }));
            }
          } catch {
          }
          return [];
        })()
      : [];

    const analysis = orderbookEngine.analyze({
      bestBid: snapshot.bestBid,
      bestAsk: snapshot.bestAsk,
      spread: snapshot.spread ?? undefined,
      bidDepth: snapshot.bidDepth ?? undefined,
      askDepth: snapshot.askDepth ?? undefined,
      orderSize: 1000,
      levels: levels.length > 0 ? levels : undefined,
      recentMovement: snapshot.recentMovement ?? undefined,
      depthDecay: snapshot.depthDecay ?? undefined,
    });

    const executableSnapshot = hasExecutableTwoSidedBook(snapshot);
    const derivedSnapshot = executableSnapshot ? deriveOrderbookMetrics(snapshot) : null;
    const mapRecentSnapshot = (item: typeof recentSnapshots[number]) => {
      const executable = hasExecutableTwoSidedBook(item);
      const derived = executable ? deriveOrderbookMetrics(item) : null;
      return {
        id: item.id,
        capturedAt: item.capturedAt,
        bestBid: item.bestBid == null || item.bestBid <= 0 ? null : item.bestBid,
        bestAsk: item.bestAsk == null || item.bestAsk <= 0 || item.bestAsk >= 1 ? null : item.bestAsk,
        spread: executable ? item.spread : null,
        bidDepth: item.bidDepth,
        askDepth: item.askDepth,
        depthImbalance: executable ? derived?.depthImbalance ?? null : null,
        thinBookDanger: !executable || item.thinBookDanger || Boolean(derived?.thinBookDanger),
        largeBidWall: item.largeBidWall,
        largeAskWall: item.largeAskWall,
        fillProbability: executable ? derived?.fillProbability ?? null : null,
        recentMovement: item.recentMovement,
        depthDecay: item.depthDecay,
        dataQuality: executable ? 'REAL_ORDERBOOK' : 'INCOMPLETE_ORDERBOOK',
      };
    };

    return NextResponse.json({
      market: snapshot.market,
      snapshot: {
        id: snapshot.id,
        marketId: snapshot.marketId,
        orderbookSource: snapshot.orderbookSource,
        spreadSource: executableSnapshot ? snapshot.spreadSource : 'INCOMPLETE_ORDERBOOK',
        bestBid: snapshot.bestBid == null || snapshot.bestBid <= 0 ? null : snapshot.bestBid,
        bestAsk: snapshot.bestAsk == null || snapshot.bestAsk <= 0 || snapshot.bestAsk >= 1 ? null : snapshot.bestAsk,
        spread: executableSnapshot ? snapshot.spread : null,
        bidDepth: snapshot.bidDepth,
        askDepth: snapshot.askDepth,
        depthImbalance: executableSnapshot ? derivedSnapshot?.depthImbalance ?? null : null,
        largeBidWall: snapshot.largeBidWall,
        largeAskWall: snapshot.largeAskWall,
        thinBookDanger: !executableSnapshot || snapshot.thinBookDanger || Boolean(derivedSnapshot?.thinBookDanger),
        priceImpact: executableSnapshot ? derivedSnapshot?.priceImpact ?? null : null,
        fillProbability: executableSnapshot ? derivedSnapshot?.fillProbability ?? null : null,
        recentMovement: snapshot.recentMovement,
        depthDecay: snapshot.depthDecay,
        capturedAt: snapshot.capturedAt,
        dataQuality: executableSnapshot ? 'REAL_ORDERBOOK' : 'INCOMPLETE_ORDERBOOK',
      },
      recentSnapshots: recentSnapshots.map(mapRecentSnapshot),
      analysis,
    });
  } catch (error) {
    console.error('[Orderbook API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch orderbook snapshot', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { marketId, bestBid, bestAsk, spread, bidDepth, askDepth, rawJson } = body;

    if (!marketId) {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
    }

    const market = await db.market.findUnique({ where: { id: marketId } });
    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 });
    }

    const levels: PriceLevel[] = rawJson
      ? (() => {
          try {
            const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
            if (parsed.levels && Array.isArray(parsed.levels)) {
              return parsed.levels.map((l: { price: number; size: number; side?: 'BID' | 'ASK' }) => ({
                price: l.price,
                size: l.size,
                side: l.side,
              }));
            }
          } catch {
          }
          return [];
        })()
      : [];

    const analysis = orderbookEngine.analyze({
      bestBid: bestBid ?? null,
      bestAsk: bestAsk ?? null,
      spread: spread ?? null,
      bidDepth: bidDepth ?? null,
      askDepth: askDepth ?? null,
      orderSize: 1000,
      levels: levels.length > 0 ? levels : null,
    });

    const rawJsonString = typeof rawJson === 'string' ? rawJson : rawJson ? JSON.stringify(rawJson) : null;

    const snapshot = await db.orderbookSnapshot.create({
      data: {
        marketId,
        bestBid: bestBid ?? null,
        bestAsk: bestAsk ?? null,
        spread: spread ?? null,
        bidDepth: bidDepth ?? null,
        askDepth: askDepth ?? null,
        depthImbalance: analysis.depthImbalance?.imbalance ?? null,
        largeBidWall: analysis.whaleWalls?.bidWalls[0]?.size ?? null,
        largeAskWall: analysis.whaleWalls?.askWalls[0]?.size ?? null,
        thinBookDanger: analysis.thinBookDanger,
        priceImpact: analysis.priceImpact,
        fillProbability: analysis.fillProbability,
        rawJson: rawJsonString,
      },
    });

    await db.market.update({
      where: { id: marketId },
      data: { lastSnapshotAt: new Date() },
    });

    return NextResponse.json(
      { snapshot: { id: snapshot.id, marketId: snapshot.marketId, capturedAt: snapshot.capturedAt }, analysis },
      { status: 201 },
    );
  } catch (error) {
    console.error('[Orderbook API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create orderbook snapshot', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
