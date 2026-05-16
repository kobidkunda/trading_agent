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

  return [
    { type: 'TRIAGE_MARKET', priority: 7, payload: basePayload },
    { type: 'RESEARCH_MARKET', priority: 8, payload: basePayload },
    { type: 'JUDGE_MARKET', priority: 9, payload: basePayload },
    { type: 'RISK_CHECK', priority: 10, payload: basePayload },
  ];
}
