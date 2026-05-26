import { beforeEach, describe, expect, it, mock } from 'bun:test';

let existingJob: Record<string, any> | null = null;
let createdJob: Record<string, any> | null = null;
let activeJobs: Array<Record<string, any>> = [];
let activePaperBetMarkets: Array<{ marketId: string }> = [];

const marketFindUniqueMock = mock(async () => ({
  resolutionTime: new Date('2026-05-26T14:00:00.000Z'),
}));
const jobFindFirstMock = mock(async () => existingJob);
const jobUpdateMock = mock(async ({ data }: { data: Record<string, unknown> }) => {
  existingJob = { ...existingJob, ...data };
  return existingJob;
});
const jobCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => {
  createdJob = { id: 'resolution-job-1', ...data };
  return createdJob;
});
const jobFindManyMock = mock(async () => activeJobs);
const jobUpdateManyMock = mock(async ({ where, data }: { where: { id?: { in?: string[] } }, data: Record<string, unknown> }) => {
  const ids = new Set(where.id?.in ?? []);
  let count = 0;
  activeJobs = activeJobs.map((job) => {
    if (!ids.has(job.id)) return job;
    count++;
    return { ...job, ...data };
  });
  return { count };
});
const paperBetFindManyMock = mock(async () => activePaperBetMarkets);

mock.module('@/lib/db', () => ({
  db: {
    market: { findUnique: marketFindUniqueMock },
    job: {
      findFirst: jobFindFirstMock,
      findMany: jobFindManyMock,
      update: jobUpdateMock,
      updateMany: jobUpdateManyMock,
      create: jobCreateMock,
    },
    paperBet: { findMany: paperBetFindManyMock },
  },
}));

describe('resolution job scheduler', () => {
  beforeEach(() => {
    existingJob = null;
    createdJob = null;
    activeJobs = [];
    activePaperBetMarkets = [];
    marketFindUniqueMock.mockClear();
    jobFindFirstMock.mockClear();
    jobUpdateMock.mockClear();
    jobCreateMock.mockClear();
    jobFindManyMock.mockClear();
    jobUpdateManyMock.mockClear();
    paperBetFindManyMock.mockClear();
  });

  it('creates one future resolution check for a market paper bet', async () => {
    const { scheduleResolutionCheckForMarket } = await import('../resolution-jobs');

    const result = await scheduleResolutionCheckForMarket({
      marketId: 'market-1',
      trigger: 'paper_bet_created',
    });

    expect(result.created).toBe(true);
    expect(jobCreateMock).toHaveBeenCalledTimes(1);
    expect(createdJob?.type).toBe('RESOLUTION_CHECK');
    expect(createdJob?.dedupKey).toBe('resolution:market-1');
    expect(JSON.parse(String(createdJob?.payload)).marketId).toBe('market-1');
    expect(createdJob?.nextRetryAt.toISOString()).toBe('2026-05-26T14:00:00.000Z');
  });

  it('reuses an existing active resolution job', async () => {
    existingJob = {
      id: 'existing-job',
      type: 'RESOLUTION_CHECK',
      status: 'PENDING',
      nextRetryAt: new Date('2026-05-26T14:00:00.000Z'),
      dedupKey: 'resolution:market-1',
    };
    const { scheduleResolutionCheckForMarket } = await import('../resolution-jobs');

    const result = await scheduleResolutionCheckForMarket({ marketId: 'market-1' });

    expect(result.created).toBe(false);
    expect(result.jobId).toBe('existing-job');
    expect(jobCreateMock).toHaveBeenCalledTimes(0);
  });

  it('prunes active resolution jobs that no longer have unresolved paper bets', async () => {
    activeJobs = [
      { id: 'keep-job', payload: JSON.stringify({ marketId: 'market-active' }), status: 'PENDING' },
      { id: 'prune-job', payload: JSON.stringify({ marketId: 'market-cancelled' }), status: 'PENDING' },
      { id: 'bad-payload-job', payload: '{', status: 'PENDING' },
    ];
    activePaperBetMarkets = [{ marketId: 'market-active' }];

    const { pruneObsoleteResolutionJobs } = await import('../resolution-jobs');
    const result = await pruneObsoleteResolutionJobs();

    expect(result).toEqual({ checked: 3, pruned: 2 });
    expect(jobUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['prune-job', 'bad-payload-job'] } }),
      data: expect.objectContaining({
        status: 'COMPLETED',
        result: JSON.stringify({ status: 'OBSOLETE_RESOLUTION_JOB_PRUNED' }),
      }),
    }));
  });
});
