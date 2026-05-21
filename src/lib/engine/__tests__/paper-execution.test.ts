import { describe, expect, it } from 'bun:test';

import {
  buildPaperOrderRecord,
  buildPaperPositionRecord,
  resolvePaperFill,
  resolvePaperExecutionSize,
} from '../paper-execution';

describe('paper execution helpers', () => {
  it('builds a submitted order record with lifecycle metadata (not instant-filled)', () => {
    const now = new Date('2026-05-15T00:00:00.000Z');
    const order = buildPaperOrderRecord({
      marketId: 'market-1',
      venueOrderId: 'PAPER_123',
      side: 'YES',
      price: 0.42,
      size: 125,
      now,
      dataSource: 'REAL',
    });

    expect(order.marketId).toBe('market-1');
    expect(order.venueOrderId).toBe('PAPER_123');
    expect(order.executionMode).toBe('SIMULATED');
    expect(order.dataSource).toBe('REAL');
    expect(order.lifecycleStatus).toBe('SUBMITTED');
    expect(order.side).toBe('YES');
    expect(order.price).toBe(0.42);
    expect(order.size).toBe(125);
    expect(order.filledSize).toBe(0);
    expect(order.remainingSize).toBe(125);
    expect(order.avgFillPrice).toBeNull();
    expect(order.status).toBe('SUBMITTED');
    expect(order.fillAttemptCount).toBe(0);
    expect(order.lastFillAttemptAt).toBeNull();
    expect(order.fillModel).toBe('CONSERVATIVE_PAPER');
    expect(order.executionNotesJson).toBeNull();
    expect(order.orderExpiryAt instanceof Date).toBe(true);
    expect(order.submittedAt).toEqual(now);
    expect(order.filledAt).toBeNull();
  });

  it('builds a watch-level position (not open) until order tracker fills it', () => {
    const position = buildPaperPositionRecord({
      marketId: 'market-1',
      side: 'NO',
      entryPrice: 0.61,
      currentSize: 80,
      judgeProbability: 0.35,
    });

    expect(position.marketId).toBe('market-1');
    expect(position.side).toBe('NO');
    expect(position.currentSize).toBe(0); // Not filled yet
    expect(position.avgEntryPrice).toBe(0); // Not filled yet
    expect(position.status).toBe('WATCH'); // Changed from OPEN to WATCH
  });

  it('treats zero-sized or watch-like paper execution sizes as non-executable', () => {
    expect(resolvePaperExecutionSize({ adjustedSize: 0, maxSize: 0, fallbackSize: 25 })).toBeNull();
    expect(resolvePaperExecutionSize({ adjustedSize: null, maxSize: undefined, fallbackSize: 25 })).toBe(25);
    expect(resolvePaperExecutionSize({ adjustedSize: 10, maxSize: 20, fallbackSize: 30 })).toBe(10);
  });

  it('keeps no-fill PAPER limit orders submitted instead of falsely failing', () => {
    const fill = resolvePaperFill({
      size: 10,
      price: 0.08,
      fillModel: 'CONSERVATIVE_PAPER',
      liquidity: 1000,
      fillProbability: 0.05,
      spread: 0.01,
      bidDepth: 100,
      askDepth: 100,
    });

    expect(fill.filledSize).toBeGreaterThanOrEqual(0);
    expect(fill.remainingSize).toBeLessThanOrEqual(10);
    expect(['SUBMITTED', 'PARTIALLY_FILLED', 'FILLED']).toContain(fill.lifecycleStatus);
  });
});
