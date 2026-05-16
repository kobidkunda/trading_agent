import { describe, expect, it } from 'bun:test';

import { buildMarketTriageDetails } from '../market-triage-view-model';

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
});
