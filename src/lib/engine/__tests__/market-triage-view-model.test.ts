import { describe, expect, it } from 'bun:test';

import {
  buildMarketTriageDetails,
  formatMarketTriageStageChange,
  normalizeMarketTriageStatus,
} from '../market-triage-view-model';

describe('market triage view model', () => {
  it('surfaces freshness and candidate metadata for observability', () => {
    const details = buildMarketTriageDetails({
      snapshotAt: '2026-05-15T00:00:00.000Z',
      now: '2026-05-15T00:05:00.000Z',
      externalId: 'poly-1',
      dataSource: 'REAL',
      candidateScore: 85.9,
      nextEligibleAt: '2026-05-15T01:00:00.000Z',
      duplicateStatus: 'UNIQUE',
      lastSeenAt: '2026-05-15T00:04:00.000Z',
    });

    expect(details.snapshotAgeMinutes).toBe(5);
    expect(details.externalId).toBe('poly-1');
    expect(details.dataSource).toBe('REAL');
    expect(details.candidateScore).toBe(85.9);
    expect(details.nextEligibleAt).toBe('2026-05-15T01:00:00.000Z');
    expect(details.duplicateStatus).toBe('UNIQUE');
    expect(details.lastSeenAt).toBe('2026-05-15T00:04:00.000Z');
  });

  it('labels untriaged markets as pending instead of irrelevant', () => {
    expect(normalizeMarketTriageStatus(null)).toBe('PENDING');
    expect(normalizeMarketTriageStatus(undefined)).toBe('PENDING');
    expect(normalizeMarketTriageStatus('')).toBe('PENDING');
    expect(normalizeMarketTriageStatus('RELEVANT')).toBe('RELEVANT');
    expect(normalizeMarketTriageStatus('IRRELEVANT')).toBe('IRRELEVANT');
  });

  it('summarizes pipeline stage history instead of exposing raw JSON', () => {
    const formatted = formatMarketTriageStageChange(JSON.stringify([
      { from: 'SCANNED', to: 'TRIAGED', timestamp: '2026-05-25T01:55:08.302Z' },
      { from: 'JUDGED', to: 'DECIDED', timestamp: '2026-05-25T02:00:24.872Z' },
    ]));

    expect(formatted?.label).toBe('JUDGED -> DECIDED');
    expect(formatted?.title).toContain('"from":"JUDGED"');
    expect(formatted?.title).toContain('Latest:');
  });
});
