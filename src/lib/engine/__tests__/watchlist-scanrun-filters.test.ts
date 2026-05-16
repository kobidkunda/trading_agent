import { describe, expect, it } from 'bun:test';

import { filterScanRunsByMode, filterWatchlistByMode } from '../watchlist-scanrun-filters';

describe('watchlist and scan-run mode filters', () => {
  it('keeps demo scan runs out of paper/live summaries', () => {
    const scanRuns = [
      { id: 'scan-1', mode: 'DEMO' },
      { id: 'scan-2', mode: 'PAPER' },
    ];

    expect(filterScanRunsByMode(scanRuns, 'DEMO').map((s) => s.id)).toEqual(['scan-1', 'scan-2']);
    expect(filterScanRunsByMode(scanRuns, 'PAPER').map((s) => s.id)).toEqual(['scan-2']);
    expect(filterScanRunsByMode(scanRuns, 'LIVE').map((s) => s.id)).toEqual([]);
  });

  it('keeps demo-generated watchlist rows out of paper/live views', () => {
    const watchlist = [
      { id: 'watch-1', market: { externalId: 'live_1778786747451_h0zs3j' } },
      { id: 'watch-2', market: { externalId: 'poly-123' } },
    ];

    expect(filterWatchlistByMode(watchlist, 'DEMO').map((w) => w.id)).toEqual(['watch-1', 'watch-2']);
    expect(filterWatchlistByMode(watchlist, 'PAPER').map((w) => w.id)).toEqual(['watch-2']);
    expect(filterWatchlistByMode(watchlist, 'LIVE').map((w) => w.id)).toEqual(['watch-2']);
  });
});
