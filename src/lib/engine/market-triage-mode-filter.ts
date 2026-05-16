import type { TradingMode } from '@/lib/engine/mode';
import { shouldDisplayMarketInMode } from '@/lib/engine/market-visibility';

export function filterMarketsForMode<T extends { externalId: string | null | undefined }>(
  markets: T[],
  mode: TradingMode,
): T[] {
  return markets.filter((market) => shouldDisplayMarketInMode(mode, market.externalId));
}
