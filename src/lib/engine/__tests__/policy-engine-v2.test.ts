import { describe, expect, it } from 'bun:test';
import { resolvePolicyActionV2 } from '../policy-engine-v2';

describe('policy-engine-v2', () => {
  const base = {
    marketMonitor: 'OK' as const,
    pipelineMonitor: 'OK' as const,
    riskMonitor: 'OK' as const,
    executionMonitor: 'OK' as const,
    governanceMonitor: 'OK' as const,
    modelDisagreement: 0.05,
    contextCompletenessScore: 0.9,
    liveEnabled: false,
    killSwitchEnabled: true,
    proposedAction: 'BID' as const,
  };

  it('halts when kill switch disabled', () => {
    const out = resolvePolicyActionV2({ ...base, killSwitchEnabled: false });
    expect(out.action).toBe('HALT');
    expect(out.reasonCodes).toContain('KILL_SWITCH_DISABLED');
  });

  it('halts on any critical monitor', () => {
    const out = resolvePolicyActionV2({ ...base, executionMonitor: 'CRITICAL' });
    expect(out.action).toBe('HALT');
    expect(out.reasonCodes).toContain('CRITICAL_MONITOR_BREACH');
  });

  it('demotes BID to WATCH when model disagreement high', () => {
    const out = resolvePolicyActionV2({ ...base, modelDisagreement: 0.31 });
    expect(out.action).toBe('WATCH');
    expect(out.reasonCodes).toContain('MODEL_DISAGREEMENT_HIGH');
  });

  it('deterministic same input same output', () => {
    const in1 = { ...base, contextCompletenessScore: 0.4 };
    const a = resolvePolicyActionV2(in1);
    const b = resolvePolicyActionV2(in1);
    expect(a).toEqual(b);
  });
});
