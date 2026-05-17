import { beforeEach, describe, expect, it, mock } from 'bun:test';

const createMock: any = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: `${String(data.type)}-job`, ...data }));
const findManyMock: any = mock(async () => []);

mock.module('@/lib/db', () => ({
  db: {
    job: {
      create: createMock,
      findMany: findManyMock,
    },
  },
}));

describe('candidate job enqueuer', () => {
  beforeEach(() => {
    createMock.mockClear();
    findManyMock.mockClear();
    findManyMock.mockResolvedValue([]);
  });

  it('creates queued jobs for full research candidates', async () => {
    const { enqueueCandidateJobs } = await import('../candidate-job-enqueuer');

    const jobs = await enqueueCandidateJobs('FULL_RESEARCH', {
      marketId: 'm1',
      candidateId: 'c1',
    });

    expect(jobs.map((job) => job.type)).toEqual([
      'DEEP_RESEARCH',
    ]);
    expect(createMock).toHaveBeenCalledTimes(1);
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
