'use server';

import { db } from '@/lib/db';
import { orderbookEngine, type OrderbookPriceLevel } from '@/lib/engine/orderbook-microstructure';

const POLYMARKET_BASE_URL = 'https://clob.polymarket.com';
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 15000;

export type SpreadSource = 'REAL_ORDERBOOK' | 'ESTIMATED';

export interface PolymarketMarket {
  condition_id: string;
  question: string;
  description: string;
  category: string;
  end_date_iso: string;
  active: boolean;
  closed: boolean;
  tokens: Array<{
    token_id: string;
    outcome: string;
    price: number;
  }>;
}

interface PolymarketFetchResult {
  markets: Array<{
    externalId: string;
    title: string;
    description: string;
    category: string;
    venue: string;
    status: string;
    impliedProb: number;
    liquidity: number;
    spread: number;
    volume24h?: number;
    bestBid?: number;
    bestAsk?: number;
    bidDepth?: number;
    askDepth?: number;
    priceImpact?: number;
    fillProbability?: number;
    spreadSource: SpreadSource;
    tokenId?: string | null;
    rawOrderbookJson?: string | null;
    resolutionTime?: string | null;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface VenueScanOptions {
  limit?: number;
  cursor?: string;
  timeoutMs?: number;
}

export interface GetAllPolymarketMarketsOptions {
  maxPages?: number;
  startCursor?: string | null;
  scanUntilNoCursor?: boolean;
  rateLimitMs?: number;
  timeoutMs?: number;
}

interface PolymarketBookLevel {
  price?: string;
  size?: string;
}

interface PolymarketBookResponse {
  bids?: PolymarketBookLevel[];
  asks?: PolymarketBookLevel[];
}

function safeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeBookLevels(
  levels: PolymarketBookLevel[] | undefined,
  side: 'BID' | 'ASK',
): OrderbookPriceLevel[] {
  if (!Array.isArray(levels)) {
    return [];
  }

  const normalized: OrderbookPriceLevel[] = [];

  for (const level of levels) {
    const price = safeNumber(level.price);
    const size = safeNumber(level.size);

    if (price == null || size == null || size <= 0) {
      continue;
    }

    normalized.push({ price, size, side });
  }

  return normalized;
}

export async function getPolymarketOrderbook(
  tokenId: string,
  orderSize: number = 1000,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  bidDepth: number | null;
  askDepth: number | null;
  priceImpact: number | null;
  fillProbability: number | null;
  spreadSource: SpreadSource;
  rawOrderbookJson: string | null;
}> {
  if (!tokenId) {
    return {
      bestBid: null,
      bestAsk: null,
      spread: null,
      bidDepth: null,
      askDepth: null,
      priceImpact: null,
      fillProbability: null,
      spreadSource: 'ESTIMATED',
      rawOrderbookJson: null,
    };
  }

  try {
    const response = await fetch(`${POLYMARKET_BASE_URL}/book?token_id=${encodeURIComponent(tokenId)}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      return {
        bestBid: null,
        bestAsk: null,
        spread: null,
        bidDepth: null,
        askDepth: null,
        priceImpact: null,
        fillProbability: null,
        spreadSource: 'ESTIMATED',
        rawOrderbookJson: null,
      };
    }

    const data = (await response.json()) as PolymarketBookResponse;
    const bids = normalizeBookLevels(data.bids, 'BID');
    const asks = normalizeBookLevels(data.asks, 'ASK');

    const bestBid = bids.length > 0 ? Math.max(...bids.map((level) => level.price)) : null;
    const bestAsk = asks.length > 0 ? Math.min(...asks.map((level) => level.price)) : null;
    const spread =
      bestBid != null && bestAsk != null && bestAsk >= bestBid
        ? Math.max(0, bestAsk - bestBid)
        : null;

    const bidDepth = bids.reduce((sum, level) => sum + level.size, 0);
    const askDepth = asks.reduce((sum, level) => sum + level.size, 0);
    const levels = [...bids, ...asks];

    const analysis =
      spread != null
        ? orderbookEngine.analyze({
            bestBid,
            bestAsk,
            spread,
            bidDepth,
            askDepth,
            orderSize,
            levels,
          })
        : null;

    return {
      bestBid,
      bestAsk,
      spread,
      bidDepth: bidDepth > 0 ? bidDepth : null,
      askDepth: askDepth > 0 ? askDepth : null,
      priceImpact: analysis?.priceImpact ?? null,
      fillProbability: analysis?.fillProbability ?? null,
      spreadSource: spread != null ? 'REAL_ORDERBOOK' : 'ESTIMATED',
      rawOrderbookJson: JSON.stringify({ bids, asks, levels }),
    };
  } catch {
    return {
      bestBid: null,
      bestAsk: null,
      spread: null,
      bidDepth: null,
      askDepth: null,
      priceImpact: null,
      fillProbability: null,
      spreadSource: 'ESTIMATED',
      rawOrderbookJson: null,
    };
  }
}

export async function getPolymarketMarkets(options: VenueScanOptions = {}): Promise<PolymarketFetchResult> {
  const limit = options.limit ?? DEFAULT_PAGE_LIMIT;
  const cursor = options.cursor;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const response = await fetch(`${POLYMARKET_BASE_URL}/markets?limit=${limit}&active=true${cursorParam}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      console.error(`Polymarket API error: ${response.status}`);
      return { markets: [], nextCursor: null, hasMore: false };
    }

    const data = await response.json();
    const markets = Array.isArray(data) ? data : data.markets || [];
    const nextCursor = data.next_cursor || data.cursor || null;
    const hasMore = Boolean(nextCursor);

    const resultMarkets = await Promise.all(markets.map(async (m: Record<string, unknown>) => {
      const tokens = (m.tokens || []) as Array<Record<string, unknown>>;
      const yesToken = tokens.find((t) => t.outcome === 'Yes') || tokens[0];
      const price = typeof yesToken?.price === 'number' ? yesToken.price : 0.5;
      const tokenId = typeof yesToken?.token_id === 'string' ? yesToken.token_id : null;
      const orderbook = tokenId ? await getPolymarketOrderbook(tokenId, 1000, timeoutMs) : null;

      const rawBestBid = orderbook?.bestBid ?? (typeof m.bestBid === 'number' ? m.bestBid : null);
      const rawBestAsk = orderbook?.bestAsk ?? (typeof m.bestAsk === 'number' ? m.bestAsk : null);
      const hasRealSpread =
        orderbook?.spreadSource === 'REAL_ORDERBOOK' &&
        rawBestBid != null &&
        rawBestAsk != null &&
        rawBestBid < rawBestAsk;

      const bestBid = hasRealSpread ? rawBestBid! : undefined;
      const bestAsk = hasRealSpread ? rawBestAsk! : undefined;
      const spread = hasRealSpread
        ? rawBestAsk! - rawBestBid!
        : Math.abs(price - (1 - price)) * 0.02;
      const estimatedSpread = Math.round(spread * 1000) / 1000;
      const bidDepth = orderbook?.bidDepth ?? null;
      const askDepth = orderbook?.askDepth ?? null;
      const priceImpact = orderbook?.priceImpact ?? null;
      const fillProbability = orderbook?.fillProbability ?? null;
      const spreadSource: SpreadSource =
        orderbook?.spreadSource === 'REAL_ORDERBOOK' && hasRealSpread
          ? 'REAL_ORDERBOOK'
          : 'ESTIMATED';

      return {
        externalId: String(m.condition_id || m.id || ''),
        title: String(m.question || m.title || ''),
        description: String(m.description || ''),
        category: String(m.category || 'other').toLowerCase(),
        venue: 'POLYMARKET' as const,
        status: m.active && !m.closed ? 'ACTIVE' : 'INACTIVE',
        impliedProb: price,
        liquidity: typeof m.volume === 'number' ? m.volume : 0,
        spread: estimatedSpread,
        estimatedSpread,
        bestBid,
        bestAsk,
        bidDepth: bidDepth ?? undefined,
        askDepth: askDepth ?? undefined,
        priceImpact: priceImpact ?? undefined,
        fillProbability: fillProbability ?? undefined,
        spreadSource,
        tokenId,
        rawOrderbookJson: orderbook?.rawOrderbookJson ?? null,
        resolutionTime:
          typeof m.end_date_iso === 'string'
            ? m.end_date_iso
            : typeof m.endDate === 'string'
              ? m.endDate
              : null,
      };
    })).then((resolved) => resolved.filter((m: { title: string; externalId: string }) => m.title && m.externalId));

    return { markets: resultMarkets, nextCursor, hasMore };
  } catch (error) {
    console.error('Failed to fetch Polymarket markets:', error);
    return { markets: [], nextCursor: null, hasMore: false };
  }
}

export async function getAllPolymarketMarkets(
  options: GetAllPolymarketMarketsOptions = {},
): Promise<{ markets: PolymarketFetchResult['markets']; nextCursor: string | null; pagesScanned: number; hasMore: boolean; }> {
  const allMarkets: PolymarketFetchResult['markets'] = [];
  const maxPages = options.maxPages ?? 5;
  const scanUntilNoCursor = options.scanUntilNoCursor ?? false;
  const rateLimitMs = options.rateLimitMs ?? 500;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let cursor: string | undefined = options.startCursor ?? undefined;
  let pageCount = 0;
  let nextCursor: string | null = cursor ?? null;
  let hasMore = false;

  while (pageCount < maxPages || scanUntilNoCursor) {
    const result = await getPolymarketMarkets({
      limit: DEFAULT_PAGE_LIMIT,
      cursor,
      timeoutMs,
    });
    nextCursor = result.nextCursor;
    hasMore = result.hasMore;
    if (result.markets.length === 0) {
      break;
    }
    allMarkets.push(...result.markets);
    pageCount++;
    if (!result.nextCursor || !result.hasMore) break;
    if (result.nextCursor === cursor) break;
    cursor = result.nextCursor;
    await new Promise((resolve) => setTimeout(resolve, rateLimitMs));
    if (!scanUntilNoCursor && pageCount >= maxPages) {
      break;
    }
  }

  return {
    markets: allMarkets,
    nextCursor,
    pagesScanned: pageCount,
    hasMore,
  };
}

export async function savePolymarketCursor(cursor: string | null, hasMore: boolean): Promise<void> {
  try {
    await db.venueCursor.upsert({
      where: { venue: 'POLYMARKET' },
      update: {
        cursor,
        hasMore,
        lastScanAt: new Date(),
        updatedAt: new Date(),
      },
      create: {
        venue: 'POLYMARKET',
        cursor,
        hasMore,
        lastScanAt: new Date(),
      },
    });
  } catch (error) {
    console.warn('Failed to save Polymarket cursor:', error);
  }
}

export async function loadPolymarketCursor(): Promise<string | null> {
  try {
    const record = await db.venueCursor.findUnique({ where: { venue: 'POLYMARKET' } });
    return record?.cursor ?? null;
  } catch {
    return null;
  }
}
