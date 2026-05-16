import type { TradingMode } from '@/lib/engine/mode';

export function isDemoGeneratedExternalId(externalId: string | null | undefined): boolean {
  if (!externalId) return false;
  return externalId.startsWith('live_') || externalId.startsWith('sim_');
}

export function shouldDisplayMarketInMode(mode: TradingMode, externalId: string | null | undefined): boolean {
  if (mode === 'DEMO') return true;
  return !isDemoGeneratedExternalId(externalId);
}
