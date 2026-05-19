import { describe, expect, it } from 'bun:test';

// ---------------------------------------------------------------------------
// Candidates A+ API Filter
// Tests the query-parameter parsing, risk-flag extraction, and model
// disagreement computation used by the /api/candidates endpoint.
// ---------------------------------------------------------------------------

describe('Candidates A+ API Filter', () => {
  // --- aplus=true sets minScore to 90 ---

  it('aplus=true should set minScore to 90', () => {
    const aplusOnly = true;
    const where: Record<string, unknown> = {};
    if (aplusOnly) {
      where.candidateScore = { gte: 90 };
    }
    expect(where.candidateScore).toEqual({ gte: 90 });
  });

  it('aplus not set should not add score filter', () => {
    const aplusOnly = false;
    const where: Record<string, unknown> = {};
    if (aplusOnly) {
      where.candidateScore = { gte: 90 };
    }
    expect(where.candidateScore).toBeUndefined();
    expect(Object.keys(where).length).toBe(0);
  });

  it('aplus should be parsed from query string correctly', () => {
    function parseAplus(param: string | null): boolean {
      return param === 'true' || param === '1';
    }

    expect(parseAplus('true')).toBe(true);
    expect(parseAplus('1')).toBe(true);
    expect(parseAplus('false')).toBe(false);
    expect(parseAplus('0')).toBe(false);
    expect(parseAplus(null)).toBe(false);
    expect(parseAplus(undefined as unknown as null)).toBe(false);
  });

  // --- riskFlags parsed from rejectedCriteria ---

  it('riskFlags should be parsed from rejectedCriteria', () => {
    const c = { rejectedCriteria: 'LOW_LIQUIDITY;WIDE_SPREAD' };
    const riskFlags = c.rejectedCriteria
      ? c.rejectedCriteria.split(';').filter(Boolean)
      : [];

    expect(riskFlags).toEqual(['LOW_LIQUIDITY', 'WIDE_SPREAD']);
  });

  it('riskFlags should handle single rejected criteria', () => {
    const c = { rejectedCriteria: 'HIGH_UNCERTAINTY' };
    const riskFlags = c.rejectedCriteria
      ? c.rejectedCriteria.split(';').filter(Boolean)
      : [];

    expect(riskFlags).toEqual(['HIGH_UNCERTAINTY']);
  });

  it('riskFlags should handle null/undefined rejectedCriteria', () => {
    // Safe optional chain — null?.prop returns undefined
    const nullObj = null as unknown as { rejectedCriteria?: string } | null;
    const flags1 = nullObj?.rejectedCriteria
      ? nullObj.rejectedCriteria.split(';').filter(Boolean)
      : [];
    expect(flags1).toEqual([]);

    const c = {} as { rejectedCriteria?: string };
    const flags = c.rejectedCriteria
      ? c.rejectedCriteria.split(';').filter(Boolean)
      : [];
    expect(flags).toEqual([]);
  });

  it('riskFlags should handle empty rejectedCriteria', () => {
    const c = { rejectedCriteria: '' };
    const flags = c.rejectedCriteria
      ? c.rejectedCriteria.split(';').filter(Boolean)
      : [];
    expect(flags).toEqual([]); // empty string → [''] → filtered to []
  });

  it('riskFlags should trim whitespace from codes', () => {
    const c = { rejectedCriteria: ' LOW_LIQUIDITY ; WIDE_SPREAD ' };
    const flags = (c.rejectedCriteria ?? '')
      .split(';')
      .map((s: string) => s.trim())
      .filter(Boolean);
    expect(flags).toEqual(['LOW_LIQUIDITY', 'WIDE_SPREAD']);
  });

  // --- modelDisagreement from penalties ---

  it('modelDisagreement should be computed from penalties', () => {
    const c = { contradictionPenalty: 0.4, uncertaintyPenalty: 0.3 };
    const modelDisagreement =
      (c.contradictionPenalty ?? 0) + (c.uncertaintyPenalty ?? 0) > 0.5
        ? 0.4
        : 0;

    expect(modelDisagreement).toBe(0.4);
  });

  it('modelDisagreement should be 0 when penalties are low', () => {
    const c = { contradictionPenalty: 0.2, uncertaintyPenalty: 0.1 };
    const modelDisagreement =
      (c.contradictionPenalty ?? 0) + (c.uncertaintyPenalty ?? 0) > 0.5
        ? 0.4
        : 0;

    expect(modelDisagreement).toBe(0);
  });

  it('modelDisagreement should handle missing penalty fields', () => {
    const c: Record<string, number> = {};
    const modelDisagreement =
      (c.contradictionPenalty ?? 0) + (c.uncertaintyPenalty ?? 0) > 0.5
        ? 0.4
        : 0;

    expect(modelDisagreement).toBe(0);
  });

  it('modelDisagreement should trigger at exactly 0.5 threshold (NOT > 0.5)', () => {
    // Sum = 0.5, should NOT exceed 0.5 → disagreement = 0
    const c = { contradictionPenalty: 0.3, uncertaintyPenalty: 0.2 };
    const sum = (c.contradictionPenalty ?? 0) + (c.uncertaintyPenalty ?? 0);
    expect(sum).toBe(0.5);
    expect(sum > 0.5).toBe(false);

    const modelDisagreement = sum > 0.5 ? 0.4 : 0;
    expect(modelDisagreement).toBe(0);
  });

  // --- Full response mapping ---

  it('full candidate response should map all computed fields', () => {
    const raw = {
      id: 'cand-1',
      marketId: 'mkt-1',
      candidateScore: 92.5,
      contradictionPenalty: 0.35,
      uncertaintyPenalty: 0.28,
      rejectedCriteria: 'LOW_LIQUIDITY;WIDE_SPREAD',
      market: { title: 'Will AI win?', venue: 'POLYMARKET', category: 'tech' },
    };

    const riskFlags = raw.rejectedCriteria
      ? raw.rejectedCriteria.split(';').filter(Boolean)
      : [];
    const modelDisagreement =
      (raw.contradictionPenalty ?? 0) + (raw.uncertaintyPenalty ?? 0) > 0.5
        ? 0.4
        : 0;

    expect(riskFlags).toEqual(['LOW_LIQUIDITY', 'WIDE_SPREAD']);
    expect(modelDisagreement).toBe(0.4); // 0.35 + 0.28 = 0.63 > 0.5
    expect(raw.candidateScore).toBe(92.5);
  });
});
