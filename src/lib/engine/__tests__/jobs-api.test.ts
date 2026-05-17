import { beforeEach, describe, expect, it, mock } from 'bun:test';

const createJobMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({
  id: 'job-1',
  ...data,
}));

const auditCreateMock = mock(async () => ({ id: 'audit-1' }));

mock.module('@/lib/db', () => ({
  db: {
    job: {
      create: createJobMock,
    },
    auditLog: {
      create: auditCreateMock,
    },
  },
}));

describe('jobs api', () => {
  beforeEach(() => {
    createJobMock.mockClear();
    auditCreateMock.mockClear();
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

    expect(response.status).toBe(403);
    expect(createJobMock).toHaveBeenCalledTimes(0);
  });
});
