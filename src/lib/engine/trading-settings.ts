import { setTradingMode } from '@/lib/engine/mode';
import { DEFAULT_STRATEGY } from '@/lib/engine/risk';
import {
  DEFAULT_TRADING_CONFIG,
  normalizeTradingConfig,
  sanitizeTradingModeUpdate,
  type TradingConfig,
} from '@/lib/engine/trading-config';
import { normalizeTradingMode } from '@/lib/engine/mode';
import type { StrategySettings } from '@/lib/types';

export const TRADING_CONFIG_KEY = 'trading_config';
export const TRADING_MODE_KEY = 'trading_mode';
export const STRATEGY_SETTINGS_KEY = 'strategy_settings';

export interface EffectiveTradingConfigInput {
  strategySettings?: Partial<StrategySettings> | null;
  tradingConfig?: Partial<TradingConfig> | null;
  tradingMode?: string | null;
}

export function getEffectiveTradingConfig(input: EffectiveTradingConfigInput = {}): TradingConfig {
  const fromStrategy = {
    ...DEFAULT_STRATEGY,
    ...(input.strategySettings ?? {}),
  };

  const merged = normalizeTradingConfig({
    ...fromStrategy,
    ...(input.tradingConfig ?? {}),
    mode: normalizeTradingMode(input.tradingMode ?? input.tradingConfig?.mode ?? undefined),
  });

  setTradingMode(merged.mode);
  return merged;
}

export function buildTradingConfigUpdate(partial: Partial<TradingConfig>) {
  const tradingConfig = normalizeTradingConfig({
    ...DEFAULT_TRADING_CONFIG,
    ...partial,
    ...sanitizeTradingModeUpdate(partial),
  });

  const strategySettings: StrategySettings = {
    ...DEFAULT_STRATEGY,
    enabledVenues: tradingConfig.enabledVenues,
    enabledCategories: tradingConfig.enabledCategories,
    minLiquidity: tradingConfig.minLiquidity,
    targetEdge: tradingConfig.targetEdge,
    maxSpread: tradingConfig.maxSpread,
    maxExposurePerMarket: tradingConfig.maxExposurePerMarket,
    maxDailyExposure: tradingConfig.maxDailyExposure,
    maxCategoryExposure: tradingConfig.maxCategoryExposure,
    researchEscalationThreshold: tradingConfig.researchEscalationThreshold,
    dryRun: tradingConfig.mode !== 'LIVE',
    promptVersion: tradingConfig.promptVersion,
    defaultModel: tradingConfig.defaultModel,
    triageModel: tradingConfig.triageModel,
    researchModel: tradingConfig.researchModel,
    judgeModel: tradingConfig.judgeModel,
    stageRouting: tradingConfig.stageRouting,
  };

  return {
    tradingConfigKey: TRADING_CONFIG_KEY,
    modeKey: TRADING_MODE_KEY,
    strategyKey: STRATEGY_SETTINGS_KEY,
    tradingConfig,
    strategySettings,
    modeValue: tradingConfig.mode,
  };
}
