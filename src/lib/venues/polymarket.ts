'use server';

import { db } from '@/lib/db';

const POLYMARKET_BASE_URL = 'https://clob.polymarket.com';
const DEFAULT_PAGE_LIMIT = 100;

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
  }>;
  nextCursor: string | null;
  hasMore: boolean;
}

export async function getPolymarketMarkets(limit: number = DEFAULT_PAGE_LIMIT, cursor?: string): Promise<PolymarketFetchResult> {
  try {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const response = await fetch(`${POLYMARKET_BASE_URL}/markets?limit=${limit}&active=true${cursorParam}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`Polymarket API error: ${response.status}`);
      return { markets: [], nextCursor: null, hasMore: false };
    }

    const data = await response.json();
    const markets = Array.isArray(data) ? data : data.markets || [];
    const nextCursor = data.next_cursor || data.cursor || null;
    const hasMore = Boolean(nextCursor);

    const resultMarkets = markets.map((m: Record<string, unknown>) => {
      const tokens = (m.tokens || []) as Array<Record<string, unknown>>;
      const yesToken = tokens.find((t) => t.outcome === 'Yes') || tokens[0];
      const price = typeof yesToken?.price === 'number' ? yesToken.price : 0.5;
      const spread = Math.abs(price - (1 - price)) * 0.02;

      return {
        externalId: String(m.condition_id || m.id || ''),
        title: String(m.question || m.title || ''),
        description: String(m.description || ''),
        category: String(m.category || 'other').toLowerCase(),
        venue: 'POLYMARKET' as const,
        status: m.active && !m.closed ? 'ACTIVE' : 'INACTIVE',
        impliedProb: price,
        liquidity: typeof m.volume === 'number' ? m.volume : 0,
        spread: Math.round(spread * 1000) / 1000,
        volume24h: typeof m.volume24hr === 'number' ? m.volume24hr : 0,
        bestBid: price - spread / 2,
        bestAsk: price + spread / 2,
      };
    }).filter((m: { title: string; externalId: string }) => m.title && m.externalId);

    return { markets: resultMarkets, nextCursor, hasMore };
  } catch (error) {
    console.error('Failed to fetch Polymarket markets:', error);
    return { markets: [], nextCursor: null, hasMore: false };
  }
}

export async function getAllPolymarketMarkets(maxPages: number = 5): Promise<PolymarketFetchResult['markets']> {
  const allMarkets: PolymarketFetchResult['markets'] = [];
  let cursor: string | undefined;
  let pageCount = 0;

  while (pageCount < maxPages) {
    const result = await getPolymarketMarkets(DEFAULT_PAGE_LIMIT, cursor);
    allMarkets.push(...result.markets);
    if (!result.nextCursor || !result.hasMore) break;
    cursor = result.nextCursor;
    pageCount++;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return allMarkets;
}

export async function savePolymarketCursor(cursor: string | null, hasMore: boolean): Promise<void> {
  if (!cursor) return;
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
