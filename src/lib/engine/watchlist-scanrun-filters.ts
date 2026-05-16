import type { TradingMode } from '@/lib/engine/mode';
import { shouldDisplayMarketInMode } from '@/lib/engine/market-visibility';

export function filterScanRunsByMode<T extends { mode: string }>(scanRuns: T[], mode: TradingMode): T[] {
  if (mode === 'DEMO') return scanRuns;
  return scanRuns.filter((scanRun) => scanRun.mode === mode);
}

export function filterWatchlistByMode<T extends { market: { externalId: string | null | undefined } }>(watchlist: T[], mode: TradingMode): T[] {
  return watchlist.filter((entry) => shouldDisplayMarketInMode(mode, entry.market.externalId));
}
