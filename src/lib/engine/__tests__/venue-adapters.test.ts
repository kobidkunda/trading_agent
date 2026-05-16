import { describe, expect, it } from 'bun:test';

import { normalizeVenueMarketStatus, shouldKeepVenueMarket } from '../venue-adapters';

describe('venue adapter helpers', () => {
  it('normalizes venue statuses into active/closed/resolved buckets', () => {
    expect(normalizeVenueMarketStatus('active')).toBe('ACTIVE');
    expect(normalizeVenueMarketStatus('closed')).toBe('CLOSED');
    expect(normalizeVenueMarketStatus('resolved')).toBe('RESOLVED');
    expect(normalizeVenueMarketStatus('settled')).toBe('RESOLVED');
    expect(normalizeVenueMarketStatus('inactive')).toBe('CLOSED');
  });

  it('keeps only active markets for paper/live scanning', () => {
    expect(shouldKeepVenueMarket('ACTIVE')).toBe(true);
    expect(shouldKeepVenueMarket('CLOSED')).toBe(false);
    expect(shouldKeepVenueMarket('RESOLVED')).toBe(false);
  });
});
