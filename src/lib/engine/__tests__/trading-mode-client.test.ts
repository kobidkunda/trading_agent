import { beforeEach, describe, expect, it, mock } from 'bun:test';

const fetchMock = mock(async () => ({
  ok: true,
  json: async () => ({
    mode: 'DEMO',
    dataSource: 'MOCK',
    executionMode: 'SIMULATED',
    globalKillSwitch: true,
  }),
}));

describe('trading mode client sync', () => {
  beforeEach(() => {
    fetchMock.mockClear();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it('hydrates zustand mode state from backend response', async () => {
    const { useTradingStore } = await import('@/store/trading-store');
    const { syncTradingModeFromBackend } = await import('../trading-mode-client');

    useTradingStore.setState({
      tradingMode: 'PAPER',
      dataSource: 'REAL',
      executionMode: 'SIMULATED',
      dryRunMode: true,
      globalKillSwitch: false,
    });

    await syncTradingModeFromBackend();

    const state = useTradingStore.getState();
    expect(state.tradingMode).toBe('DEMO');
    expect(state.dataSource).toBe('MOCK');
    expect(state.executionMode).toBe('SIMULATED');
    expect(state.globalKillSwitch).toBe(true);
  });
});
