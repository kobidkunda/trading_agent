import { db } from '@/lib/db';
import { getAllPolymarketMarkets, loadPolymarketCursor, savePolymarketCursor } from '@/lib/venues/polymarket';
import { getAllKalshiMarkets, loadKalshiCursor, saveKalshiCursor } from '@/lib/venues/kalshi';
import { getEffectiveTradingConfig, STRATEGY_SETTINGS_KEY, TRADING_CONFIG_KEY, TRADING_MODE_KEY } from '@/lib/engine/trading-settings';
import { upsertScannedMarket } from '@/lib/engine/scanner-upsert';
import { normalizeTradingMode } from '@/lib/engine/mode';
import type { ScanMode } from '@/lib/types';

export async function runScanner(
  venues?: string[],
  categories?: string[],
  options?: {
    suppressCandidateJobEnqueue?: boolean;
  },
): Promise<Record<string, unknown>> {
  const [strategySetting, tradingConfigSetting, tradingModeSetting] = await Promise.all([
    db.settings.findUnique({ where: { key: STRATEGY_SETTINGS_KEY } }),
    db.settings.findUnique({ where: { key: TRADING_CONFIG_KEY } }),
    db.settings.findUnique({ where: { key: TRADING_MODE_KEY } }),
  ]);

  const config = getEffectiveTradingConfig({
    strategySettings: strategySetting ? JSON.parse(strategySetting.value) : null,
    tradingConfig: tradingConfigSetting ? JSON.parse(tradingConfigSetting.value) : null,
    tradingMode: tradingModeSetting?.value ?? null,
  });

  const enabledVenues = venues || config.enabledVenues || ['POLYMARKET', 'KALSHI'];
  const enabledCategories = categories || config.enabledCategories || [];
  const mode = normalizeTradingMode(config.mode);
  const scanMode = (config.scanMode ?? 'INCREMENTAL_SCAN') as ScanMode;
  const maxPagesPerVenue = config.maxPagesPerVenue ?? 10;
  const scanUntilNoCursor = config.scanUntilNoCursor ?? false;
  const scanRateLimitMs = config.scanRateLimitMs ?? 500;
  const scanTimeoutMs = config.scanTimeoutMs ?? 15000;

  // Skip real scanning in DEMO mode
  if (mode === 'DEMO') {
    return { totalScanned: 0, totalNew: 0, venues: [], mode: 'DEMO', message: 'DEMO mode: no real scanning' };
  }

  let totalScanned = 0;
  let totalNew = 0;

  for (const venue of enabledVenues) {
    const scanRun = await db.scanRun.create({
      data: {
        venue,
        mode,
        status: 'RUNNING',
        startedAt: new Date(),
      },
    });

    try {
      let markets: Array<{
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
        spreadSource?: string;
        tokenId?: string | null;
        rawOrderbookJson?: string | null;
        resolutionTime?: Date | string | null;
      }> = [];

      let marketsCreated = 0;
      let marketsUpdated = 0;
      let marketsSkipped = 0;
      let nextCursor: string | null = null;
      let cursorStart: string | null = null;
      let pagesScanned = 0;
      let hasMore = false;

      if (venue === 'POLYMARKET') {
        cursorStart =
          scanMode === 'RESUME_FROM_CURSOR'
            ? await loadPolymarketCursor()
            : null;
        const result = await getAllPolymarketMarkets({
          maxPages: maxPagesPerVenue,
          startCursor: cursorStart,
          scanUntilNoCursor: scanUntilNoCursor || scanMode === 'FULL_SCAN',
          rateLimitMs: scanRateLimitMs,
          timeoutMs: scanTimeoutMs,
        });
        markets = result.markets;
        nextCursor = result.nextCursor;
        hasMore = result.hasMore;
        pagesScanned = result.pagesScanned;
        await savePolymarketCursor(nextCursor, hasMore);
      } else if (venue === 'KALSHI') {
        cursorStart =
          scanMode === 'RESUME_FROM_CURSOR'
            ? await loadKalshiCursor()
            : null;
        const result = await getAllKalshiMarkets({
          maxPages: maxPagesPerVenue,
          startCursor: cursorStart,
          scanUntilNoCursor: scanUntilNoCursor || scanMode === 'FULL_SCAN',
          rateLimitMs: scanRateLimitMs,
        });
        nextCursor = result.nextCursor;
        hasMore = result.hasMore;
        pagesScanned = result.pagesScanned;
        await saveKalshiCursor(nextCursor, hasMore);
        markets = result.markets.map((m) => ({
          externalId: m.ticker,
          title: m.title,
          description: m.subtitle || '',
          category: (m.category || 'other').toLowerCase(),
          venue: 'KALSHI',
          status: m.status === 'active' ? 'ACTIVE' : m.status === 'resolved' ? 'RESOLVED' : 'CLOSED',
          impliedProb: m.last_price / 100,
          liquidity: m.volume,
          spread: Math.max(0.01, (m.yes_ask - m.yes_bid) / 100),
          volume24h: m.volume,
          bestBid: m.yes_bid / 100,
          bestAsk: m.yes_ask / 100,
          spreadSource: 'REAL_ORDERBOOK',
          resolutionTime: m.close_time || null,
        }));
      } else {
        continue;
      }

      for (const m of markets) {
        if (enabledCategories.length > 0 && !enabledCategories.includes(m.category)) {
          marketsSkipped++;
          continue;
        }

        const upsertResult = await upsertScannedMarket({
          market: m,
          scanRunId: scanRun.id,
          enqueueCandidateJobs: !(options?.suppressCandidateJobEnqueue ?? false),
        });

        if (upsertResult.created) {
          totalNew++;
          marketsCreated++;
        }

        if (upsertResult.updated) {
          marketsUpdated++;
        }

        totalScanned++;
      }

      await db.scanRun.update({
        where: { id: scanRun.id },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          marketsFetched: markets.length,
          marketsCreated,
          marketsUpdated,
          marketsSkipped,
          cursorStart,
          cursorEnd: nextCursor,
          metadataJson: JSON.stringify({
            scanMode,
            pagesScanned,
            rateLimitMs: scanRateLimitMs,
            timeoutMs: scanTimeoutMs,
            scanUntilNoCursor: scanUntilNoCursor || scanMode === 'FULL_SCAN',
            hasMore,
          }),
        },
      });

      await db.auditLog.create({
        data: {
          action: `SCAN_${venue}`,
          entityType: 'Market',
          details: `Scanned ${markets.length} ${venue} markets, ${totalNew} new, cursor=${(nextCursor as string | null)?.slice(0, 20) || 'none'}`,
        },
      });
    } catch (error) {
      await db.scanRun.update({
        where: { id: scanRun.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Scan failed',
        },
      });
      console.error(`Failed to scan ${venue}:`, error);
    }
  }

  await db.settings.upsert({
    where: { key: 'last_scan_time' },
    update: { value: new Date().toISOString() },
    create: { key: 'last_scan_time', value: new Date().toISOString() },
  });

  return { totalScanned, totalNew, venues: enabledVenues, mode };
}
