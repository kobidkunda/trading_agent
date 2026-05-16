import { describe, expect, it } from 'bun:test';

import { computeRisk } from '../risk';

describe('risk engine configuration', () => {
  it('uses configured thresholds instead of only hardcoded defaults', () => {
    const result = computeRisk({
      impliedProbability: 0.5,
      judgeProbability: 0.62,
      confidence: 0.75,
      uncertainty: 0.2,
      fees: 0.01,
      slippage: 0.01,
      venue: 'POLYMARKET',
      category: 'crypto',
      dailyExposure: 100,
      categoryExposure: 50,
      openPositions: 1,
      minLiquidity: 200,
      maxSpread: 0.08,
      maxPositionSize: 2500,
      maxDailyExposure: 1000,
      maxCategoryExposure: 700,
      remainingMarketCapacity: 120,
      remainingDailyCapacity: 90,
      remainingCategoryCapacity: 80,
      marketLiquidity: 250,
      marketSpread: 0.06,
    });

    expect(result.action).toBe('BID');
    expect(result.adjustedSize).toBe(80);
  });

  it('skips when spread exceeds the configured max spread', () => {
    const result = computeRisk({
      impliedProbability: 0.5,
      judgeProbability: 0.6,
      confidence: 0.8,
      uncertainty: 0.1,
      fees: 0.01,
      slippage: 0.01,
      venue: 'KALSHI',
      category: 'sports',
      dailyExposure: 0,
      categoryExposure: 0,
      openPositions: 0,
      maxSpread: 0.02,
      marketLiquidity: 10000,
      marketSpread: 0.03,
    });

    expect(result.action).toBe('SKIP');
    expect(result.reasonCode).toBe('WIDE_SPREAD');
  });
});
