import { describe, expect, it } from 'bun:test';

import { filterMarketsForMode } from '../market-triage-mode-filter';

describe('market triage mode filter', () => {
  const markets = [
    { id: '1', externalId: 'live_1778786747451_h0zs3j' },
    { id: '2', externalId: 'sim_1778786747451_h0zs3j' },
    { id: '3', externalId: 'poly-123' },
  ];

  it('keeps all rows in demo mode', () => {
    expect(filterMarketsForMode(markets, 'DEMO').map((m) => m.id)).toEqual(['1', '2', '3']);
  });

  it('hides generated demo rows in paper mode', () => {
    expect(filterMarketsForMode(markets, 'PAPER').map((m) => m.id)).toEqual(['3']);
  });

  it('hides generated demo rows in live mode', () => {
    expect(filterMarketsForMode(markets, 'LIVE').map((m) => m.id)).toEqual(['3']);
  });
});
