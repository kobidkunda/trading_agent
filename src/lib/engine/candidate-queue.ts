export type CandidateQueueAction = 'SKIP' | 'SNAPSHOT_ONLY' | 'TRIAGE' | 'TRIAGE_AND_RESEARCH' | 'FULL_RESEARCH';

export function buildCandidateJobs(action: CandidateQueueAction, params: { marketId: string; candidateId: string }) {
  const basePayload = { marketId: params.marketId, candidateId: params.candidateId, trigger: 'scanner_score' };

  if (action === 'SKIP' || action === 'SNAPSHOT_ONLY') {
    return [];
  }

  if (action === 'TRIAGE') {
    return [
      { type: 'TRIAGE_MARKET', priority: 7, payload: basePayload },
    ];
  }

  if (action === 'TRIAGE_AND_RESEARCH') {
    return [
      { type: 'TRIAGE_MARKET', priority: 7, payload: basePayload },
      { type: 'RESEARCH_MARKET', priority: 8, payload: basePayload },
    ];
  }

  // Don't pre-create JUDGE_MARKET or RISK_CHECK — the worker chains them after research completes
  return [
    { type: 'TRIAGE_MARKET', priority: 7, payload: basePayload },
    { type: 'RESEARCH_MARKET', priority: 8, payload: basePayload },
  ];
}
