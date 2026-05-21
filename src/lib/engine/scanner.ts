import { db } from '@/lib/db';
import { getAllPolymarketMarkets, loadPolymarketCursor, savePolymarketCursor } from '@/lib/venues/polymarket';
import { getAllKalshiMarkets, loadKalshiCursor, saveKalshiCursor } from '@/lib/venues/kalshi';
import { getAllManifoldMarkets, loadManifoldCursor, saveManifoldCursor } from '@/lib/venues/manifold';
import { getAllSxBetMarkets, loadSxBetCursor, saveSxBetCursor } from '@/lib/venues/sx-bet';
import { getEffectiveTradingConfig, STRATEGY_SETTINGS_KEY, TRADING_CONFIG_KEY, TRADING_MODE_KEY } from '@/lib/engine/trading-settings';
import { upsertScannedMarket } from '@/lib/engine/scanner-upsert';
import { createTitleHash } from '@/lib/engine/candidate-dedupe';
import { normalizeTradingMode } from '@/lib/engine/mode';
import type { ScanMode } from '@/lib/types';

const SUPPORTED_SCAN_VENUES = new Set(['POLYMARKET', 'KALSHI', 'SX_BET', 'MANIFOLD']);

/**
 * Scans prediction markets across enabled venues.
 *
 * ## Scan Modes
 *
 * | Mode               | Cursor behavior                                    |
 * |--------------------|----------------------------------------------------|
 * | `FULL_SCAN`        | Ignores saved cursor, fetches from page 0          |
 * | `INCREMENTAL_SCAN` | Loads saved cursor from VenueCursor, resumes there |
 * | `RESUME_FROM_CURSOR`| Same as INCREMENTAL_SCAN (available for clarity)   |
 *
 * ## Page Fingerprinting
 *
 * After each page fetch the scanner computes a fingerprint = hash of all
 * externalIds on that page. If the same fingerprint appears ≥3 times in
 * the last 10 pages a `repeatedPageDetected` warning is raised and logged.
 * The repeat rate is tracked in `metadataJson.repeatRate` for observability.
 */
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

  if (mode === 'DEMO') {
    return { totalScanned: 0, totalNew: 0, totalExisting: 0, venues: [], mode: 'DEMO', message: 'DEMO mode: no real scanning' };
  }

  let totalScanned = 0;
  let totalNew = 0;
  let totalExisting = 0;

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
      if (!SUPPORTED_SCAN_VENUES.has(venue)) {
        const message = `${venue} scanning is not implemented yet`;
        await db.scanRun.update({
          where: { id: scanRun.id },
          data: {
            status: 'SKIPPED',
            finishedAt: new Date(),
            errorMessage: message,
            metadataJson: JSON.stringify({
              supportedVenues: [...SUPPORTED_SCAN_VENUES],
              requestedVenue: venue,
            }),
          },
        });
        await db.auditLog.create({
          data: {
            action: `SCAN_${venue}_SKIPPED`,
            entityType: 'ScanRun',
            entityId: scanRun.id,
            details: message,
          },
        });
        continue;
      }

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
      let pageFingerprints: string[] = [];

      if (venue === 'POLYMARKET') {
        cursorStart =
          scanMode === 'RESUME_FROM_CURSOR' || scanMode === 'INCREMENTAL_SCAN'
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
        pageFingerprints = result.pageFingerprints;

        // If cursor didn't advance (API returned same cursor it was given), the
        // Polymarket CLOB API cursor is broken/stuck. Don't save it — reset to null
        // so next scan starts from the beginning and makes progress.
        const cursorAdvanced = nextCursor != null && nextCursor !== cursorStart;
        const effectiveCursor = cursorAdvanced ? nextCursor : null;
        const effectiveHasMore = cursorAdvanced ? hasMore : true;
        await savePolymarketCursor(effectiveCursor, effectiveHasMore);
      } else if (venue === 'KALSHI') {
        cursorStart =
          scanMode === 'RESUME_FROM_CURSOR' || scanMode === 'INCREMENTAL_SCAN'
            ? await loadKalshiCursor()
            : null;
        const result = await getAllKalshiMarkets({
          maxPages: maxPagesPerVenue,
          startCursor: cursorStart,
          scanUntilNoCursor: scanUntilNoCursor || scanMode === 'FULL_SCAN',
          rateLimitMs: scanRateLimitMs,
          timeoutMs: scanTimeoutMs,
        });
        nextCursor = result.nextCursor;
        hasMore = result.hasMore;
        pagesScanned = result.pagesScanned;
        pageFingerprints = result.pageFingerprints;
        await saveKalshiCursor(nextCursor, hasMore);
        markets = result.markets.map((m) => {
          const rawPrice = (m as any).last_price_dollars ?? m.last_price ?? 0;
          const rawBid = (m as any).yes_bid_dollars ?? m.yes_bid ?? 0;
          const rawAsk = (m as any).yes_ask_dollars ?? m.yes_ask ?? 0;
          // Kalshi liquidity_dollars is often "0" even when open_interest exists.
          // Try open_interest → volume_24h_fp → volume → 0 as fallback chain.
          const rawLiqString = (m as any).liquidity_dollars;
          const rawLiqNum = typeof rawLiqString === 'string' ? Number(rawLiqString) : (typeof rawLiqString === 'number' ? rawLiqString : NaN);
          const hasLiquidity = Number.isFinite(rawLiqNum) && rawLiqNum > 0;
          const rawLiq = hasLiquidity
            ? rawLiqNum
            : ((m as any).open_interest ?? (m as any).volume_24h_fp ?? m.volume ?? 0);
          const price = typeof rawPrice === 'string' ? Number(rawPrice) : (typeof rawPrice === 'number' ? rawPrice : 0);
          const bid = typeof rawBid === 'string' ? Number(rawBid) : (typeof rawBid === 'number' ? rawBid : 0);
          const ask = typeof rawAsk === 'string' ? Number(rawAsk) : (typeof rawAsk === 'number' ? rawAsk : 0);
          const liq = typeof rawLiq === 'string' ? Number(rawLiq) : (typeof rawLiq === 'number' ? rawLiq : 0);
          return {
            externalId: m.ticker,
            title: m.title,
            description: ((m as any).yes_sub_title || m.subtitle || ''),
            category: (m.category || 'other').toLowerCase(),
            venue: 'KALSHI',
            status: m.status === 'active' ? 'ACTIVE' : m.status === 'resolved' ? 'RESOLVED' : 'CLOSED',
            impliedProb: Number.isFinite(price) ? price : 0,
            liquidity: Number.isFinite(liq) ? liq : 0,
            spread: Number.isFinite(ask) && Number.isFinite(bid) ? Math.max(0.01, ask - bid) : 0.05,
            volume24h: Number.isFinite(liq) ? liq : 0,
            bestBid: Number.isFinite(bid) ? bid : undefined,
            bestAsk: Number.isFinite(ask) ? ask : undefined,
            spreadSource: 'REAL_ORDERBOOK',
            resolutionTime: m.close_time || null,
          };
        });
        // Filter out non-active and past-date markets before upsert
        markets = markets.filter(m => m.status === 'ACTIVE');
      } else if (venue === 'SX_BET') {
        cursorStart =
          scanMode === 'RESUME_FROM_CURSOR' || scanMode === 'INCREMENTAL_SCAN'
            ? await loadSxBetCursor()
            : null;
        const result = await getAllSxBetMarkets({
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
        pageFingerprints = result.pageFingerprints;
        await saveSxBetCursor(nextCursor, hasMore);
      } else if (venue === 'MANIFOLD') {
        cursorStart =
          scanMode === 'RESUME_FROM_CURSOR' || scanMode === 'INCREMENTAL_SCAN'
            ? await loadManifoldCursor()
            : null;
        const result = await getAllManifoldMarkets({
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
        pageFingerprints = result.pageFingerprints;
        await saveManifoldCursor(nextCursor, hasMore);
      } else {
        continue;
      }

      // ── Page repeat detection ───────────────────────────────────────────
      const WINDOW_SIZE = 10;
      let repeatedPages = 0;
      const fingerprintCounts = new Map<string, number>();

      for (const fp of pageFingerprints) {
        fingerprintCounts.set(fp, (fingerprintCounts.get(fp) || 0) + 1);
      }

      // Detect repeats: if any fingerprint appears ≥3 times in the window
      for (let i = 0; i < pageFingerprints.length; i++) {
        const windowEnd = Math.min(i + WINDOW_SIZE, pageFingerprints.length);
        const window = pageFingerprints.slice(i, windowEnd);
        const freq = new Map<string, number>();
        for (const fp of window) freq.set(fp, (freq.get(fp) || 0) + 1);
        for (const [fp, count] of freq) {
          if (count >= 3) {
            repeatedPages++;
            if (i === 0 || pageFingerprints[i - 1] !== fp) {
              console.warn(
                `[SCANNER] Repeated page fingerprint detected (${fp.slice(0, 8)}) ` +
                `at page ${i + 1} for ${venue} — cursor may be cycling`,
              );
            }
            break; // count page once even if multiple repeats in window
          }
        }
      }

      const repeatedPageDetected = repeatedPages > 0;
      const pageRepeatRate = pageFingerprints.length > 0
        ? repeatedPages / pageFingerprints.length
        : 0;

      if (pageRepeatRate > 0.25) {
        console.warn(
          `[SCANNER] High page-repeat rate ${(pageRepeatRate * 100).toFixed(1)}% ` +
          `(${repeatedPages}/${pageFingerprints.length} pages) for ${venue}. ` +
          `Cursor may be stale or API returning overlapping pages.`,
        );
      }

      const seenHashes = new Set<string>();

      for (const m of markets) {
        if (enabledCategories.length > 0 && !enabledCategories.includes(m.category)) {
          marketsSkipped++;
          continue;
        }

        const hash = createTitleHash(m.title);
        if (seenHashes.has(hash)) {
          marketsSkipped++;
          continue;
        }
        seenHashes.add(hash);

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
          totalExisting++;
        }

        totalScanned++;
      }

      const denominator = marketsCreated + marketsUpdated;
      const repeatRate = denominator > 0 ? (marketsUpdated / denominator) * 100 : 0;

      await db.scanRun.update({
        where: { id: scanRun.id },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          marketsFetched: markets.length,
          marketsFetchedNew: marketsCreated,
          marketsCreated,
          marketsUpdated,
          marketsSkipped,
          repeatRate,
          cursorStart,
          cursorEnd: nextCursor,
          metadataJson: JSON.stringify({
            scanMode,
            pagesScanned,
            rateLimitMs: scanRateLimitMs,
            timeoutMs: scanTimeoutMs,
            scanUntilNoCursor: scanUntilNoCursor || scanMode === 'FULL_SCAN',
            hasMore,
            repeatedPageDetected,
            pageRepeatRate,
            fingerprintHistory: pageFingerprints.map((fp) => fp.slice(0, 8)),
            fingerprintCounts: Object.fromEntries(
              [...fingerprintCounts.entries()].map(([k, v]) => [k.slice(0, 8), v]),
            ),
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

  return { totalScanned, totalNew, totalExisting, venues: enabledVenues, mode };
}
