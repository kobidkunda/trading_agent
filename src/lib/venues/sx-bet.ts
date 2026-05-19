'use server';

import { db } from '@/lib/db';
import { getCredentialForService } from '@/lib/engine/research/search';

const SX_BET_DIRECT_URL = 'https://api.sx.bet';
const SX_BET_DEFAULT_BASE_TOKEN = '0x6629Ce1Cf35Cc1329ebB4F63202F3f197b3F050B';
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_TIMEOUT_MS = 15000;

async function getSxBetBaseUrl(): Promise<string> {
  try {
    const proxyCredential = await getCredentialForService('sx_bet_proxy') ?? await getCredentialForService('proxy');
    if (proxyCredential?.baseUrl) return proxyCredential.baseUrl.replace(/\/$/, '');
    const setting = await db.settings.findUnique({ where: { key: 'sx_bet_proxy_url' } });
    if (setting?.value) return setting.value.replace(/\/$/, '');
    return SX_BET_DIRECT_URL;
  } catch {
    return SX_BET_DIRECT_URL;
  }
}

async function getSxBetBaseToken(): Promise<string> {
  try {
    const setting = await db.settings.findUnique({ where: { key: 'sx_bet_base_token' } });
    return setting?.value || SX_BET_DEFAULT_BASE_TOKEN;
  } catch {
    return SX_BET_DEFAULT_BASE_TOKEN;
  }
}

export interface SxBetMarket {
  status: string;
  marketHash: string;
  outcomeOneName: string;
  outcomeTwoName: string;
  teamOneName?: string;
  teamTwoName?: string;
  type?: number;
  gameTime?: number;
  sportLabel?: string;
  leagueLabel?: string;
  group1?: string;
  line?: number;
  liveEnabled?: boolean;
}

interface SxBetMarketsResponse {
  status?: string;
  data?: {
    markets?: SxBetMarket[];
    nextKey?: string;
  };
}

interface SxBetOddsSide {
  percentageOdds?: string | null;
  updatedAt?: number | null;
}

interface SxBetBestOdds {
  marketHash: string;
  baseToken: string;
  outcomeOne?: SxBetOddsSide;
  outcomeTwo?: SxBetOddsSide;
}

interface SxBetBestOddsResponse {
  status?: string;
  data?: {
    bestOdds?: SxBetBestOdds[];
  };
}

