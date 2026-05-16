import { describe, expect, it } from 'bun:test';

import { classifyOrderTerminalState, derivePositionStatusAfterFill } from '../order-tracker';

describe('order tracker helpers', () => {
  it('classifies cancelled and expired terminal states', () => {
    expect(classifyOrderTerminalState({ lifecycleStatus: 'CANCELLED', remainingSize: 25 })).toBe('CANCELLED');
    expect(classifyOrderTerminalState({ lifecycleStatus: 'EXPIRED', remainingSize: 10 })).toBe('EXPIRED');
    expect(classifyOrderTerminalState({ lifecycleStatus: 'FILLED', remainingSize: 0 })).toBe('FILLED');
  });

  it('opens a position only after a filled or partially filled order', () => {
    expect(derivePositionStatusAfterFill('FILLED')).toBe('OPEN');
    expect(derivePositionStatusAfterFill('PARTIALLY_FILLED')).toBe('OPEN');
    expect(derivePositionStatusAfterFill('CANCELLED')).toBeNull();
    expect(derivePositionStatusAfterFill('EXPIRED')).toBeNull();
  });
});
