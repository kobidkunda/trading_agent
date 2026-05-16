import type { TradingMode } from '@/lib/engine/mode';

export function getPipelineModeSummary(mode: TradingMode) {
  if (mode === 'DEMO') {
    return {
      title: 'DEMO mode',
      dataSource: 'MOCK',
      executionMode: 'SIMULATED',
      warning: 'Mock templates only. Do not treat results as real trading signals.',
    };
  }

  if (mode === 'LIVE') {
    return {
      title: 'LIVE mode',
      dataSource: 'REAL',
      executionMode: 'REAL',
      warning: 'Safety-gated live execution path.',
    };
  }

  return {
    title: 'PAPER mode',
    dataSource: 'REAL',
    executionMode: 'SIMULATED',
    warning: 'Real venue data with simulated execution.',
  };
}
