import { describe, expect, it } from 'bun:test';

import {
  buildTradingConfigUpdate,
  getEffectiveTradingConfig,
  TRADING_CONFIG_KEY,
  TRADING_MODE_KEY,
} from '../trading-settings';

describe('trading settings helpers', () => {
  it('merges legacy strategy settings into effective trading config', () => {
    const config = getEffectiveTradingConfig({
      strategySettings: {
        enabledVenues: ['KALSHI'],
        enabledCategories: ['sports'],
        minLiquidity: 2500,
        targetEdge: 0.08,
      },
    });

    expect(config.enabledVenues).toEqual(['KALSHI']);
    expect(config.enabledCategories).toEqual(['sports']);
    expect(config.minLiquidity).toBe(2500);
    expect(config.targetEdge).toBe(0.08);
    expect(config.mode).toBe('PAPER');
  });

  it('prefers explicit trading config over legacy settings', () => {
    const config = getEffectiveTradingConfig({
      strategySettings: { enabledVenues: ['KALSHI'] },
      tradingConfig: { enabledVenues: ['POLYMARKET'], mode: 'DEMO' },
    });

    expect(config.enabledVenues).toEqual(['KALSHI']);
    expect(config.mode).toBe('DEMO');
    expect(config.dataSource).toBe('MOCK');
  });

  it('builds config update payload with synchronized legacy and new keys', () => {
    const update = buildTradingConfigUpdate({ mode: 'LIVE', candidateThreshold: 90 });

    expect(update.tradingConfigKey).toBe(TRADING_CONFIG_KEY);
    expect(update.modeKey).toBe(TRADING_MODE_KEY);
    expect(update.tradingConfig.mode).toBe('LIVE');
    expect(update.tradingConfig.executionMode).toBe('REAL');
    expect(update.tradingConfig.candidateThreshold).toBe(90);
    expect(update.strategySettings.dryRun).toBe(false);
  });
});
