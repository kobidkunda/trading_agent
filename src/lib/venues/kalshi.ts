import { db } from '@/lib/db';
import { getCredentialForService } from '@/lib/engine/research/search';
import { fetchVenueWithRelayFallback } from '@/lib/engine/relay-pool';
import { getActiveVenueProxyUrl } from '@/lib/engine/venue-proxy-settings';

const KALSHI_DIRECT_URL = 'https://external-api.kalshi.com/trade-api/v2';

async function getKalshiBaseUrl(): Promise<string> {
  try {
    const activeProxyUrl = await getActiveVenueProxyUrl('kalshi');
    if (activeProxyUrl) return activeProxyUrl;
    const proxyCredential = await getCredentialForService('kalshi_proxy') ?? await getCredentialForService('proxy');
    if (proxyCredential?.baseUrl) return proxyCredential.baseUrl.replace(/\/$/, '');
    const setting = await db.settings.findUnique({ where: { key: 'kalshi_proxy_url' } });
    if (setting?.value) return setting.value.replace(/\/$/, '');
    return KALSHI_DIRECT_URL;
  } catch {
    return KALSHI_DIRECT_URL;
  }
}

async function fetchKalshi(pathWithQuery: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs, ...fetchInit } = init;
  return fetchVenueWithRelayFallback('kalshi', KALSHI_DIRECT_URL, pathWithQuery, {
    ...fetchInit,
    timeoutMs,
  });
}

export interface GetAllKalshiMarketsOptions {
  maxPages?: number;
  startCursor?: string | null;
  scanUntilNoCursor?: boolean;
  rateLimitMs?: number;
  timeoutMs?: number;
}

export interface KalshiMarket {
  ticker: string
  title: string
  subtitle?: string
  yes_sub_title?: string
  yes_bid: number
  yes_ask: number
  yes_bid_dollars?: string
  yes_ask_dollars?: string
  no_bid_dollars?: string
  no_ask_dollars?: string
  open_interest: number
  volume: number
  volume_24h_fp?: string
  volume_fp?: string
  liquidity_dollars?: string
  open_interest_fp?: string
  yes_bid_size_fp?: string
  yes_ask_size_fp?: string
  no_bid_size_fp?: string
  no_ask_size_fp?: string
  mve_selected_legs?: Array<{ market_ticker?: string; side?: string }>
  custom_strike?: Record<string, unknown>
  last_price: number
  last_price_dollars?: string
  close_time: string
  category: string
  status: string
}

export interface KalshiMarketsResponse {
  markets: KalshiMarket[]
  cursor: string
}

function kalshiParse(value: string | number | undefined | null): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export interface NormalizedKalshiMarket {
  externalId: string;
  title: string;
  description: string;
  category: string;
  venue: 'KALSHI';
  status: 'ACTIVE' | 'CLOSED' | 'RESOLVED';
  impliedProb: number;
  liquidity: number;
  spread: number;
  volume24h: number;
  bestBid?: number;
  bestAsk?: number;
  bidDepth?: number;
  askDepth?: number;
  resolutionTime: string | null;
  spreadSource: 'REAL_ORDERBOOK' | 'ESTIMATED';
}

function isKalshiMultiLegMarket(market: KalshiMarket): boolean {
  if (Array.isArray(market.mve_selected_legs) && market.mve_selected_legs.length > 1) {
    return true;
  }

  const associatedMarkets = market.custom_strike?.['Associated Markets'];
  if (typeof associatedMarkets === 'string' && associatedMarkets.includes(',')) {
    return true;
  }

  const title = market.title ?? '';
  const yesCount = (title.match(/\byes\s+/gi) ?? []).length;
  return yesCount > 1 && title.includes(',');
}

function hasDegenerateBook(price: number, bestBid: number, bestAsk: number, bidDepth: number, askDepth: number, liquidity: number): boolean {
  const noDepth = bidDepth <= 0 && askDepth <= 0;
  const noLiquidity = liquidity <= 0;
  const noUsefulPrice = price <= 0;
  const collapsedBook = bestBid <= 0 && (bestAsk <= 0 || bestAsk >= 1);
  return noDepth && noLiquidity && noUsefulPrice && collapsedBook;
}

