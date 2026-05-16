import { describe, expect, it } from 'bun:test';

import { buildCandidateJobs } from '../candidate-queue';

describe('candidate queue planning', () => {
  it('creates no jobs for skipped candidates', () => {
    expect(buildCandidateJobs('SKIP', { marketId: 'm1', candidateId: 'c1' })).toEqual([]);
  });

  it('creates triage only jobs for mid-score candidates', () => {
    expect(buildCandidateJobs('TRIAGE', { marketId: 'm1', candidateId: 'c1' })).toEqual([
      { type: 'TRIAGE_MARKET', priority: 7, payload: { marketId: 'm1', candidateId: 'c1', trigger: 'scanner_score' } },
    ]);
  });

  it('creates triage plus research jobs for strong candidates', () => {
    expect(buildCandidateJobs('TRIAGE_AND_RESEARCH', { marketId: 'm1', candidateId: 'c1' })).toEqual([
      { type: 'TRIAGE_MARKET', priority: 7, payload: { marketId: 'm1', candidateId: 'c1', trigger: 'scanner_score' } },
      { type: 'RESEARCH_MARKET', priority: 8, payload: { marketId: 'm1', candidateId: 'c1', trigger: 'scanner_score' } },
    ]);
  });

  it('creates full pipeline jobs for elite candidates', () => {
    expect(buildCandidateJobs('FULL_RESEARCH', { marketId: 'm1', candidateId: 'c1' })).toEqual([
      { type: 'TRIAGE_MARKET', priority: 7, payload: { marketId: 'm1', candidateId: 'c1', trigger: 'scanner_score' } },
      { type: 'RESEARCH_MARKET', priority: 8, payload: { marketId: 'm1', candidateId: 'c1', trigger: 'scanner_score' } },
      { type: 'JUDGE_MARKET', priority: 9, payload: { marketId: 'm1', candidateId: 'c1', trigger: 'scanner_score' } },
      { type: 'RISK_CHECK', priority: 10, payload: { marketId: 'm1', candidateId: 'c1', trigger: 'scanner_score' } },
    ]);
  });
});
