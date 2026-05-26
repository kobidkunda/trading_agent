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

export async function updateTradingModeOnBackend(mode: 'DEMO' | 'PAPER' | 'LIVE'): Promise<void> {
  const response = await fetch('/api/trading/mode', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-role': 'Admin',
    },
    body: JSON.stringify({ mode }),
  });

  if (!response.ok) {
    throw new Error('Failed to update trading mode');
  }

  const payload = (await response.json()) as TradingModeApiResponse;
  const normalizedMode = normalizeTradingMode(payload.mode ?? mode);
  const state = useTradingStore.getState();
  state.setTradingMode(normalizedMode);
  if (typeof payload.globalKillSwitch === 'boolean') {
    state.setGlobalKillSwitch(payload.globalKillSwitch);
  }
}

export async function updateGlobalKillSwitchOnBackend(globalKillSwitch: boolean): Promise<void> {
  const response = await fetch('/api/trading/mode', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-role': 'Admin',
    },
    body: JSON.stringify({ globalKillSwitch }),
  });

  if (!response.ok) {
    throw new Error('Failed to update trading kill switch');
  }

  const payload = (await response.json()) as TradingModeApiResponse;
  const state = useTradingStore.getState();
  state.setTradingMode(normalizeTradingMode(payload.mode));
  if (typeof payload.globalKillSwitch === 'boolean') {
    state.setGlobalKillSwitch(payload.globalKillSwitch);
  }
}