export function normalizeKalshiMarket(market: KalshiMarket): NormalizedKalshiMarket | null {
  if (market.status !== 'active') return null;
  if (isKalshiMultiLegMarket(market)) return null;

  const rawPrice = kalshiParse(market.last_price_dollars ?? market.last_price);
  const bestBid = kalshiParse(market.yes_bid_dollars ?? market.yes_bid);
  const bestAsk = kalshiParse(market.yes_ask_dollars ?? market.yes_ask);
  const bidDepth = kalshiParse(market.yes_bid_size_fp);
  const askDepth = kalshiParse(market.yes_ask_size_fp);
  // Only use book midpoint when both sides are real (not a degenerate 0/1 book)
  const validBid = bestBid > 0 ? bestBid : 0;
  const validAsk = bestAsk > 0 && bestAsk < 1 ? bestAsk : 0;
  const midpointFromBook =
    validBid > 0 && validAsk > 0 && validAsk >= validBid
      ? (validBid + validAsk) / 2
      : validBid > 0
        ? validBid
        : validAsk > 0
          ? validAsk
          : 0;
  const price = rawPrice > 0 && rawPrice < 1 ? rawPrice : midpointFromBook;
  const derivedBookLiquidity = Math.max(
    bidDepth * Math.max(validBid, 0.01),
    askDepth * Math.max(validAsk, 0.01),
    bidDepth + askDepth,
  );
  const liquidity = Math.max(
    kalshiParse(market.liquidity_dollars),
    kalshiParse(market.open_interest_fp),
    kalshiParse(market.volume_24h_fp),
    kalshiParse(market.volume_fp),
    kalshiParse(market.volume),
    kalshiParse(market.open_interest),
    derivedBookLiquidity,
  );

  if (hasDegenerateBook(price, bestBid, bestAsk, bidDepth, askDepth, liquidity)) {
    return null;
  }

  // yes_ask=1 means no one is selling YES for less than $1 — collapsed book with no real offer.
  // Treat bestBid=0 + bestAsk=1 as a degenerate book and use estimated spread instead.
  const hasRealBook = bestBid > 0 || (bestAsk > 0 && bestAsk < 1);
  const realBestBid = hasRealBook && bestBid > 0 ? bestBid : undefined;
  const realBestAsk = hasRealBook && bestAsk > 0 && bestAsk < 1 ? bestAsk : undefined;

  const spread =
    realBestAsk !== undefined && realBestBid !== undefined && realBestAsk >= realBestBid
      ? Math.max(0.001, realBestAsk - realBestBid)
      : Math.max(0.01, Math.abs(price - (1 - price)) * 0.02);

  // Strip "yes " prefix Kalshi uses for individual tournament-outcome markets.
  const rawTitle = market.title ?? '';
  const title = rawTitle.replace(/^\s*yes\s+/i, '').trim();

  return {
    externalId: market.ticker,
    title,
    description: market.subtitle || market.yes_sub_title || '',
    category: (market.category || 'other').toLowerCase(),
    venue: 'KALSHI',
    status: market.status === 'active' ? 'ACTIVE' : market.status === 'resolved' ? 'RESOLVED' : 'CLOSED',
    impliedProb: price,
    liquidity,
    spread,
    volume24h: Math.max(kalshiParse(market.volume_24h_fp), kalshiParse(market.volume_fp), kalshiParse(market.volume)),
    bestBid: realBestBid,
    bestAsk: realBestAsk,
    bidDepth: bidDepth > 0 ? bidDepth : undefined,
    askDepth: askDepth > 0 ? askDepth : undefined,
    resolutionTime: market.close_time || null,
    spreadSource: hasRealBook ? 'REAL_ORDERBOOK' : 'ESTIMATED',
  };
}