export interface SxBetFetchResult {
  markets: Array<{
    externalId: string;
    title: string;
    description: string;
    category: string;
    venue: 'SX_BET';
    status: string;
    impliedProb: number;
    liquidity: number;
    spread: number;
    volume24h: number;
    bestBid?: number;
    bestAsk?: number;
    spreadSource: 'REAL_ORDERBOOK' | 'ESTIMATED';
    resolutionTime: string | null;
    rawOrderbookJson: string | null;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface GetAllSxBetMarketsOptions {
  maxPages?: number;
  startCursor?: string | null;
  scanUntilNoCursor?: boolean;
  rateLimitMs?: number;
  timeoutMs?: number;
}

function parseSxBetPercentageOdds(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value) / 1e20;
  return Number.isFinite(parsed) ? Math.min(0.999, Math.max(0.001, parsed)) : null;
}

function sxBetTitle(market: SxBetMarket): string {
  const matchup =
    market.teamOneName && market.teamTwoName
      ? `${market.teamOneName} vs ${market.teamTwoName}`
      : `${market.outcomeOneName} vs ${market.outcomeTwoName}`;
  const league = market.leagueLabel ? `${market.leagueLabel}: ` : '';
  return `${league}${market.outcomeOneName} (${matchup})`;
}

function sxBetDescription(market: SxBetMarket): string {
  const parts = [
    market.sportLabel ? `Sport: ${market.sportLabel}` : null,
    market.leagueLabel ? `League: ${market.leagueLabel}` : null,
    market.outcomeTwoName ? `Opposite outcome: ${market.outcomeTwoName}` : null,
    typeof market.line === 'number' ? `Line: ${market.line}` : null,
    typeof market.type === 'number' ? `Market type: ${market.type}` : null,
    market.liveEnabled ? 'Live betting enabled' : null,
  ].filter(Boolean);
  return parts.join(' | ');
}

function normalizeSxBetMarket(market: SxBetMarket, odds?: SxBetBestOdds) {
  const outcomeOneOdds = parseSxBetPercentageOdds(odds?.outcomeOne?.percentageOdds);
  const outcomeTwoOdds = parseSxBetPercentageOdds(odds?.outcomeTwo?.percentageOdds);
  const bestAsk = outcomeOneOdds ?? null;
  const bestBid = outcomeTwoOdds != null ? 1 - outcomeTwoOdds : null;
  const hasRealSpread = bestBid != null && bestAsk != null && bestBid < bestAsk;
  const impliedProb = bestAsk ?? bestBid ?? 0.5;
  const spread = hasRealSpread ? bestAsk - bestBid : 0.05;
  const gameTime = typeof market.gameTime === 'number' ? market.gameTime : null;

  return {
    externalId: market.marketHash,
    title: sxBetTitle(market),
    description: sxBetDescription(market),
    category: (market.sportLabel || market.group1 || 'sports').toLowerCase(),
    venue: 'SX_BET' as const,
    status: market.status === 'ACTIVE' ? 'ACTIVE' : 'CLOSED',
    impliedProb,
    liquidity: 0,
    spread,
    volume24h: 0,
    bestBid: hasRealSpread ? bestBid : undefined,
    bestAsk: hasRealSpread ? bestAsk : undefined,
    spreadSource: hasRealSpread ? 'REAL_ORDERBOOK' as const : 'ESTIMATED' as const,
    resolutionTime: gameTime != null ? new Date(gameTime * 1000).toISOString() : null,
    rawOrderbookJson: JSON.stringify({
      source: 'SX_BET',
      baseToken: odds?.baseToken ?? null,
      odds: odds ?? null,
      marketType: market.type ?? null,
      gameTime,
    }),
  };
}

async function getSxBetBestOdds(marketHashes: string[], timeoutMs: number): Promise<Map<string, SxBetBestOdds>> {
  if (marketHashes.length === 0) return new Map();

  try {
    const [baseUrl, baseToken] = await Promise.all([getSxBetBaseUrl(), getSxBetBaseToken()]);
    const params = new URLSearchParams({
      marketHashes: marketHashes.join(','),
      baseToken,
    });
    const response = await fetch(`${baseUrl}/orders/odds/best?${params.toString()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      console.error(`SX Bet best odds API error: ${response.status}`);
      return new Map();
    }

    const data = (await response.json()) as SxBetBestOddsResponse;
    const odds = data.data?.bestOdds ?? [];
    return new Map(odds.map((entry) => [entry.marketHash, entry]));
  } catch (error) {
    console.error('Failed to fetch SX Bet best odds:', error);
    return new Map();
  }
}

export async function getSxBetMarkets(options: {
  limit?: number;
  cursor?: string | null;
  timeoutMs?: number;
} = {}): Promise<SxBetFetchResult> {
  const limit = Math.min(options.limit ?? DEFAULT_PAGE_LIMIT, 100);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const params = new URLSearchParams({ pageSize: String(limit) });
  if (options.cursor) params.set('paginationKey', options.cursor);

  try {
    const baseUrl = await getSxBetBaseUrl();
    const response = await fetch(`${baseUrl}/markets/active?${params.toString()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      console.error(`SX Bet markets API error: ${response.status}`);
      return { markets: [], nextCursor: null, hasMore: false };
    }

    const data = (await response.json()) as SxBetMarketsResponse;
    const rawMarkets = data.data?.markets ?? [];
    const nowSeconds = Math.floor(Date.now() / 1000);
    const markets = rawMarkets.filter((market) => {
      if (!market.marketHash || market.status !== 'ACTIVE') return false;
      if (typeof market.gameTime === 'number' && market.gameTime < nowSeconds) return false;
      return true;
    });
    const oddsByMarketHash = await getSxBetBestOdds(markets.map((market) => market.marketHash), timeoutMs);

    return {
      markets: markets.map((market) => normalizeSxBetMarket(market, oddsByMarketHash.get(market.marketHash))),
      nextCursor: data.data?.nextKey ?? null,
      hasMore: Boolean(data.data?.nextKey),
    };
  } catch (error) {
    console.error('Failed to fetch SX Bet markets:', error);
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

export async function getAllSxBetMarkets(
  options: GetAllSxBetMarketsOptions = {},
): Promise<{ markets: SxBetFetchResult['markets']; nextCursor: string | null; pagesScanned: number; hasMore: boolean; pageFingerprints: string[] }> {
  const allMarkets: SxBetFetchResult['markets'] = [];
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
    const result = await getSxBetMarkets({
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

export async function saveSxBetCursor(cursor: string | null, hasMore: boolean): Promise<void> {
  try {
    await db.venueCursor.upsert({
      where: { venue: 'SX_BET' },
      update: { cursor, hasMore, lastScanAt: new Date(), updatedAt: new Date() },
      create: { venue: 'SX_BET', cursor, hasMore, lastScanAt: new Date() },
    });
  } catch (error) {
    console.warn('Failed to save SX Bet cursor:', error);
  }
}

export async function loadSxBetCursor(): Promise<string | null> {
  try {
    const record = await db.venueCursor.findUnique({ where: { venue: 'SX_BET' } });
    return record?.cursor ?? null;
  } catch {
    return null;
  }
}
