'use server'

import { db } from '@/lib/db';

const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2'

export interface KalshiMarket {
  ticker: string
  title: string
  subtitle: string
  yes_bid: number
  yes_ask: number
  open_interest: number
  volume: number
  close_time: string
  category: string
  status: string
  last_price: number
}

export interface KalshiMarketsResponse {
  markets: KalshiMarket[]
  cursor: string
}

export async function getKalshiMarkets(limit: number = 100, cursor?: string): Promise<KalshiMarketsResponse> {
  try {
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
    const response = await fetch(`${KALSHI_BASE_URL}/markets?limit=${limit}${cursorParam}`, {
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

export async function getAllKalshiMarkets(maxPages: number = 3): Promise<KalshiMarket[]> {
  const allMarkets: KalshiMarket[] = [];
  let cursor: string | undefined;
  let pageCount = 0;

  while (pageCount < maxPages) {
    const result = await getKalshiMarkets(100, cursor);
    if (!result.markets || result.markets.length === 0) break;
    allMarkets.push(...result.markets);
    if (!result.cursor) break;
    cursor = result.cursor;
    pageCount++;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return allMarkets;
}

export async function getKalshiMarket(ticker: string): Promise<KalshiMarket | null> {
  try {
    const response = await fetch(`${KALSHI_BASE_URL}/markets/${ticker}`, {
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
  if (!cursor) return;
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