export async function getKalshiMarkets(limit: number = 100, cursor?: string, timeoutMs: number = 15000): Promise<KalshiMarketsResponse> {
  try {
    const params = new URLSearchParams({
      limit: String(limit),
      status: 'open',
      mve_filter: 'exclude',
    });
    if (cursor) params.set('cursor', cursor);
    const response = await fetchKalshi(`/markets?${params.toString()}`, {
      cache: 'no-store',
      timeoutMs,
    })

    if (!response.ok) {
      console.warn(`Kalshi API error: ${response.status} from /markets`);
      return { markets: [], cursor: '' }
    }

    const data: KalshiMarketsResponse = await response.json()
    return data
  } catch (error) {
    console.error('Failed to fetch Kalshi markets:', error)
    return { markets: [], cursor: '' }
  }
}

function fingerprintPage(externalIds: string[]): string {
  let hash = 5381;
  for (const id of [...externalIds].sort()) {
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) + hash) + id.charCodeAt(i);
    }
    hash = (hash ^ (hash >>> 16)) >>> 0;
  }
  return hash.toString(36);
}

export async function getAllKalshiMarkets(
  options: GetAllKalshiMarketsOptions = {},
): Promise<{ markets: KalshiMarket[]; nextCursor: string | null; pagesScanned: number; hasMore: boolean; pageFingerprints: string[] }> {
  const allMarkets: KalshiMarket[] = [];
  const pageFingerprints: string[] = [];
  const maxPages = options.maxPages ?? 3;
  const scanUntilNoCursor = options.scanUntilNoCursor ?? false;
  const rateLimitMs = options.rateLimitMs ?? 300;
  const timeoutMs = options.timeoutMs ?? 15000;
  let cursor: string | undefined = options.startCursor ?? undefined;
  let pageCount = 0;

  while (pageCount < maxPages || scanUntilNoCursor) {
    const result = await getKalshiMarkets(100, cursor, timeoutMs);
    if (!result.markets || result.markets.length === 0) break;
    const pageIds = result.markets.map((m) => m.ticker);
    pageFingerprints.push(fingerprintPage(pageIds));
    allMarkets.push(...result.markets);
    pageCount++;
    if (!result.cursor) break;
    cursor = result.cursor;
    await new Promise((resolve) => setTimeout(resolve, rateLimitMs));
    if (!scanUntilNoCursor && pageCount >= maxPages) {
      break;
    }
  }

  const now = new Date();
  const filtered = allMarkets.filter((m) => {
    if (m.status !== 'active') return false;
    if (m.close_time && new Date(m.close_time) < now) return false;
    if (!normalizeKalshiMarket(m)) return false;
    return true;
  });

  return {
    markets: filtered,
    nextCursor: cursor ?? null,
    pagesScanned: pageCount,
    hasMore: Boolean(cursor),
    pageFingerprints,
  };
}

export async function getKalshiMarket(ticker: string): Promise<KalshiMarket | null> {
  try {
    const response = await fetchKalshi(`/markets/${ticker}`, {
      cache: 'no-store'
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data.market
  } catch (error) {
    console.error('Failed to fetch Kalshi market:', error)
    return null
  }
}

export async function saveKalshiCursor(cursor: string | null, hasMore: boolean): Promise<void> {
  // null cursor = end-of-scan; must persist so next INCREMENTAL_SCAN doesn't re-fetch
  try {
    await db.venueCursor.upsert({
      where: { venue: 'KALSHI' },
      update: {
        cursor,
        hasMore,
        lastScanAt: new Date(),
        updatedAt: new Date(),
      },
      create: {
        venue: 'KALSHI',
        cursor,
        hasMore,
        lastScanAt: new Date(),
      },
    });
  } catch (error) {
    console.warn('Failed to save Kalshi cursor:', error);
  }
}

export async function loadKalshiCursor(): Promise<string | null> {
  try {
    const record = await db.venueCursor.findUnique({ where: { venue: 'KALSHI' } });
    return record?.cursor ?? null;
  } catch {
    return null;
  }
}
