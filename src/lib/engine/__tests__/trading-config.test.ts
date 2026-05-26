import { describe, expect, it } from 'bun:test';

import { buildTradingConfigUpdate } from '../trading-settings';
import {
  DEFAULT_TRADING_CONFIG,
  getTradingConfigModeState,
  normalizeTradingConfig,
  sanitizeTradingModeUpdate,
} from '../trading-config';

describe('trading config normalization', () => {
  it('fills mode defaults for incomplete strategy settings', () => {
    const config = normalizeTradingConfig({
      enabledVenues: ['POLYMARKET'],
      enabledCategories: ['crypto'],
      minLiquidity: 1500,
    });

    expect(config.mode).toBe('PAPER');
    expect(config.dataSource).toBe('REAL');
    expect(config.executionMode).toBe('SIMULATED');
    expect(config.globalKillSwitch).toBe(true);
    expect(config.scanIntervalMinutes).toBe(5);
    expect(config.candidateThreshold).toBe(20);
  });

  it('normalizes blank Agent-Reach route settings to the local docker service', () => {
    const config = normalizeTradingConfig({
      stageRouting: {
        agentReachEnabled: true,
        agentReachServiceUrl: '',
        agentReachToolName: 'web_read',
      },
    });

    expect(config.stageRouting?.agentReachServiceUrl).toBe('http://localhost:6504');
    expect(config.stageRouting?.agentReachToolName).toBe('research');
  });

  it('derives mode state from config values', () => {
    expect(getTradingConfigModeState({ ...DEFAULT_TRADING_CONFIG, mode: 'DEMO' }).allowMockTemplates).toBe(true);
    expect(getTradingConfigModeState({ ...DEFAULT_TRADING_CONFIG, mode: 'PAPER' }).dataSource).toBe('REAL');
    expect(getTradingConfigModeState({ ...DEFAULT_TRADING_CONFIG, mode: 'LIVE', liveExecutionEnabled: true }).executionMode).toBe('REAL');
  });

  it('sanitizes demo mode updates to mock plus simulated execution', () => {
    const update = sanitizeTradingModeUpdate({ mode: 'DEMO' });

    expect(update).toEqual({
      mode: 'DEMO',
      dataSource: 'MOCK',
      executionMode: 'SIMULATED',
      liveExecutionEnabled: false,
    });
  });

  it('sanitizes paper mode updates to real plus simulated execution', () => {
    const update = sanitizeTradingModeUpdate({ mode: 'PAPER' });

    expect(update).toEqual({
      mode: 'PAPER',
      dataSource: 'REAL',
      executionMode: 'SIMULATED',
      liveExecutionEnabled: false,
    });
  });

  it('keeps live execution disabled until explicitly enabled', () => {
    const update = sanitizeTradingModeUpdate({ mode: 'LIVE' });

    expect(update).toEqual({
      mode: 'LIVE',
      dataSource: 'REAL',
      executionMode: 'REAL',
      liveExecutionEnabled: false,
    });
  });

  it('preserves existing config when only kill switch is updated', () => {
    const update = buildTradingConfigUpdate(
      { globalKillSwitch: false },
      {
        ...DEFAULT_TRADING_CONFIG,
        mode: 'LIVE',
        liveExecutionEnabled: true,
        scanIntervalMinutes: 17,
        candidateThreshold: 42,
      }
    );

    expect(update.tradingConfig.globalKillSwitch).toBe(false);
    expect(update.tradingConfig.mode).toBe('LIVE');
    expect(update.tradingConfig.executionMode).toBe('REAL');
    expect(update.tradingConfig.liveExecutionEnabled).toBe(true);
    expect(update.tradingConfig.scanIntervalMinutes).toBe(17);
    expect(update.tradingConfig.candidateThreshold).toBe(42);
  });
});
