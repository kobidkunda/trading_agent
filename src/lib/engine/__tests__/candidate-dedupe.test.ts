import { describe, expect, it } from 'bun:test';

import {
  createTitleHash,
  hasMeaningfulPriceMove,
  normalizeMarketTitle,
  shouldSkipCandidate,
  type CandidateDedupeInput,
} from '../candidate-dedupe';

describe('candidate dedupe', () => {
  it('normalizes noisy titles into stable comparison keys', () => {
    expect(normalizeMarketTitle('  Will Bitcoin exceed $100,000 by end of 2026? 🚀 ')).toBe(
      'will bitcoin exceed 100000 by end of 2026',
    );
    expect(normalizeMarketTitle('Will  Bitcoin  exceed $100,000 by end of 2026')).toBe(
      'will bitcoin exceed 100000 by end of 2026',
    );
  });

  it('generates stable hashes for normalized titles', () => {
    expect(createTitleHash('Will Bitcoin exceed $100,000 by end of 2026?')).toBe(
      createTitleHash('Will  Bitcoin exceed 100000 by end of 2026'),
    );
  });

  it('skips candidate when exact venue/externalId already exists', () => {
    const input: CandidateDedupeInput = {
      venue: 'POLYMARKET',
      externalId: 'btc-2026',
      normalizedTitle: normalizeMarketTitle('Will Bitcoin exceed $100,000 by end of 2026?'),
      titleHash: createTitleHash('Will Bitcoin exceed $100,000 by end of 2026?'),
      resolutionTime: '2026-12-31T00:00:00.000Z',
      existingMarket: { venue: 'POLYMARKET', externalId: 'btc-2026' },
      existingCandidate: null,
      now: '2026-05-15T00:00:00.000Z',
      priceChangeThreshold: 0.03,
      currentProbability: 0.61,
      previousProbability: 0.61,
    };

    expect(shouldSkipCandidate(input)).toEqual({
      skip: true,
      reason: 'DUPLICATE_MARKET',
    });
  });

  it('skips candidate during cooldown without meaningful price move', () => {
    const input: CandidateDedupeInput = {
      venue: 'POLYMARKET',
      externalId: 'btc-2026',
      normalizedTitle: normalizeMarketTitle('Will Bitcoin exceed $100,000 by end of 2026?'),
      titleHash: createTitleHash('Will Bitcoin exceed $100,000 by end of 2026?'),
      resolutionTime: '2026-12-31T00:00:00.000Z',
      existingMarket: null,
      existingCandidate: {
        stage: 'EXECUTED',
        cooldownUntil: '2026-05-15T06:00:00.000Z',
        nextEligibleAt: '2026-05-15T06:00:00.000Z',
        lockExpiresAt: null,
      },
      now: '2026-05-15T02:00:00.000Z',
      priceChangeThreshold: 0.03,
      currentProbability: 0.62,
      previousProbability: 0.61,
    };

    expect(shouldSkipCandidate(input)).toEqual({
      skip: true,
      reason: 'COOLDOWN_ACTIVE',
    });
  });

  it('allows reprocessing when price moves past threshold', () => {
    expect(hasMeaningfulPriceMove(0.61, 0.66, 0.03)).toBe(true);

    const input: CandidateDedupeInput = {
      venue: 'POLYMARKET',
      externalId: 'btc-2026',
      normalizedTitle: normalizeMarketTitle('Will Bitcoin exceed $100,000 by end of 2026?'),
      titleHash: createTitleHash('Will Bitcoin exceed $100,000 by end of 2026?'),
      resolutionTime: '2026-12-31T00:00:00.000Z',
      existingMarket: null,
      existingCandidate: {
        stage: 'EXECUTED',
        cooldownUntil: '2026-05-15T06:00:00.000Z',
        nextEligibleAt: '2026-05-15T06:00:00.000Z',
        lockExpiresAt: null,
      },
      now: '2026-05-15T02:00:00.000Z',
      priceChangeThreshold: 0.03,
      currentProbability: 0.66,
      previousProbability: 0.61,
    };

    expect(shouldSkipCandidate(input)).toEqual({
      skip: false,
      reason: null,
    });
  });

  it('skips candidates that are already locked in researching stage', () => {
    const input: CandidateDedupeInput = {
      venue: 'POLYMARKET',
      externalId: 'btc-2026',
      normalizedTitle: normalizeMarketTitle('Will Bitcoin exceed $100,000 by end of 2026?'),
      titleHash: createTitleHash('Will Bitcoin exceed $100,000 by end of 2026?'),
      resolutionTime: '2026-12-31T00:00:00.000Z',
      existingMarket: null,
      existingCandidate: {
        stage: 'RESEARCHING',
        cooldownUntil: null,
        nextEligibleAt: null,
        lockExpiresAt: '2026-05-15T03:00:00.000Z',
      },
      now: '2026-05-15T02:00:00.000Z',
      priceChangeThreshold: 0.03,
      currentProbability: 0.61,
      previousProbability: 0.61,
    };

    expect(shouldSkipCandidate(input)).toEqual({
      skip: true,
      reason: 'PROCESSING_LOCKED',
    });
  });
});
