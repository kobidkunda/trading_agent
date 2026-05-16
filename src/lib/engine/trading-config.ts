import { DEFAULT_STRATEGY } from '@/lib/engine/risk';
import { getModeState, normalizeTradingMode, type DataSource, type ExecutionMode, type TradingMode } from '@/lib/engine/mode';
import type { StrategySettings } from '@/lib/types';

export interface TradingConfig extends StrategySettings {
  mode: TradingMode;
  dataSource: DataSource;
  executionMode: ExecutionMode;
  globalKillSwitch: boolean;
  scanIntervalMinutes: number;
  candidateThreshold: number;
  researchCooldownMinutes: number;
  maxResearchJobsPerCycle: number;
  paperFillModel: 'INSTANT' | 'BOOK_AWARE';
  maxPaperPositionSize: number;
  liveExecutionEnabled: boolean;
}

export const DEFAULT_TRADING_CONFIG: TradingConfig = {
  ...DEFAULT_STRATEGY,
  mode: 'PAPER',
  dataSource: 'REAL',
  executionMode: 'SIMULATED',
  globalKillSwitch: true,
  scanIntervalMinutes: 5,
  candidateThreshold: 75,
  researchCooldownMinutes: 360,
  maxResearchJobsPerCycle: 5,
  paperFillModel: 'BOOK_AWARE',
  maxPaperPositionSize: DEFAULT_STRATEGY.maxExposurePerMarket,
  liveExecutionEnabled: false,
};

export function normalizeTradingConfig(input: Partial<TradingConfig | StrategySettings>): TradingConfig {
  const merged = {
    ...DEFAULT_TRADING_CONFIG,
    ...input,
  } as TradingConfig;

  const mode = normalizeTradingMode((input as Partial<TradingConfig>).mode);
  const modeState = getModeState(mode);

  return {
    ...merged,
    mode,
    dataSource: modeState.dataSource,
    executionMode: modeState.executionMode,
    liveExecutionEnabled: mode === 'LIVE' ? Boolean((input as Partial<TradingConfig>).liveExecutionEnabled) : false,
  };
}

export function getTradingConfigModeState(config: Partial<TradingConfig>): ReturnType<typeof getModeState> {
  return getModeState(normalizeTradingMode(config.mode));
}

export function sanitizeTradingModeUpdate(update: Partial<TradingConfig>): Pick<TradingConfig, 'mode' | 'dataSource' | 'executionMode' | 'liveExecutionEnabled'> {
  const mode = normalizeTradingMode(update.mode);
  const modeState = getModeState(mode);

  return {
    mode,
    dataSource: modeState.dataSource,
    executionMode: modeState.executionMode,
    liveExecutionEnabled: mode === 'LIVE' ? Boolean(update.liveExecutionEnabled) : false,
  };
}
