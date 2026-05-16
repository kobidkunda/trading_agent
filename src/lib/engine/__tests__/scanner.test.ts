import { describe, expect, it } from 'bun:test';

import { classifyCandidateScore, computeCandidateScore } from '../candidate-scoring';
import { createTitleHash, normalizeMarketTitle, shouldSkipCandidate } from '../candidate-dedupe';

describe('scanner primitives', () => {
  it('normalizes title and computes a stable hash for duplicate detection', () => {
    const title = 'Will Bitcoin exceed $100,000 by end of 2026?';

    expect(normalizeMarketTitle(title)).toBe('will bitcoin exceed 100000 by end of 2026');
    expect(createTitleHash(title)).toBe('c38799e991bc967a665f534c1712af78d2ca3ca66a20d8c81acbc82dba3e9e8e');
  });

  it('classifies weak scanner candidates as skip', () => {
    const breakdown = computeCandidateScore({
      liquidity: 10000,
      spread: 0.01,
      volume24h: 9000,
      freshnessMinutes: 0,
      priceMovePercent: 0,
      categoryPriority: 5,
      duplicatePenalty: 0,
      stalePenalty: 0,
      alreadyProcessedPenalty: 0,
    });

    expect(breakdown.totalScore).toBe(36.9);
    expect(classifyCandidateScore(breakdown.totalScore)).toBe('SKIP');
  });

  it('suppresses reprocessing when cooldown remains active and price has not moved', () => {
    const decision = shouldSkipCandidate({
      venue: 'POLYMARKET',
      externalId: 'poly-1',
      normalizedTitle: normalizeMarketTitle('Polymarket sample'),
      titleHash: createTitleHash('Polymarket sample'),
      resolutionTime: '2026-12-31T00:00:00.000Z',
      existingMarket: null,
      existingCandidate: {
        stage: 'RESEARCHING',
        cooldownUntil: '2026-05-15T12:00:00.000Z',
        nextEligibleAt: '2026-05-15T12:00:00.000Z',
        lockExpiresAt: '2026-05-15T11:00:00.000Z',
      },
      now: '2026-05-15T10:00:00.000Z',
      priceChangeThreshold: 0.03,
      currentProbability: 0.57,
      previousProbability: 0.57,
    });

    expect(decision).toEqual({
      skip: true,
      reason: 'PROCESSING_LOCKED',
    });
  });
});
