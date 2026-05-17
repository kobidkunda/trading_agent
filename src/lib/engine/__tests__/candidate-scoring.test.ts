import { describe, expect, it } from 'bun:test';

import {
  classifyCandidateScore,
  computeCandidateScore,
  type CandidateScoreInput,
} from '../candidate-scoring';

describe('candidate scoring', () => {
  it('penalizes low liquidity and wide spreads', () => {
    const weak: CandidateScoreInput = {
      liquidity: 400,
      spread: 0.12,
      volume24h: 200,
      freshnessMinutes: 90,
      priceMovePercent: 0.5,
      categoryPriority: 0,
      duplicatePenalty: 8,
      stalePenalty: 10,
      alreadyProcessedPenalty: 15,
    };

    const result = computeCandidateScore(weak);
    expect(result.totalScore).toBeLessThan(50);
    expect(classifyCandidateScore(result.totalScore)).toBe('SKIP');
    expect(result.rejectedCriteria.length).toBeGreaterThan(0);
    expect(result.skipReason).toContain('Score too low');
  });

  it('rewards fresh liquid markets with good spreads', () => {
    const strong: CandidateScoreInput = {
      liquidity: 180000,
      spread: 0.005,
      volume24h: 180000,
      freshnessMinutes: 2,
      priceMovePercent: 5,
      categoryPriority: 9,
      duplicatePenalty: 0,
      stalePenalty: 0,
      alreadyProcessedPenalty: 0,
    };

    const result = computeCandidateScore(strong);
    expect(result.totalScore).toBeGreaterThanOrEqual(75);
    expect(classifyCandidateScore(result.totalScore)).toBe('TRIAGE');
    expect(result.acceptedCriteria).toContain('LIQUIDITY');
    expect(result.acceptedCriteria).toContain('SPREAD');
  });

  it('classifies elite scores for full research and judge path', () => {
    const elite: CandidateScoreInput = {
      liquidity: 250000,
      spread: 0.005,
      volume24h: 240000,
      freshnessMinutes: 1,
      priceMovePercent: 6,
      categoryPriority: 10,
      duplicatePenalty: 0,
      stalePenalty: 0,
      alreadyProcessedPenalty: 0,
    };

    const result = computeCandidateScore(elite);
    expect(result.totalScore).toBeGreaterThanOrEqual(85);
    expect(classifyCandidateScore(result.totalScore)).toBe('TRIAGE_AND_RESEARCH');
    expect(result.skipReason).toBe('');
    expect(result.rejectedCriteria).not.toContain('ORACLE_RISK');
  });

  it('incorporates signal scores (edge, confidence, wallet) and penalties', () => {
    const signal: CandidateScoreInput = {
      liquidity: 100000,
      spread: 0.01,
      volume24h: 100000,
      freshnessMinutes: 5,
      priceMovePercent: 3,
      categoryPriority: 5,
      adjustedEdge: 0.06,
      confidence: 0.8,
      walletSignalScore: 15,
      relatedMarketSignalScore: 10,
      sourceQuality: 70,
      resolutionClarity: 60,
      duplicatePenalty: 0,
      stalePenalty: 0,
      alreadyProcessedPenalty: 0,
      uncertaintyPenalty: 0.1,
      contradictionPenalty: 0.2,
      oracleRiskLevel: 'MEDIUM',
      correlationRiskPenalty: 5,
      manipulationRiskPenalty: 5,
    };

    const result = computeCandidateScore(signal);
    expect(result.edgeScore).toBeGreaterThan(0);
    expect(result.confidenceScore).toBeGreaterThan(0);
    expect(result.walletSignalScore).toBeGreaterThan(0);
    expect(result.relatedMarketSignalScore).toBeGreaterThan(0);
    expect(result.oracleRiskPenalty).toBe(3);
    expect(result.totalScore).toBeGreaterThan(50);
    expect(result.acceptedCriteria).toContain('EDGE');
    expect(result.acceptedCriteria).toContain('CONFIDENCE');
    expect(result.rejectedCriteria).toContain('ORACLE_RISK');
  });

  it('handles BLOCK-level oracle risk with severe penalty', () => {
    const block: CandidateScoreInput = {
      liquidity: 200000,
      spread: 0.005,
      volume24h: 200000,
      freshnessMinutes: 1,
      priceMovePercent: 5,
      categoryPriority: 10,
      oracleRiskLevel: 'BLOCK',
      duplicatePenalty: 0,
      stalePenalty: 0,
      alreadyProcessedPenalty: 0,
    };

    const result = computeCandidateScore(block);
    expect(result.oracleRiskPenalty).toBe(20);
    expect(result.rejectedCriteria).toContain('ORACLE_RISK');
  });

  it('returns acceptedCriteria and rejectedCriteria arrays', () => {
    const input: CandidateScoreInput = {
      liquidity: 500,
      spread: 0.15,
      volume24h: 100,
      freshnessMinutes: 100,
      priceMovePercent: 0.1,
      categoryPriority: 0,
      duplicatePenalty: 10,
      stalePenalty: 10,
      alreadyProcessedPenalty: 20,
    };

    const result = computeCandidateScore(input);
    expect(result.acceptedCriteria).toEqual([]);
    expect(result.rejectedCriteria).toContain('DUPLICATE');
    expect(result.rejectedCriteria).toContain('STALE');
    expect(result.rejectedCriteria).toContain('ALREADY_PROCESSED');
    expect(result.skipReason).toBeTruthy();
  });

  it('handles orderbook quality as penalty', () => {
    const poorOrderbook: CandidateScoreInput = {
      liquidity: 100000,
      spread: 0.01,
      volume24h: 100000,
      freshnessMinutes: 5,
      priceMovePercent: 3,
      categoryPriority: 5,
      orderbookQuality: 3,
      duplicatePenalty: 0,
      stalePenalty: 0,
      alreadyProcessedPenalty: 0,
    };

    const result = computeCandidateScore(poorOrderbook);
    expect(result.orderbookQualityPenalty).toBeGreaterThan(5);
    expect(result.rejectedCriteria).toContain('ORDERBOOK_QUALITY');
  });
});
