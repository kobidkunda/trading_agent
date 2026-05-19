'use server';

import { db } from '@/lib/db';
import { getCredentialForService } from '@/lib/engine/research/search';

const MANIFOLD_DIRECT_URL = 'https://api.manifold.markets/v0';
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 15000;

async function getManifoldBaseUrl(): Promise<string> {
  try {
    const proxyCredential = await getCredentialForService('manifold_proxy') ?? await getCredentialForService('proxy');
    if (proxyCredential?.baseUrl) return proxyCredential.baseUrl.replace(/\/$/, '');
    const setting = await db.settings.findUnique({ where: { key: 'manifold_proxy_url' } });
    if (setting?.value) return setting.value.replace(/\/$/, '');
    return MANIFOLD_DIRECT_URL;
  } catch {
    return MANIFOLD_DIRECT_URL;
  }
}

export interface ManifoldMarket {
  id: string;
  question: string;
  textDescription?: string | null;
  description?: unknown;
  outcomeType?: string;
  isResolved?: boolean;
  closeTime?: number | null;
  probability?: number | null;
  totalLiquidity?: number | null;
  volume?: number | null;
  volume24Hours?: number | null;
  groupSlugs?: string[] | null;
  slug?: string;
  url?: string;
  resolution?: string | null;
  resolutionTime?: number | null;
}

export interface ManifoldFetchResult {
  markets: Array<{
    externalId: string;
    title: string;
    description: string;
    category: string;
    venue: 'MANIFOLD';
    status: string;
    impliedProb: number;
    liquidity: number;
    spread: number;
    volume24h: number;
    spreadSource: 'ESTIMATED';
    resolutionTime: string | null;
    rawOrderbookJson: string | null;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface GetAllManifoldMarketsOptions {
  maxPages?: number;
  startCursor?: string | null;
  scanUntilNoCursor?: boolean;
  rateLimitMs?: number;
  timeoutMs?: number;
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function marketDescription(market: ManifoldMarket): string {
  if (typeof market.textDescription === 'string') return market.textDescription;
  if (typeof market.description === 'string') return market.description;
  if (market.description && typeof market.description === 'object') {
    return JSON.stringify(market.description);
  }
  return '';
}

function normalizeManifoldMarket(market: ManifoldMarket) {
  const closeTime = typeof market.closeTime === 'number' ? market.closeTime : null;
  const resolvedAt = typeof market.resolutionTime === 'number' ? market.resolutionTime : null;
  const probability = safeNumber(market.probability, 0.5);
  const category = market.groupSlugs?.[0] ?? market.outcomeType?.toLowerCase() ?? 'other';

  return {
    externalId: market.id,
    title: market.question,
    description: marketDescription(market),
    category: category.toLowerCase(),
    venue: 'MANIFOLD' as const,
    status: market.isResolved ? 'RESOLVED' : 'ACTIVE',
    impliedProb: Math.min(0.999, Math.max(0.001, probability)),
    liquidity: safeNumber(market.totalLiquidity, safeNumber(market.volume, 0)),
    spread: 0.05,
    volume24h: safeNumber(market.volume24Hours, 0),
    spreadSource: 'ESTIMATED' as const,
    resolutionTime:
      resolvedAt != null
        ? new Date(resolvedAt).toISOString()
        : closeTime != null
          ? new Date(closeTime).toISOString()
          : null,
    rawOrderbookJson: JSON.stringify({
      source: 'MANIFOLD',
      outcomeType: market.outcomeType ?? null,
      url: market.url ?? null,
      slug: market.slug ?? null,
      resolution: market.resolution ?? null,
    }),
  };
}

export async function getManifoldMarkets(options: {
  limit?: number;
  cursor?: string | null;
  timeoutMs?: number;
} = {}): Promise<ManifoldFetchResult> {
  const limit = Math.min(options.limit ?? DEFAULT_PAGE_LIMIT, 1000);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cursorParam = options.cursor ? `&before=${encodeURIComponent(options.cursor)}` : '';

  try {
    const baseUrl = await getManifoldBaseUrl();
    const response = await fetch(`${baseUrl}/markets?limit=${limit}${cursorParam}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      console.error(`Manifold API error: ${response.status}`);
      return { markets: [], nextCursor: null, hasMore: false };
    }

    const data = (await response.json()) as ManifoldMarket[];
    const markets = Array.isArray(data) ? data : [];
    const now = Date.now();
    const normalized = markets
      .filter((market) => market.id && market.question)
      .filter((market) => market.outcomeType === 'BINARY')
      .filter((market) => !market.isResolved)
      .filter((market) => typeof market.closeTime !== 'number' || market.closeTime > now)
      .map(normalizeManifoldMarket);
    const nextCursor = markets.length > 0 ? markets[markets.length - 1].id : null;

    return {
      markets: normalized,
      nextCursor,
      hasMore: markets.length >= limit && nextCursor != null,
    };
  } catch (error) {
    console.error('Failed to fetch Manifold markets:', error);
    return { markets: [], nextCursor: null, hasMore: false };
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

export async function getAllManifoldMarkets(
  options: GetAllManifoldMarketsOptions = {},
): Promise<{ markets: ManifoldFetchResult['markets']; nextCursor: string | null; pagesScanned: number; hasMore: boolean; pageFingerprints: string[] }> {
  const allMarkets: ManifoldFetchResult['markets'] = [];
  const pageFingerprints: string[] = [];
  const maxPages = options.maxPages ?? 5;
  const scanUntilNoCursor = options.scanUntilNoCursor ?? false;
  const rateLimitMs = options.rateLimitMs ?? 500;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let cursor: string | null | undefined = options.startCursor ?? undefined;
  let pageCount = 0;
  let nextCursor: string | null = cursor ?? null;
  let hasMore = false;

  while (pageCount < maxPages || scanUntilNoCursor) {
    const result = await getManifoldMarkets({
      limit: DEFAULT_PAGE_LIMIT,
      cursor,
      timeoutMs,
    });
    nextCursor = result.nextCursor;
    hasMore = result.hasMore;
    if (result.markets.length === 0) break;

    pageFingerprints.push(fingerprintPage(result.markets.map((market) => market.externalId)));
    allMarkets.push(...result.markets);
    pageCount++;
    if (!result.nextCursor || !result.hasMore) break;
    if (result.nextCursor === cursor) break;
    cursor = result.nextCursor;
    await new Promise((resolve) => setTimeout(resolve, rateLimitMs));
    if (!scanUntilNoCursor && pageCount >= maxPages) break;
  }

  return { markets: allMarkets, nextCursor, pagesScanned: pageCount, hasMore, pageFingerprints };
}

export async function saveManifoldCursor(cursor: string | null, hasMore: boolean): Promise<void> {
  try {
    await db.venueCursor.upsert({
      where: { venue: 'MANIFOLD' },
      update: { cursor, hasMore, lastScanAt: new Date(), updatedAt: new Date() },
      create: { venue: 'MANIFOLD', cursor, hasMore, lastScanAt: new Date() },
    });
  } catch (error) {
    console.warn('Failed to save Manifold cursor:', error);
  }
}

export async function loadManifoldCursor(): Promise<string | null> {
  try {
    const record = await db.venueCursor.findUnique({ where: { venue: 'MANIFOLD' } });
    return record?.cursor ?? null;
  } catch {
    return null;
  }
}
