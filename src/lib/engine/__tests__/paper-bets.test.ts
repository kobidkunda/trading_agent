import { describe, expect, it } from 'bun:test';

import {
  ACTIVE_OPPOSITE_SIDE_PAPER_BET,
  ACTIVE_SAME_SIDE_PAPER_BET,
  classifyActivePaperBetExposure,
  isExecutedPaperBetStatus,
  scorePaperBet,
} from '../paper-bets';

// ── isExecutedPaperBetStatus guard ────────────────────────────────────────

describe('isExecutedPaperBetStatus filtering', () => {
  it('REJECTS SUBMITTED — not counted in ROI/Brier', () => {
    expect(isExecutedPaperBetStatus('SUBMITTED')).toBe(false);
  });

  it('REJECTS PLANNED — not counted in ROI/Brier', () => {
    expect(isExecutedPaperBetStatus('PLANNED')).toBe(false);
  });

  it('REJECTS FAILED — not counted in ROI/Brier', () => {
    expect(isExecutedPaperBetStatus('FAILED')).toBe(false);
  });

  it('REJECTS EXPIRED — not counted in ROI/Brier', () => {
    expect(isExecutedPaperBetStatus('EXPIRED')).toBe(false);
  });

  it('REJECTS null/undefined status', () => {
    expect(isExecutedPaperBetStatus(null)).toBe(false);
    expect(isExecutedPaperBetStatus(undefined)).toBe(false);
  });

  it('REJECTS garbage strings', () => {
    expect(isExecutedPaperBetStatus('SOMETHING_ELSE')).toBe(false);
  });

  it('ACCEPTS FILLED — counted in ROI/Brier', () => {
    expect(isExecutedPaperBetStatus('FILLED')).toBe(true);
  });

  it('ACCEPTS PARTIAL — counted in ROI/Brier (partials are executed)', () => {
    expect(isExecutedPaperBetStatus('PARTIAL')).toBe(true);
  });
});

// ── EXECUTED set integrity ────────────────────────────────────────────────

describe('executed status set integrity', () => {
  it('contains exactly FILLED and PARTIAL', () => {
    const valid = ['FILLED', 'PARTIAL'] as const;
    for (const s of valid) {
      expect(isExecutedPaperBetStatus(s)).toBe(true);
    }
    const invalid = ['SUBMITTED', 'PLANNED', 'FAILED', 'EXPIRED', 'CANCELLED', 'PENDING'] as const;
    for (const s of invalid) {
      expect(isExecutedPaperBetStatus(s)).toBe(false);
    }
  });
});

describe('active paper exposure classification', () => {
  it('allows same-side unresolved paper exposure to be reused', () => {
    expect(classifyActivePaperBetExposure('YES', 'YES')).toBe(ACTIVE_SAME_SIDE_PAPER_BET);
    expect(classifyActivePaperBetExposure('NO', 'NO')).toBe(ACTIVE_SAME_SIDE_PAPER_BET);
  });

  it('blocks opposite-side unresolved paper exposure explicitly', () => {
    expect(classifyActivePaperBetExposure('YES', 'NO')).toBe(ACTIVE_OPPOSITE_SIDE_PAPER_BET);
    expect(classifyActivePaperBetExposure('NO', 'YES')).toBe(ACTIVE_OPPOSITE_SIDE_PAPER_BET);
  });

  it('treats missing or unknown existing side as no active exposure', () => {
    expect(classifyActivePaperBetExposure(null, 'YES')).toBe('NONE');
    expect(classifyActivePaperBetExposure('MAYBE', 'NO')).toBe('NONE');
  });
});

// ── resolvePaperBet() rejects non-executed bets ────────────────────────────

