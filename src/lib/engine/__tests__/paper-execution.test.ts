import { describe, expect, it } from 'bun:test';

import {
  buildPaperOrderRecord,
  buildPaperPositionRecord,
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

    expect(order).toEqual({
      marketId: 'market-1',
      venueOrderId: 'PAPER_123',
      executionMode: 'SIMULATED',
      dataSource: 'REAL',
      lifecycleStatus: 'SUBMITTED',
      side: 'YES',
      price: 0.42,
      size: 125,
      filledSize: 0,
      remainingSize: 125,
      avgFillPrice: null,
      status: 'PLANNED',
      submittedAt: now,
      filledAt: null,
    });
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
});
