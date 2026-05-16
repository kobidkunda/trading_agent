import { describe, expect, it } from 'bun:test';

import { isDemoGeneratedExternalId, shouldDisplayMarketInMode } from '../market-visibility';

describe('market visibility by mode', () => {
  it('detects demo-generated external ids', () => {
    expect(isDemoGeneratedExternalId('live_1778786747451_h0zs3j')).toBe(true);
    expect(isDemoGeneratedExternalId('sim_1778786747451_h0zs3j')).toBe(true);
    expect(isDemoGeneratedExternalId('poly-123')).toBe(false);
  });

  it('shows demo-generated markets only in demo mode', () => {
    expect(shouldDisplayMarketInMode('DEMO', 'live_1778786747451_h0zs3j')).toBe(true);
    expect(shouldDisplayMarketInMode('PAPER', 'live_1778786747451_h0zs3j')).toBe(false);
    expect(shouldDisplayMarketInMode('LIVE', 'sim_1778786747451_h0zs3j')).toBe(false);
  });

  it('always shows real venue external ids', () => {
    expect(shouldDisplayMarketInMode('DEMO', 'poly-123')).toBe(true);
    expect(shouldDisplayMarketInMode('PAPER', 'poly-123')).toBe(true);
    expect(shouldDisplayMarketInMode('LIVE', 'kal-456')).toBe(true);
  });
});
