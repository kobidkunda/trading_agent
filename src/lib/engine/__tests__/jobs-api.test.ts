import { beforeEach, describe, expect, it, mock } from 'bun:test';

const createJobMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({
  id: 'job-1',
  ...data,
}));
const findManyJobMock = mock(async () => ([
  {
    id: 'resolution-job-1',
    type: 'RESOLUTION_CHECK',
    status: 'PENDING',
    nextRetryAt: new Date('2026-05-26T18:00:00.000Z'),
    dedupKey: 'resolution:market-1',
  },
]));
const countJobMock = mock(async () => 1);

const auditCreateMock = mock(async () => ({ id: 'audit-1' }));

mock.module('@/lib/db', () => ({
  db: {
    job: {
      findMany: findManyJobMock,
      count: countJobMock,
      create: createJobMock,
    },
    auditLog: {
      create: auditCreateMock,
    },
  },
}));

describe('jobs api', () => {
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    createJobMock.mockClear();
    findManyJobMock.mockClear();
    countJobMock.mockClear();
    auditCreateMock.mockClear();
    env.NODE_ENV = 'production';
    env.LOCAL_DEV_AUTH_BYPASS = 'true';
  });

  it('returns jobs and data aliases for queue consumers', async () => {
    const { GET } = await import('../../../app/api/jobs/route');

    const response = await GET(
      new Request('http://localhost/api/jobs?type=RESOLUTION_CHECK&due=false&limit=5', {
        headers: { 'x-role': 'ResearchOperator' },
      }) as never,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.jobs).toHaveLength(1);
    expect(payload.data).toEqual(payload.jobs);
    expect(payload.total).toBe(1);
    expect(findManyJobMock).toHaveBeenCalledTimes(1);
    expect(countJobMock).toHaveBeenCalledTimes(1);
  });

  it('accepts deep research job types created by market loop', async () => {
    const { POST } = await import('../../../app/api/jobs/route');

    const response = await POST(
      new Request('http://localhost/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-role': 'ResearchOperator' },
        body: JSON.stringify({
          type: 'DEEP_RESEARCH',
          payload: { marketId: 'market-1' },
        }),
      }) as never,
    );

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.type).toBe('DEEP_RESEARCH');
    expect(createJobMock).toHaveBeenCalledTimes(1);
    expect(auditCreateMock).toHaveBeenCalledTimes(1);
  });

  it('rejects job creation without an operator role', async () => {
    env.LOCAL_DEV_AUTH_BYPASS = 'false';
    const { POST } = await import('../../../app/api/jobs/route');

    const response = await POST(
      new Request('http://localhost/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'DEEP_RESEARCH',
          payload: { marketId: 'market-1' },
        }),
      }) as never,
    );

    expect(response.status).toBe(401);
    expect(createJobMock).toHaveBeenCalledTimes(0);
  });

  it('rejects direct live execution job creation', async () => {
    const { POST } = await import('../../../app/api/jobs/route');

    const response = await POST(
      new Request('http://localhost/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-role': 'Admin' },
        body: JSON.stringify({
          type: 'LIVE_EXECUTE',
          payload: { marketId: 'market-1' },
        }),
      }) as never,
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toContain('LIVE_EXECUTE jobs are disabled');
    expect(createJobMock).toHaveBeenCalledTimes(0);
    expect(auditCreateMock).toHaveBeenCalledTimes(0);
  });
});
