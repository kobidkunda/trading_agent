import { describe, expect, it } from 'bun:test';

import { summarizePipelineObservability } from '../pipeline-observability-view-model';

describe('pipeline observability summary', () => {
  it('summarizes scan runs, candidates, watchlist, and open orders counts', () => {
    expect(
      summarizePipelineObservability({
        scanRuns: [{ id: 'scan-1' }, { id: 'scan-2' }],
        candidates: [{ id: 'candidate-1' }],
        watchlist: [{ id: 'watch-1' }, { id: 'watch-2' }, { id: 'watch-3' }],
        openOrders: [{ id: 'order-1' }],
      }),
    ).toEqual({
      scanRunsCount: 2,
      candidatesCount: 1,
      watchlistCount: 3,
      openOrdersCount: 1,
    });
  });
});
