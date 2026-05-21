import { beforeEach, describe, expect, it, mock } from 'bun:test';

const createMock: any = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: `${String(data.type)}-job`, ...data }));
const findManyMock: any = mock(async () => []);
const findUniqueMarketMock: any = mock(async () => ({ id: 'm1', venue: 'POLYMARKET' }));

mock.module('@/lib/db', () => ({
  db: {
    job: {
      create: createMock,
      findMany: findManyMock,
    },
    market: {
      findUnique: findUniqueMarketMock,
    },
  },
}));

describe('candidate job enqueuer', () => {
  beforeEach(() => {
    createMock.mockClear();
    findManyMock.mockClear();
    findUniqueMarketMock.mockClear();
    findManyMock.mockResolvedValue([]);
  });

  it('creates queued jobs for full research candidates', async () => {
    const { enqueueCandidateJobs } = await import('../candidate-job-enqueuer');

    const jobs = await enqueueCandidateJobs('FULL_RESEARCH', {
      marketId: 'm1',
      candidateId: 'c1',
    });

    expect(jobs.map((job) => job.type)).toEqual([
      'TRIAGE_MARKET',
      'DEEP_RESEARCH',
    ]);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('creates no jobs for skipped candidates', async () => {
    const { enqueueCandidateJobs } = await import('../candidate-job-enqueuer');

    const jobs = await enqueueCandidateJobs('SKIP', {
      marketId: 'm1',
      candidateId: 'c1',
    });

    expect(jobs).toEqual([]);
    expect(createMock).not.toHaveBeenCalled();
    expect(findUniqueMarketMock).not.toHaveBeenCalled();
  });

  it('blocks re-enqueue when active job exists with same dedupKey', async () => {
    findManyMock.mockResolvedValue([
      { dedupKey: 'POLYMARKET:m1:DEEP_RESEARCH:24h' },
    ]);

    const { enqueueCandidateJobs } = await import('../candidate-job-enqueuer');

    const jobs = await enqueueCandidateJobs('FULL_RESEARCH', {
      marketId: 'm1',
      candidateId: 'c1',
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].type).toBe('TRIAGE_MARKET');
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('blocks re-enqueue when completed job with same dedupKey is within cooldown', async () => {
    const recentCompleted = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago, within 24h cooldown
    findManyMock.mockResolvedValueOnce([]);  // active by dedupKey
    findManyMock.mockResolvedValueOnce([]);  // legacy active
    findManyMock.mockResolvedValueOnce([     // completed by dedupKey
      { dedupKey: 'POLYMARKET:m1:DEEP_RESEARCH:24h', type: 'DEEP_RESEARCH', completedAt: recentCompleted },
    ]);

    const { enqueueCandidateJobs } = await import('../candidate-job-enqueuer');

    const jobs = await enqueueCandidateJobs('FULL_RESEARCH', {
      marketId: 'm1',
      candidateId: 'c1',
    });

    expect(jobs).toHaveLength(1);
    expect(jobs[0].type).toBe('TRIAGE_MARKET');
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it('allows re-enqueue when completed job cooldown has expired', async () => {
    const oldCompleted = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago, beyond 24h cooldown
    findManyMock.mockResolvedValueOnce([]);  // active by dedupKey
    findManyMock.mockResolvedValueOnce([]);  // legacy active
    findManyMock.mockResolvedValueOnce([     // completed by dedupKey
      { dedupKey: 'POLYMARKET:m1:DEEP_RESEARCH:24h', type: 'DEEP_RESEARCH', completedAt: oldCompleted },
    ]);

    const { enqueueCandidateJobs } = await import('../candidate-job-enqueuer');

    const jobs = await enqueueCandidateJobs('FULL_RESEARCH', {
      marketId: 'm1',
      candidateId: 'c1',
    });

    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.type)).toEqual(['TRIAGE_MARKET', 'DEEP_RESEARCH']);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it('stores dedupKey on created job records', async () => {
    let capturedDedupKey: string | undefined;
    createMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      capturedDedupKey = data.dedupKey as string | undefined;
      return { id: 'test-job', ...data };
    });

    const { enqueueCandidateJobs } = await import('../candidate-job-enqueuer');

    await enqueueCandidateJobs('FULL_RESEARCH', {
      marketId: 'm1',
      candidateId: 'c1',
    });

    expect(capturedDedupKey).toBe('POLYMARKET:m1:DEEP_RESEARCH:24h');
  });

  it('enqueues TRIAGE with correct dedupKey and cooldown', async () => {
    let capturedType: string | undefined;
    let capturedDedupKey: string | undefined;
    createMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      capturedType = data.type as string;
      capturedDedupKey = data.dedupKey as string | undefined;
      return { id: 'test-job', ...data };
    });

    const { enqueueCandidateJobs } = await import('../candidate-job-enqueuer');

    await enqueueCandidateJobs('TRIAGE', {
      marketId: 'm1',
      candidateId: 'c1',
    });

    expect(capturedType).toBe('TRIAGE_MARKET');
    expect(capturedDedupKey).toBe('POLYMARKET:m1:TRIAGE_MARKET:6h');
  });
});
