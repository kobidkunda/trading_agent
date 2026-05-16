import { describe, expect, it } from 'bun:test';

import {
  buildWatchlistPayload,
  shouldCreateExecutionJob,
  shouldCreateWatchlistEntry,
} from '../pipeline-decision-helpers';

describe('pipeline decision helpers', () => {
  it('creates execution jobs only for bid decisions', () => {
    expect(shouldCreateExecutionJob('BID')).toBe(true);
    expect(shouldCreateExecutionJob('WATCH')).toBe(false);
    expect(shouldCreateExecutionJob('SKIP')).toBe(false);
  });

  it('creates watchlist entries only for watch decisions', () => {
    expect(shouldCreateWatchlistEntry('WATCH')).toBe(true);
    expect(shouldCreateWatchlistEntry('BID')).toBe(false);
    expect(shouldCreateWatchlistEntry('SKIP')).toBe(false);
  });

  it('builds watchlist payload without order or position semantics', () => {
    expect(
      buildWatchlistPayload({
        marketId: 'market-1',
        decisionId: 'decision-1',
        reason: 'Need better spread',
        targetPrice: 0.44,
      }),
    ).toEqual({
      marketId: 'market-1',
      decisionId: 'decision-1',
      reason: 'Need better spread',
      targetPrice: 0.44,
      status: 'ACTIVE',
    });
  });
});
