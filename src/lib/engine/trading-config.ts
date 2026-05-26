import type { FillModel, ScanMode, StrategySettings } from '@/lib/types';
import { DEFAULT_STAGE_ROUTING, DEFAULT_STRATEGY } from '@/lib/engine/risk';
import { getModeState, normalizeTradingMode, type DataSource, type ExecutionMode, type TradingMode } from '@/lib/engine/mode';

export interface TradingConfig extends StrategySettings {
  mode: TradingMode;
  dataSource: DataSource;
  executionMode: ExecutionMode;
  globalKillSwitch: boolean;
  scanIntervalMinutes: number;
  candidateThreshold: number;
  researchCooldownMinutes: number;
  maxResearchJobsPerCycle: number;
  paperFillModel: FillModel;
  maxPaperPositionSize: number;
  liveExecutionEnabled: boolean;
  scanMode: ScanMode;
  maxPagesPerVenue: number;
  scanUntilNoCursor: boolean;
  maxMarketsPerScan: number;
  scanRateLimitMs: number;
  scanTimeoutMs: number;
  orderExpiryMinutes: number;
  maxResolutionDays: number;
}

export const DEFAULT_TRADING_CONFIG: TradingConfig = {
  ...DEFAULT_STRATEGY,
  mode: 'PAPER',
  dataSource: 'REAL',
  executionMode: 'SIMULATED',
  globalKillSwitch: true,
  scanIntervalMinutes: 5,
  candidateThreshold: 20,
  researchCooldownMinutes: 360,
  maxResearchJobsPerCycle: 5,
  paperFillModel: 'CONSERVATIVE_PAPER',
  maxPaperPositionSize: DEFAULT_STRATEGY.maxExposurePerMarket,
  liveExecutionEnabled: false,
  scanMode: DEFAULT_STRATEGY.scanMode ?? 'INCREMENTAL_SCAN',
  maxPagesPerVenue: DEFAULT_STRATEGY.maxPagesPerVenue ?? 10,
  scanUntilNoCursor: DEFAULT_STRATEGY.scanUntilNoCursor ?? false,
  maxMarketsPerScan: DEFAULT_STRATEGY.maxMarketsPerScan ?? 500,
  scanRateLimitMs: DEFAULT_STRATEGY.scanRateLimitMs ?? 500,
  scanTimeoutMs: DEFAULT_STRATEGY.scanTimeoutMs ?? 15000,
  orderExpiryMinutes: DEFAULT_STRATEGY.orderExpiryMinutes ?? 1440,
  maxResolutionDays: DEFAULT_STRATEGY.maxResolutionDays ?? 30,
};

export function normalizeTradingConfig(input: Partial<TradingConfig | StrategySettings>): TradingConfig {
  const inputStageRouting = (input as Partial<TradingConfig | StrategySettings>).stageRouting ?? {};
  const stageRouting = {
    ...DEFAULT_STAGE_ROUTING,
    ...inputStageRouting,
  };
  if (!stageRouting.agentReachServiceUrl?.trim()) {
    stageRouting.agentReachServiceUrl = DEFAULT_STAGE_ROUTING.agentReachServiceUrl;
  }
  if (stageRouting.agentReachToolName === 'web_read') {
    stageRouting.agentReachToolName = DEFAULT_STAGE_ROUTING.agentReachToolName;
  }

  const merged = {
    ...DEFAULT_TRADING_CONFIG,
    ...input,
    stageRouting,
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
