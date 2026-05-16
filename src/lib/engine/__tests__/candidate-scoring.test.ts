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

    expect(computeCandidateScore(weak).totalScore).toBeLessThan(50);
    expect(classifyCandidateScore(computeCandidateScore(weak).totalScore)).toBe('SKIP');
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

    expect(computeCandidateScore(strong).totalScore).toBeGreaterThanOrEqual(85);
    expect(classifyCandidateScore(computeCandidateScore(strong).totalScore)).toBe('TRIAGE_AND_RESEARCH');
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

    expect(computeCandidateScore(elite).totalScore).toBeGreaterThanOrEqual(90);
    expect(classifyCandidateScore(computeCandidateScore(elite).totalScore)).toBe('FULL_RESEARCH');
  });
});
