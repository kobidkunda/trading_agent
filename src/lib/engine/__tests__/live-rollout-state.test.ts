import { describe, expect, it } from 'bun:test';
import { autoDemoteFromCanary, canTransition, shouldAutoRollback, transitionRollout } from '../live-rollout-state';

describe('live rollout state', () => {
  it('allows adjacent transitions only', () => {
    expect(canTransition('OFF', 'SHADOW')).toBe(true);
    expect(canTransition('OFF', 'LIVE_CANARY')).toBe(false);
  });

  it('flags rollback on guardrail breaches', () => {
    const out = shouldAutoRollback({ errorRate: 0.1, latencyP95Ms: 3000, dailyLoss: 120, maxDailyLoss: 100 });
    expect(out.rollback).toBe(true);
    expect(out.reasons).toContain('ERROR_RATE_BREACH');
  });

  it('auto-demotes live canary on breach', () => {
    const next = autoDemoteFromCanary(
      { state: 'LIVE_CANARY', updatedAt: new Date().toISOString(), reason: 'manual' },
      { errorRate: 0.2, latencyP95Ms: 3000, dailyLoss: 150, maxDailyLoss: 100 },
    );
    expect(next.state).toBe('PAPER_ENFORCED');
    expect(next.reason).toContain('AUTO_ROLLBACK');
  });

  it('throws on invalid transition', () => {
    expect(() =>
      transitionRollout({ state: 'OFF', updatedAt: new Date().toISOString(), reason: 'x' }, 'LIVE_CANARY', 'bad'),
    ).toThrow();
  });
});
