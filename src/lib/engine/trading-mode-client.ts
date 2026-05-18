import { normalizeTradingMode } from '@/lib/engine/mode';
import { useTradingStore } from '@/store/trading-store';

interface TradingModeApiResponse {
  mode?: string;
  dataSource?: 'MOCK' | 'REAL';
  executionMode?: 'SIMULATED' | 'REAL';
  globalKillSwitch?: boolean;
}

export async function syncTradingModeFromBackend(): Promise<void> {
  const response = await fetch('/api/trading/mode', { cache: 'no-store', headers: { 'x-role': 'Admin' } });
  if (!response.ok) {
    throw new Error('Failed to load trading mode');
  }

  const payload = (await response.json()) as TradingModeApiResponse;
  const mode = normalizeTradingMode(payload.mode);
  const state = useTradingStore.getState();

  state.setTradingMode(mode);
  if (typeof payload.globalKillSwitch === 'boolean') {
    state.setGlobalKillSwitch(payload.globalKillSwitch);
  }
}
