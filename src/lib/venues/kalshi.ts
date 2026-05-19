'use server'

import { db } from '@/lib/db';
import { getCredentialForService } from '@/lib/engine/research/search';

const KALSHI_DIRECT_URL = 'https://external-api.kalshi.com/trade-api/v2';

async function getKalshiBaseUrl(): Promise<string> {
  try {
    const proxyCredential = await getCredentialForService('kalshi_proxy') ?? await getCredentialForService('proxy');
    if (proxyCredential?.baseUrl) return proxyCredential.baseUrl.replace(/\/$/, '');
    const setting = await db.settings.findUnique({ where: { key: 'kalshi_proxy_url' } });
    if (setting?.value) return setting.value.replace(/\/$/, '');
    return KALSHI_DIRECT_URL;
  } catch {
    return KALSHI_DIRECT_URL;
  }
}

export interface GetAllKalshiMarketsOptions {
  maxPages?: number;
  startCursor?: string | null;
  scanUntilNoCursor?: boolean;
  rateLimitMs?: number;
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
  liquidity_dollars?: string
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

export async function getKalshiMarkets(limit: number = 100, cursor?: string): Promise<KalshiMarketsResponse> {
  try {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const baseUrl = await getKalshiBaseUrl();
    const response = await fetch(`${baseUrl}/markets?limit=${limit}${cursorParam}`, {
      cache: 'no-store'
    })

    if (!response.ok) {
      throw new Error(`Kalshi API error: ${response.status}`)
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
  let cursor: string | undefined = options.startCursor ?? undefined;
  let pageCount = 0;

  while (pageCount < maxPages || scanUntilNoCursor) {
    const result = await getKalshiMarkets(100, cursor);
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
    const baseUrl = await getKalshiBaseUrl();
    const response = await fetch(`${baseUrl}/markets/${ticker}`, {
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
