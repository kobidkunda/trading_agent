import { describe, expect, it } from 'bun:test';
import {
  buildMonitorSnapshot,
  executionMonitorState,
  governanceMonitorState,
  marketMonitorState,
  pipelineMonitorState,
  riskMonitorState,
} from '../monitor-snapshots';

const base = {
  queueDepth: 5,
  failingJobs: 0,
  retryingJobs: 0,
  staleJobs: 0,
  marketSpread: 0.02,
  marketLiquidity: 1500,
  dailyExposureRatio: 0.3,
  killSwitchEnabled: true,
};

describe('monitor snapshots', () => {
  it('market monitor transitions to CRITICAL on very low liquidity', () => {
    const out = marketMonitorState({ ...base, marketLiquidity: 50 });
    expect(out.state).toBe('CRITICAL');
  });

  it('pipeline monitor transitions to CRITICAL on stale jobs', () => {
    const out = pipelineMonitorState({ ...base, staleJobs: 1 });
    expect(out.state).toBe('CRITICAL');
  });

  it('risk monitor transitions WARN near daily limit', () => {
    const out = riskMonitorState({ ...base, dailyExposureRatio: 0.85 });
    expect(out.state).toBe('WARN');
  });

  it('execution monitor transitions WARN on fail spike', () => {
    const out = executionMonitorState({ ...base, failingJobs: 8 });
    expect(out.state).toBe('WARN');
  });

  it('governance monitor CRITICAL when kill switch disabled', () => {
    const out = governanceMonitorState({ ...base, killSwitchEnabled: false });
    expect(out.state).toBe('CRITICAL');
  });

  it('builds full snapshot with all domains', () => {
    const snap = buildMonitorSnapshot(base);
    expect(snap.market.state).toBe('OK');
    expect(snap.pipeline.state).toBe('OK');
    expect(snap.risk.state).toBe('OK');
    expect(snap.execution.state).toBe('OK');
    expect(snap.governance.state).toBe('OK');
  });
});
