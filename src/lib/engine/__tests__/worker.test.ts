import { describe, expect, it } from 'bun:test';

import { derivePositionStatusAfterFill } from '../order-tracker';

describe('worker lifecycle primitives', () => {
  it('keeps filled and partially filled orders eligible to open positions', () => {
    expect(derivePositionStatusAfterFill('FILLED')).toBe('OPEN');
    expect(derivePositionStatusAfterFill('PARTIALLY_FILLED')).toBe('OPEN');
  });

  it('keeps cancelled and expired orders from opening positions', () => {
    expect(derivePositionStatusAfterFill('CANCELLED')).toBeNull();
    expect(derivePositionStatusAfterFill('EXPIRED')).toBeNull();
  });
});
