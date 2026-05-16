import { describe, expect, it } from 'bun:test';

import { buildPaperOrderRecord, buildPaperPositionRecord } from '../paper-execution';
import { buildWatchlistPayload, shouldCreateExecutionJob, shouldCreateWatchlistEntry } from '../pipeline-decision-helpers';

describe('pipeline watch vs bid split', () => {
  it('watch path never needs paper order or paper position creation', () => {
    expect(shouldCreateWatchlistEntry('WATCH')).toBe(true);
    expect(shouldCreateExecutionJob('WATCH')).toBe(false);

    const watchlist = buildWatchlistPayload({
      marketId: 'market-1',
      decisionId: 'decision-1',
      reason: 'Need better spread',
      targetPrice: 0.41,
    });

    expect(watchlist).toEqual({
      marketId: 'market-1',
      decisionId: 'decision-1',
      reason: 'Need better spread',
      targetPrice: 0.41,
      status: 'ACTIVE',
    });
  });

  it('bid path creates simulated order plus position records', () => {
    expect(shouldCreateExecutionJob('BID')).toBe(true);
    expect(shouldCreateWatchlistEntry('BID')).toBe(false);

    const order = buildPaperOrderRecord({
      marketId: 'market-1',
      venueOrderId: 'PAPER_123',
      side: 'YES',
      price: 0.42,
      size: 125,
      now: new Date('2026-05-15T00:00:00.000Z'),
      dataSource: 'REAL',
    });

    const position = buildPaperPositionRecord({
      marketId: 'market-1',
      side: 'YES',
      entryPrice: 0.42,
      currentSize: 125,
      judgeProbability: 0.61,
    });

    expect(order.lifecycleStatus).toBe('SUBMITTED');
    expect(position.status).toBe('WATCH');
  });
});
