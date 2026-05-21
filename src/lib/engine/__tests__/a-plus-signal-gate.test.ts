import { describe, expect, it } from 'bun:test';

import { evaluateAPlusSignalGate } from '../a-plus/signal-gate';
import type { APlusGateInput } from '../a-plus/signal-gate';
import { DEFAULT_APLUS_CONFIG } from '@/lib/constants';
import type { APlusSignalConfig } from '@/lib/types';

function makePassingInput(overrides: Partial<APlusGateInput> = {}): APlusGateInput {
  return {
    candidateScore: 95,
    adjustedEdge: 0.10,
    confidence: 0.85,
    resolutionClarity: 0.90,
    spread: 0.01,
    liquidity: 100_000,
    category: 'crypto',
    modelDisagreement: 0.05,
    oracleRiskScore: 0.05,
    tailRiskScore: 0.02,
    correlationExposure: 0.10,
    orderbookQuality: 15,
    dataSource: 'REAL',
    spreadSource: 'REAL_ORDERBOOK',
    bestBid: 0.65,
    bestAsk: 0.70,
    fillProbability: 0.90,
    priceImpact: 0.02,
    oracleCheckPresent: true,
    orderbookAgeSeconds: 30,
    ...overrides,
  };
}

describe('evaluateAPlusSignalGate', () => {
  it('passes when all criteria are satisfied', () => {
    const result = evaluateAPlusSignalGate(makePassingInput());
    expect(result.passed).toBe(true);
    expect(result.reasons).toEqual([]);
    expect(result.blocker).toBe(false);
  });

  it('fails when candidateScore below minCandidateScore', () => {
    const input = makePassingInput({ candidateScore: 80 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons[0]).toContain('candidateScore');
    expect(result.reasons[0]).toContain('80');
    expect(result.reasons[0]).toContain('90');
    expect(result.blocker).toBe(false);
  });

  it('fails when adjustedEdge below minAdjustedEdge', () => {
    const input = makePassingInput({ adjustedEdge: 0.05 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('adjustedEdge'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('5.0%'))).toBe(true);
    expect(result.blocker).toBe(false);
  });

  it('fails when confidence below minConfidence', () => {
    const input = makePassingInput({ confidence: 0.60 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('confidence'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('60.0%'))).toBe(true);
    expect(result.blocker).toBe(false);
  });

  it('fails when resolutionClarity below minResolutionClarity', () => {
    const input = makePassingInput({ resolutionClarity: 0.70 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('resolutionClarity'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('70.0%'))).toBe(true);
    expect(result.blocker).toBe(false);
  });

  it('fails when spread exceeds maxSpread', () => {
    const input = makePassingInput({ spread: 0.05 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('spread'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('5.00%'))).toBe(true);
    expect(result.blocker).toBe(false);
  });

  it('fails when liquidity below category minimum', () => {
    const input = makePassingInput({ liquidity: 10_000, category: 'crypto' });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('liquidity'))).toBe(true);
    expect(result.blocker).toBe(false);
  });

  it('fails when modelDisagreement exceeds maxModelDisagreement', () => {
    const input = makePassingInput({ modelDisagreement: 0.25 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('modelDisagreement'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('25.0%'))).toBe(true);
    expect(result.blocker).toBe(true);
  });

  it('fails when tailRiskScore exceeds maxTailRisk', () => {
    const input = makePassingInput({ tailRiskScore: 0.20 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('tailRiskScore'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('20.0%'))).toBe(true);
    expect(result.blocker).toBe(false);
  });

  it('fails when oracleRiskScore exceeds maxOracleRisk', () => {
    const input = makePassingInput({ oracleRiskScore: 0.30 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('oracleRiskScore'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('30.0%'))).toBe(true);
    expect(result.blocker).toBe(true);
  });

  it('fails when correlationExposure exceeds maxCorrelationExposure', () => {
    const input = makePassingInput({ correlationExposure: 0.50 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('correlationExposure'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('50.0%'))).toBe(true);
    expect(result.blocker).toBe(false);
  });

  it('fails when orderbookQuality below 12', () => {
    const input = makePassingInput({ orderbookQuality: 5 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('orderbookQuality'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('5.0'))).toBe(true);
    expect(result.blocker).toBe(false);
  });

  it('fails when dataSource is not REAL', () => {
    const input = makePassingInput({ dataSource: 'MOCK' });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('dataSource'))).toBe(true);
    expect(result.blocker).toBe(true);
  });

  it('fails when oracleCheckPresent is false', () => {
    const input = makePassingInput({ oracleCheckPresent: false });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('oracleCheck'))).toBe(true);
    expect(result.blocker).toBe(false);
  });

  it('fails when spreadSource is not REAL_ORDERBOOK', () => {
    const input = makePassingInput({ spreadSource: 'ESTIMATED' });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('ORDERBOOK_ESTIMATED'))).toBe(true);
    expect(result.blocker).toBe(true);
  });

  it('fails when bestBid is null', () => {
    const input = makePassingInput({ bestBid: null });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('ORDERBOOK_MISSING_BID_ASK'))).toBe(true);
    expect(result.blocker).toBe(true);
  });

  it('fails when bestAsk is undefined', () => {
    const input = makePassingInput({ bestAsk: undefined });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('ORDERBOOK_MISSING_BID_ASK'))).toBe(true);
    expect(result.blocker).toBe(true);
  });

  it('fails when orderbookAgeSeconds exceeds maxOrderbookAgeSeconds', () => {
    const input = makePassingInput({ orderbookAgeSeconds: 600 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('ORDERBOOK_STALE'))).toBe(true);
    expect(result.blocker).toBe(true);
  });

  it('fails when fillProbability is null', () => {
    const input = makePassingInput({ fillProbability: null });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('ORDERBOOK_MISSING_FILL_PROB'))).toBe(true);
    expect(result.blocker).toBe(true);
  });

  it('fails when priceImpact is null', () => {
    const input = makePassingInput({ priceImpact: null });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.includes('ORDERBOOK_MISSING_PRICE_IMPACT'))).toBe(true);
    expect(result.blocker).toBe(true);
  });

  it('uses custom config when provided', () => {
    const customConfig: APlusSignalConfig = {
      ...DEFAULT_APLUS_CONFIG,
      minCandidateScore: 70,
      minAdjustedEdge: 0.03,
    };
    const input = makePassingInput({
      candidateScore: 80,
      adjustedEdge: 0.04,
    });
    const result = evaluateAPlusSignalGate(input, customConfig);
    expect(result.passed).toBe(true);
  });

  it('reports all reasons when multiple criteria fail simultaneously', () => {
    const input = makePassingInput({
      candidateScore: 50,
      adjustedEdge: 0.02,
      confidence: 0.30,
      spread: 0.10,
    });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    expect(result.reasons.filter((r) => r.startsWith('candidateScore')).length).toBe(1);
    expect(result.reasons.filter((r) => r.startsWith('adjustedEdge')).length).toBe(1);
    expect(result.reasons.filter((r) => r.startsWith('confidence')).length).toBe(1);
    expect(result.reasons.filter((r) => r.startsWith('spread')).length).toBe(1);
  });

  it('contains all relevant orderbook reasons when orderbook data completely missing', () => {
    const input = makePassingInput({
      spreadSource: 'ESTIMATED',
      bestBid: null,
      bestAsk: null,
      fillProbability: null,
      priceImpact: null,
    });
    const result = evaluateAPlusSignalGate(input);
    expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    expect(result.reasons.some((r) => r.includes('ORDERBOOK_ESTIMATED'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('ORDERBOOK_MISSING_BID_ASK'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('ORDERBOOK_MISSING_FILL_PROB'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('ORDERBOOK_MISSING_PRICE_IMPACT'))).toBe(true);
    expect(result.blocker).toBe(true);
  });

  it('sets blocker=true when a critical criterion fails', () => {
    const input = makePassingInput({ spreadSource: 'ESTIMATED' });
    const result = evaluateAPlusSignalGate(input);
    expect(result.blocker).toBe(true);
  });

  it('passes when candidateScore exactly equals minCandidateScore', () => {
    const input = makePassingInput({ candidateScore: 90 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(true);
  });

  it('passes when adjustedEdge exactly equals minAdjustedEdge', () => {
    const input = makePassingInput({ adjustedEdge: 0.07 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(true);
  });

  it('passes when confidence exactly equals minConfidence', () => {
    const input = makePassingInput({ confidence: 0.75 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(true);
  });

  it('passes when spread exactly equals maxSpread', () => {
    const input = makePassingInput({ spread: 0.03 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(true);
  });

  it('passes when orderbookAgeSeconds exactly equals maxOrderbookAgeSeconds', () => {
    const input = makePassingInput({ orderbookAgeSeconds: 300 });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(true);
  });

  it('handles missing orderbookAgeSeconds gracefully', () => {
    const input = makePassingInput({ orderbookAgeSeconds: undefined });
    const result = evaluateAPlusSignalGate(input);
    expect(result.reasons.some((r) => r.includes('ORDERBOOK_STALE'))).toBe(false);
    expect(result.passed).toBe(true);
  });

  it('handles undefined oracleCheckPresent gracefully', () => {
    const input = makePassingInput({ oracleCheckPresent: undefined });
    const result = evaluateAPlusSignalGate(input);
    expect(result.reasons.some((r) => r.includes('oracleCheck'))).toBe(false);
    expect(result.passed).toBe(true);
  });

  it('fails when liquidity below category minimum for politics', () => {
    const input = makePassingInput({ liquidity: 10_000, category: 'politics' });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('liquidity'))).toBe(true);
  });

  it('fails when liquidity below category minimum for sports', () => {
    const input = makePassingInput({ liquidity: 5_000, category: 'sports' });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('liquidity'))).toBe(true);
  });

  it('uses default liquidity floor for unknown category', () => {
    const input = makePassingInput({ liquidity: 5_000, category: 'science' });
    const result = evaluateAPlusSignalGate(input);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('liquidity'))).toBe(true);
  });

  it('respects tighter custom maxSpread', () => {
    const tightConfig: APlusSignalConfig = {
      ...DEFAULT_APLUS_CONFIG,
      maxSpread: 0.005,
    };
    const input = makePassingInput({ spread: 0.02 });
    const result = evaluateAPlusSignalGate(input, tightConfig);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('spread'))).toBe(true);
  });

  it('respects custom minLiquidityByCategory', () => {
    const customConfig: APlusSignalConfig = {
      ...DEFAULT_APLUS_CONFIG,
      minLiquidityByCategory: { crypto: 200_000 },
    };
    const input = makePassingInput({ liquidity: 100_000, category: 'crypto' });
    const result = evaluateAPlusSignalGate(input, customConfig);
    expect(result.passed).toBe(false);
    expect(result.reasons.some((r) => r.startsWith('liquidity'))).toBe(true);
  });
});