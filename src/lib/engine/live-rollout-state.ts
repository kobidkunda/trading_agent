export type RolloutState = 'OFF' | 'SHADOW' | 'PAPER_ENFORCED' | 'LIVE_CANARY';

export interface RolloutSnapshot {
  state: RolloutState;
  updatedAt: string;
  reason: string;
}

const ORDER: RolloutState[] = ['OFF', 'SHADOW', 'PAPER_ENFORCED', 'LIVE_CANARY'];

export function canTransition(from: RolloutState, to: RolloutState): boolean {
  const i = ORDER.indexOf(from);
  const j = ORDER.indexOf(to);
  if (i === -1 || j === -1) return false;
  return Math.abs(i - j) <= 1;
}

export function transitionRollout(
  current: RolloutSnapshot,
  next: RolloutState,
  reason: string,
): RolloutSnapshot {
  if (!canTransition(current.state, next)) {
    throw new Error(`Invalid rollout transition ${current.state} -> ${next}`);
  }
  return { state: next, updatedAt: new Date().toISOString(), reason };
}

export interface GuardrailInput {
  errorRate: number;
  latencyP95Ms: number;
  dailyLoss: number;
  maxDailyLoss: number;
}

export function shouldAutoRollback(input: GuardrailInput): { rollback: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (input.errorRate > 0.05) reasons.push('ERROR_RATE_BREACH');
  if (input.latencyP95Ms > 2000) reasons.push('LATENCY_BREACH');
  if (input.dailyLoss > input.maxDailyLoss) reasons.push('DAILY_LOSS_BREACH');
  return { rollback: reasons.length > 0, reasons };
}

export function autoDemoteFromCanary(current: RolloutSnapshot, guard: GuardrailInput): RolloutSnapshot {
  const check = shouldAutoRollback(guard);
  if (!check.rollback) return current;
  if (current.state !== 'LIVE_CANARY') return current;
  return {
    state: 'PAPER_ENFORCED',
    updatedAt: new Date().toISOString(),
    reason: `AUTO_ROLLBACK:${check.reasons.join(',')}`,
  };
}