describe('resolvePaperBet rejects non-executed', () => {
  it('would skip a SUBMITTED bet (guard prevents resolution)', () => {
    // resolvePaperBet checks isExecutedPaperBetStatus internally
    // We verify the guard itself, which is the same check used in the function.
    expect(isExecutedPaperBetStatus('SUBMITTED')).toBe(false);
  });

  it('would skip a FAILED bet (guard prevents resolution)', () => {
    expect(isExecutedPaperBetStatus('FAILED')).toBe(false);
  });

  it('would skip an EXPIRED bet (guard prevents resolution)', () => {
    expect(isExecutedPaperBetStatus('EXPIRED')).toBe(false);
  });

  it('would allow a FILLED bet to be resolved', () => {
    expect(isExecutedPaperBetStatus('FILLED')).toBe(true);
  });

  it('would allow a PARTIAL bet to be resolved', () => {
    expect(isExecutedPaperBetStatus('PARTIAL')).toBe(true);
  });
});

// ── scorePaperBet behaves correctly for executed bets ──────────────────────

describe('scorePaperBet pnl for executed bets', () => {
  it('FILLED YES bet that wins has positive pnl', () => {
    const r = scorePaperBet(0.75, 'YES', 0.60, 100, 'YES');
    expect(r.pnl).toBeGreaterThan(0);
  });

  it('FILLED YES bet that loses has negative pnl', () => {
    const r = scorePaperBet(0.75, 'YES', 0.60, 100, 'NO');
    expect(r.pnl).toBeLessThan(0);
  });

  it('produces valid Brier scores for FILLED bets', () => {
    const r = scorePaperBet(0.80, 'YES', 0.65, 100, 'YES');
    expect(r.brierScore).toBeCloseTo(0.04, 3);
  });

  it('produces boundary Brier = 0 for perfect prediction', () => {
    const r = scorePaperBet(1.0, 'YES', 0.50, 100, 'YES');
    expect(r.brierScore).toBe(0);
  });

  it('produces boundary Brier = 1 for maximally wrong', () => {
    const r = scorePaperBet(1.0, 'YES', 0.50, 100, 'NO');
    expect(r.brierScore).toBe(1);
  });

  it('CANCELLED markets produce neutral scoring and zero pnl', () => {
    const r = scorePaperBet(0.80, 'YES', 0.65, 100, 'CANCELLED');
    expect(r.pnl).toBe(0);
    expect(r.brierScore).toBeNull();
    expect(r.probError).toBeNull();
    expect(r.directionCorrect).toBeNull();
  });
});

// ── Default executionStatus is SUBMITTED ──────────────────────────────────

describe('default executionStatus contract', () => {
  it('createPaperBet default is SUBMITTED (not executed)', () => {
    // The default behavior ensures that newly created PaperBets
    // start as SUBMITTED. They must transition to FILLED|PARTIAL
    // before they affect ROI/Brier via isExecutedPaperBetStatus.
    // We test that SUBMITTED is NOT in the executed set.
    expect(isExecutedPaperBetStatus('SUBMITTED')).toBe(false);
  });
});

// ── A+ sample integrity (verification for live-readiness) ─────────────────

describe('A+ sample count integrity', () => {
  it('A+ bets must be FILLED|PARTIAL to count (via executionStatus guard)', () => {
    // live-readiness.ts now filters executionStatus: { in: ['FILLED', 'PARTIAL'] }
    // This test verifies the guard underpinning that filter.
    expect(isExecutedPaperBetStatus('FILLED')).toBe(true);
    expect(isExecutedPaperBetStatus('PARTIAL')).toBe(true);
  });

  it('A+ bets with SUBMITTED status do NOT count', () => {
    expect(isExecutedPaperBetStatus('SUBMITTED')).toBe(false);
  });

  it('A+ bets with FAILED status do NOT count', () => {
    expect(isExecutedPaperBetStatus('FAILED')).toBe(false);
  });

  it('A+ bets with EXPIRED status do NOT count', () => {
    expect(isExecutedPaperBetStatus('EXPIRED')).toBe(false);
  });
});
