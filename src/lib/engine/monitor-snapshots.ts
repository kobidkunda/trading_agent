export type MonitorState = 'OK' | 'WARN' | 'CRITICAL';

export interface MonitorResult {
  state: MonitorState;
  reasonCodes: string[];
}

export interface MonitorSnapshotInput {
  queueDepth: number;
  failingJobs: number;
  retryingJobs: number;
  staleJobs: number;
  marketSpread: number;
  marketLiquidity: number;
  dailyExposureRatio: number;
  killSwitchEnabled: boolean;
}

function makeResult(state: MonitorState, reasonCodes: string[]): MonitorResult {
  return { state, reasonCodes };
}

export function marketMonitorState(input: MonitorSnapshotInput): MonitorResult {
  if (input.marketLiquidity < 100) return makeResult('CRITICAL', ['LIQUIDITY_CRITICAL']);
  if (input.marketSpread > 0.15) return makeResult('WARN', ['SPREAD_WIDE']);
  return makeResult('OK', ['MARKET_HEALTHY']);
}

export function pipelineMonitorState(input: MonitorSnapshotInput): MonitorResult {
  if (input.staleJobs > 0) return makeResult('CRITICAL', ['STALE_JOB_DETECTED']);
  if (input.queueDepth > 100 || input.retryingJobs > 10) return makeResult('WARN', ['PIPELINE_PRESSURE']);
  return makeResult('OK', ['PIPELINE_HEALTHY']);
}

export function riskMonitorState(input: MonitorSnapshotInput): MonitorResult {
  if (input.dailyExposureRatio >= 1) return makeResult('CRITICAL', ['DAILY_LIMIT_BREACH']);
  if (input.dailyExposureRatio >= 0.8) return makeResult('WARN', ['DAILY_LIMIT_NEAR']);
  return makeResult('OK', ['RISK_HEALTHY']);
}

export function executionMonitorState(input: MonitorSnapshotInput): MonitorResult {
  if (input.failingJobs >= 20) return makeResult('CRITICAL', ['EXECUTION_FAIL_SPIKE']);
  if (input.failingJobs >= 5) return makeResult('WARN', ['EXECUTION_FAIL_ELEVATED']);
  return makeResult('OK', ['EXECUTION_HEALTHY']);
}

export function governanceMonitorState(input: MonitorSnapshotInput): MonitorResult {
  if (!input.killSwitchEnabled) return makeResult('CRITICAL', ['KILL_SWITCH_DISABLED']);
  return makeResult('OK', ['GOVERNANCE_HEALTHY']);
}

export function buildMonitorSnapshot(input: MonitorSnapshotInput) {
  return {
    market: marketMonitorState(input),
    pipeline: pipelineMonitorState(input),
    risk: riskMonitorState(input),
    execution: executionMonitorState(input),
    governance: governanceMonitorState(input),
    createdAt: new Date().toISOString(),
  };
}
