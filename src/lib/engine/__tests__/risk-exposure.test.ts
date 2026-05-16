import { describe, expect, it } from 'bun:test';

import { computeExposureTotals } from '../risk-exposure';

describe('risk exposure totals', () => {
  it('uses currentSize and market.category for exposure math', () => {
    const totals = computeExposureTotals(
      [
        { currentSize: 120, market: { category: 'crypto' } },
        { currentSize: 80, market: { category: 'sports' } },
        { currentSize: 30, market: { category: 'crypto' } },
      ],
      'crypto',
    );

    expect(totals.dailyExposure).toBe(230);
    expect(totals.categoryExposure).toBe(150);
  });
});
