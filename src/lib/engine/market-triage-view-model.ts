export function buildMarketTriageDetails(params: {
  snapshotAt: string;
  now: string;
  externalId: string | null;
  dataSource: 'MOCK' | 'REAL';
  candidateScore: number | null;
  nextEligibleAt: string | null;
  duplicateStatus: 'UNIQUE' | 'DUPLICATE' | 'COOLDOWN';
  lastSeenAt: string | null;
}) {
  const snapshotAgeMinutes = Math.max(
    0,
    Math.round((new Date(params.now).getTime() - new Date(params.snapshotAt).getTime()) / 60000),
  );

  return {
    snapshotAgeMinutes,
    externalId: params.externalId,
    dataSource: params.dataSource,
    candidateScore: params.candidateScore,
    nextEligibleAt: params.nextEligibleAt,
    duplicateStatus: params.duplicateStatus,
    lastSeenAt: params.lastSeenAt,
  };
}
