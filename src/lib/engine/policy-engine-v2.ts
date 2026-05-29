export type PolicyActionV2 = 'BID' | 'WATCH' | 'SKIP' | 'HALT';

export type PolicyState = 'OK' | 'WARN' | 'CRITICAL';

export interface PolicyInputV2 {
  marketMonitor: PolicyState;
  pipelineMonitor: PolicyState;
  riskMonitor: PolicyState;
  executionMonitor: PolicyState;
  governanceMonitor: PolicyState;
  modelDisagreement: number;
  contextCompletenessScore: number;
  liveEnabled: boolean;
  killSwitchEnabled: boolean;
  proposedAction: Exclude<PolicyActionV2, 'HALT'>;
}

export interface PolicyDecisionV2 {
  action: PolicyActionV2;
  reasonCodes: string[];
}

export function resolvePolicyActionV2(input: PolicyInputV2): PolicyDecisionV2 {
  const reasons: string[] = [];

  if (!input.killSwitchEnabled) {
    reasons.push('KILL_SWITCH_DISABLED');
    return { action: 'HALT', reasonCodes: reasons };
  }

  const anyCritical = [
    input.marketMonitor,
    input.pipelineMonitor,
    input.riskMonitor,
    input.executionMonitor,
    input.governanceMonitor,
  ].includes('CRITICAL');

  if (anyCritical) {
    reasons.push('CRITICAL_MONITOR_BREACH');
    return { action: 'HALT', reasonCodes: reasons };
  }

  if (input.governanceMonitor === 'WARN' && input.liveEnabled && input.proposedAction === 'BID') {
    reasons.push('LIVE_GOVERNANCE_WARN_DEMOTE');
    return { action: 'WATCH', reasonCodes: reasons };
  }

  if (input.modelDisagreement > 0.3) {
    reasons.push('MODEL_DISAGREEMENT_HIGH');
    if (input.proposedAction === 'BID') return { action: 'WATCH', reasonCodes: reasons };
    return { action: input.proposedAction, reasonCodes: reasons };
  }

  if (input.contextCompletenessScore < 0.5) {
    reasons.push('CONTEXT_INCOMPLETE');
    if (input.proposedAction === 'BID') return { action: 'WATCH', reasonCodes: reasons };
  }

  reasons.push('POLICY_PASS');
  return { action: input.proposedAction, reasonCodes: reasons };
}
