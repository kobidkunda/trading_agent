import { describe, expect, it } from 'bun:test';

import { useTradingStore } from '@/store/trading-store';

describe('trading store mode state', () => {
  it('defaults to paper mode with kill switch enabled', () => {
    const state = useTradingStore.getState();

    expect(state.tradingMode).toBe('PAPER');
    expect(state.dataSource).toBe('REAL');
    expect(state.executionMode).toBe('SIMULATED');
    expect(state.globalKillSwitch).toBe(true);
  });

  it('keeps derived flags synchronized when mode changes', () => {
    useTradingStore.getState().setTradingMode('DEMO');
    let state = useTradingStore.getState();
    expect(state.tradingMode).toBe('DEMO');
    expect(state.dataSource).toBe('MOCK');
    expect(state.executionMode).toBe('SIMULATED');
    expect(state.dryRunMode).toBe(true);

    useTradingStore.getState().setTradingMode('LIVE');
    state = useTradingStore.getState();
    expect(state.tradingMode).toBe('LIVE');
    expect(state.dataSource).toBe('REAL');
    expect(state.executionMode).toBe('REAL');
    expect(state.dryRunMode).toBe(false);

    useTradingStore.getState().setTradingMode('PAPER');
  });
});
