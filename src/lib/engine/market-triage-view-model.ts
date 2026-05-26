export type MarketTriageDisplayStatus = 'RELEVANT' | 'IRRELEVANT' | 'AMBIGUOUS' | 'ANALYSIS_DEGRADED' | 'PENDING';

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

export function normalizeMarketTriageStatus(status: string | null | undefined): MarketTriageDisplayStatus {
  if (status === 'RELEVANT' || status === 'IRRELEVANT' || status === 'AMBIGUOUS' || status === 'ANALYSIS_DEGRADED') {
    return status;
  }
  return 'PENDING';
}

export function formatMarketTriageStageChange(reason: string | null): { label: string; title: string } | null {
  if (!reason) return null;
  try {
    const parsed = JSON.parse(reason);
    if (Array.isArray(parsed) && parsed.length > 0) {
      const last = parsed[parsed.length - 1] as { from?: unknown; to?: unknown; timestamp?: unknown };
      const from = typeof last.from === 'string' ? last.from : null;
      const to = typeof last.to === 'string' ? last.to : null;
      const timestamp = typeof last.timestamp === 'string' ? last.timestamp : null;
      return {
        label: from && to ? `${from} -> ${to}` : 'Stage update',
        title: timestamp ? `${reason}\nLatest: ${new Date(timestamp).toLocaleString()}` : reason,
      };
    }
  } catch {}
  return {
    label: reason.length > 28 ? `${reason.slice(0, 25)}...` : reason,
    title: reason,
  };
}
