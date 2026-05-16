import { db } from '@/lib/db';
import { getPolymarketMarkets, getAllPolymarketMarkets, savePolymarketCursor } from '@/lib/venues/polymarket';
import { getKalshiMarkets, getAllKalshiMarkets, saveKalshiCursor } from '@/lib/venues/kalshi';
import { getEffectiveTradingConfig, STRATEGY_SETTINGS_KEY, TRADING_CONFIG_KEY, TRADING_MODE_KEY } from '@/lib/engine/trading-settings';
import { upsertScannedMarket } from '@/lib/engine/scanner-upsert';
import { normalizeTradingMode } from '@/lib/engine/mode';

export async function runScanner(
  venues?: string[],
  categories?: string[],
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
      }> = [];

      let marketsCreated = 0;
      let marketsUpdated = 0;
      let marketsSkipped = 0;
      let nextCursor: string | null = null;

      if (venue === 'POLYMARKET') {
        markets = await getAllPolymarketMarkets();
        nextCursor = null;
        await savePolymarketCursor(nextCursor, false);
      } else if (venue === 'KALSHI') {
        const kalshiRaw = await getAllKalshiMarkets();
        nextCursor = null;
        await saveKalshiCursor(nextCursor, false);
        markets = kalshiRaw.map((m) => ({
          externalId: m.ticker,
          title: m.title,
          description: m.subtitle || '',
          category: (m.category || 'other').toLowerCase(),
          venue: 'KALSHI',
          status: m.status === 'active' ? 'ACTIVE' : 'INACTIVE',
          impliedProb: m.last_price / 100,
          liquidity: m.volume,
          spread: Math.max(0.01, (m.yes_ask - m.yes_bid) / 100),
          volume24h: m.volume,
          bestBid: m.yes_bid / 100,
          bestAsk: m.yes_ask / 100,
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
          cursorEnd: nextCursor,
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
