import { beforeEach, describe, expect, it, mock } from 'bun:test';

const createMock: any = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: `${String(data.type)}-job`, ...data }));

mock.module('@/lib/db', () => ({
  db: {
    job: {
      create: createMock,
    },
  },
}));

describe('candidate job enqueuer', () => {
  beforeEach(() => {
    createMock.mockClear();
  });

  it('creates queued jobs for full research candidates', async () => {
    const { enqueueCandidateJobs } = await import('../candidate-job-enqueuer');

    const jobs = await enqueueCandidateJobs('FULL_RESEARCH', {
      marketId: 'm1',
      candidateId: 'c1',
    });

    expect(jobs.map((job) => job.type)).toEqual([
      'TRIAGE_MARKET',
      'RESEARCH_MARKET',
      'JUDGE_MARKET',
      'RISK_CHECK',
    ]);
    expect(createMock).toHaveBeenCalledTimes(4);
  });

  it('creates no jobs for skipped candidates', async () => {
    const { enqueueCandidateJobs } = await import('../candidate-job-enqueuer');

    const jobs = await enqueueCandidateJobs('SKIP', {
      marketId: 'm1',
      candidateId: 'c1',
    });

    expect(jobs).toEqual([]);
    expect(createMock).not.toHaveBeenCalled();
  });
});
