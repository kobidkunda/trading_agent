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

  it('skips markets that resolve beyond the configured window', () => {
    const now = new Date('2026-05-26T00:00:00.000Z');
    const result = computeRisk({
      impliedProbability: 0.5,
      judgeProbability: 0.62,
      confidence: 0.8,
      uncertainty: 0.1,
      fees: 0.01,
      slippage: 0.01,
      venue: 'POLYMARKET',
      category: 'politics',
      dailyExposure: 0,
      categoryExposure: 0,
      openPositions: 0,
      marketLiquidity: 10000,
      marketSpread: 0.01,
      marketResolutionTime: new Date('2026-07-01T00:00:00.000Z'),
      maxResolutionDays: 30,
      now,
    });

    expect(result.action).toBe('SKIP');
    expect(result.reasonCode).toBe('RESOLUTION_TOO_FAR');
  });

  it('allows bids inside the configured resolution window', () => {
    const now = new Date('2026-05-26T00:00:00.000Z');
    const result = computeRisk({
      impliedProbability: 0.5,
      judgeProbability: 0.62,
      confidence: 0.8,
      uncertainty: 0.1,
      fees: 0.01,
      slippage: 0.01,
      venue: 'POLYMARKET',
      category: 'politics',
      dailyExposure: 0,
      categoryExposure: 0,
      openPositions: 0,
      marketLiquidity: 10000,
      marketSpread: 0.01,
      marketResolutionTime: new Date('2026-06-10T00:00:00.000Z'),
      maxResolutionDays: 30,
      now,
    });

    expect(result.action).toBe('BID');
  });

  it('hard-stops zero-liquidity bids even if DB thresholds are loose', () => {
    const result = computeRisk({
      impliedProbability: 0.5,
      judgeProbability: 0.62,
      confidence: 0.95,
      uncertainty: 0.05,
      fees: 0,
      slippage: 0,
      venue: 'POLYMARKET',
      category: 'crypto',
      dailyExposure: 0,
      categoryExposure: 0,
      openPositions: 0,
      minLiquidity: 0,
      marketLiquidity: 0,
      marketSpread: 0.01,
    });

    expect(result.action).toBe('SKIP');
    expect(result.reasonCode).toBe('LOW_LIQUIDITY');
  });

  it('does not allow 31% confidence to become BID', () => {
    const result = computeRisk({
      impliedProbability: 0.5,
      judgeProbability: 0.62,
      confidence: 0.31,
      uncertainty: 0.2,
      fees: 0,
      slippage: 0,
      venue: 'POLYMARKET',
      category: 'crypto',
      dailyExposure: 0,
      categoryExposure: 0,
      openPositions: 0,
      bidConfidenceThreshold: 0.3,
      marketLiquidity: 5000,
      marketSpread: 0.01,
    });

    expect(result.action).not.toBe('BID');
  });

  it('blocks high-uncertainty bids even if DB threshold is loosened', () => {
    const result = computeRisk({
      impliedProbability: 0.5,
      judgeProbability: 0.62,
      confidence: 0.8,
      uncertainty: 0.685,
      fees: 0,
      slippage: 0,
      venue: 'POLYMARKET',
      category: 'crypto',
      dailyExposure: 0,
      categoryExposure: 0,
      openPositions: 0,
      maxUncertaintyThreshold: 0.9,
      marketLiquidity: 5000,
      marketSpread: 0.01,
    });

    expect(result.action).toBe('WATCH');
    expect(result.reasonCode).toBe('HIGH_UNCERTAINTY');
  });

  it('uses supplied effective thresholds for paper order re-checks without bypassing edge floors', () => {
    const defaultResult = computeRisk({
      impliedProbability: 0.001,
      judgeProbability: 0.002,
      confidence: 0.6,
      uncertainty: 0.4,
      fees: 0,
      slippage: 0,
      venue: 'KALSHI',
      category: 'politics',
      dailyExposure: 0,
      categoryExposure: 0,
      openPositions: 0,
      marketLiquidity: 566659,
      marketSpread: 0.001,
    });

    const tinyEdgeConfiguredResult = computeRisk({
      impliedProbability: 0.001,
      judgeProbability: 0.002,
      confidence: 0.6,
      uncertainty: 0.4,
      fees: 0,
      slippage: 0,
      venue: 'KALSHI',
      category: 'politics',
      dailyExposure: 0,
      categoryExposure: 0,
      openPositions: 0,
      minLiquidity: 0,
      maxSpread: 0.05,
      bidEdgeThreshold: 0,
      watchEdgeThreshold: 0.001,
      bidConfidenceThreshold: 0.1,
      watchConfidenceThreshold: 0.1,
      maxUncertaintyThreshold: 1,
      marketLiquidity: 566659,
      marketSpread: 0.001,
    });

    const configuredResult = computeRisk({
      impliedProbability: 0.002,
      judgeProbability: 0.01,
      confidence: 0.85,
      uncertainty: 0.4,
      fees: 0,
      slippage: 0,
      venue: 'KALSHI',
      category: 'politics',
      dailyExposure: 0,
      categoryExposure: 0,
      openPositions: 0,
      minLiquidity: 0,
      maxSpread: 0.05,
      bidEdgeThreshold: 0,
      watchEdgeThreshold: 0.001,
      bidConfidenceThreshold: 0.1,
      watchConfidenceThreshold: 0.1,
      maxUncertaintyThreshold: 1,
      marketLiquidity: 566659,
      marketSpread: 0.001,
    });

    expect(defaultResult.action).toBe('WATCH');
    expect(defaultResult.reasonCode).toBe('HIGH_UNCERTAINTY');
    expect(tinyEdgeConfiguredResult.action).toBe('WATCH');
    expect(tinyEdgeConfiguredResult.reasonCode).toBe('MODERATE_EDGE');
    expect(configuredResult.action).toBe('BID');
  });

  it('blocks bids when cluster exposure breaches utilization threshold', () => {
    const result = computeRisk(
      {
        impliedProbability: 0.5,
        judgeProbability: 0.63,
        confidence: 0.8,
        uncertainty: 0.1,
        fees: 0.01,
        slippage: 0.01,
        venue: 'POLYMARKET',
        category: 'crypto',
        dailyExposure: 0,
        categoryExposure: 0,
        openPositions: 0,
        marketLiquidity: 10000,
        marketSpread: 0.01,
      },
      {
        clusterExposures: [
          {
            clusterId: 'cluster-1',
            clusterType: 'CATEGORY',
            clusterKey: 'crypto',
            label: 'Crypto',
            totalExposure: 9000,
            exposureLimit: 10000,
            maxLoss: null,
            lossToWinRatio: null,
            tailRiskLevel: 'HIGH',
            utilization: 0.9,
            marketCount: 3,
          },
        ],
        clusterOverlapCount: 1,
        tailRiskWarnings: [],
      },
    );

    expect(result.action).toBe('SKIP');
    expect(result.reasonCode).toBe('CLUSTER_EXPOSURE_EXCEEDED');
  });
});
