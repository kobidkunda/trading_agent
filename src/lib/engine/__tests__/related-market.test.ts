import { describe, expect, it, mock } from 'bun:test';

mock.module('@/lib/db', () => ({
  db: {},
}));

describe('related market formulas', () => {
  it('computes same-outcome violation deterministically', async () => {
    const { evaluateRelationship } = await import('../related-market');

    const result = evaluateRelationship(
      {
        type: 'SAME_OUTCOME',
        entityOverlap: 0.9,
        textSimilarity: 0.8,
        confidence: 0.9,
        reason: 'same entity',
      },
      { impliedProb: 0.62, signalSource: 'FRESH_PRICE' as const },
      { impliedProb: 0.54, signalSource: 'FRESH_PRICE' as const },
    );

    expect(result.expectedRule).toContain('P(A)');
    expect(result.expectedRule).toContain('symmetric');
    expect(result.violationScore).toBeCloseTo(0.08, 5);
    expect(result.severity).toBe('HIGH');
    expect(result.action).toBe('DEEP_RESEARCH');
  });

  it('computes opposite-outcome violation from sum-to-one rule', async () => {
    const { evaluateRelationship } = await import('../related-market');

    const result = evaluateRelationship(
      {
        type: 'OPPOSITE_OUTCOME',
        entityOverlap: 0.9,
        textSimilarity: 0.85,
        confidence: 0.92,
        reason: 'opposite outcomes',
      },
      { impliedProb: 0.70, signalSource: 'FRESH_PRICE' as const },
      { impliedProb: 0.20, signalSource: 'FRESH_PRICE' as const },
    );

    expect(result.violationScore).toBeCloseTo(0.10, 5);
    expect(result.severity).toBe('BLOCK');
  });

  it('blocks low-confidence relationships from producing trade action', async () => {
    const { evaluateRelationship } = await import('../related-market');

    const result = evaluateRelationship(
      {
        type: 'A_IMPLIES_B',
        entityOverlap: 0.5,
        textSimilarity: 0.5,
        confidence: 0.6,
        reason: 'weak implication',
      },
      { impliedProb: 0.68, signalSource: 'FRESH_PRICE' as const },
      { impliedProb: 0.50, signalSource: 'FRESH_PRICE' as const },
    );

    expect(result.violationScore).toBeCloseTo(0.18, 5);
    expect(result.severity).toBe('BLOCK');
    expect(result.action).toBe('NONE');
  });
});
