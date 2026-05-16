import { describe, expect, it } from 'bun:test';

import {
  getModeState,
  getModeLabel,
  isTestMode,
  normalizeTradingMode,
  setTestMode,
  setTradingMode,
} from '../mode';

describe('trading mode helpers', () => {
  it('maps demo mode to mock data and simulated execution', () => {
    const state = getModeState('DEMO');

    expect(state.mode).toBe('DEMO');
    expect(state.dataSource).toBe('MOCK');
    expect(state.executionMode).toBe('SIMULATED');
    expect(state.allowMockTemplates).toBe(true);
    expect(state.liveExecutionAllowed).toBe(false);
  });

  it('maps paper mode to real data and simulated execution', () => {
    const state = getModeState('PAPER');

    expect(state.mode).toBe('PAPER');
    expect(state.dataSource).toBe('REAL');
    expect(state.executionMode).toBe('SIMULATED');
    expect(state.allowMockTemplates).toBe(false);
    expect(state.liveExecutionAllowed).toBe(false);
  });

  it('blocks live execution when safety requirements are not satisfied', () => {
    const state = getModeState('LIVE');

    expect(state.mode).toBe('LIVE');
    expect(state.dataSource).toBe('REAL');
    expect(state.executionMode).toBe('REAL');
    expect(state.allowMockTemplates).toBe(false);
    expect(state.liveExecutionAllowed).toBe(false);
  });

  it('treats demo and paper as test mode compatibility paths', () => {
    setTradingMode('DEMO');
    expect(isTestMode()).toBe(true);
    expect(getModeLabel()).toBe('DEMO');

    setTradingMode('PAPER');
    expect(isTestMode()).toBe(true);
    expect(getModeLabel()).toBe('PAPER');

    setTradingMode('LIVE');
    expect(isTestMode()).toBe(false);
    expect(getModeLabel()).toBe('LIVE');

    setTestMode(true);
    expect(getModeLabel()).toBe('PAPER');
  });

  it('normalizes invalid mode values to paper mode', () => {
    expect(normalizeTradingMode('DEMO')).toBe('DEMO');
    expect(normalizeTradingMode('PAPER')).toBe('PAPER');
    expect(normalizeTradingMode('LIVE')).toBe('LIVE');
    expect(normalizeTradingMode('bogus')).toBe('PAPER');
    expect(normalizeTradingMode(undefined)).toBe('PAPER');
  });
});
