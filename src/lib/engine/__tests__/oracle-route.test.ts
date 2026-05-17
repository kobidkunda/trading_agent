import { beforeEach, describe, expect, it, mock } from 'bun:test';

const findUniqueMock = mock(async () => ({
  id: 'market-1',
  title: 'Will committee decide the result?',
  description: 'Resolution source unclear and subject to committee discretion.',
  oracleCheck: null,
}));

const upsertMock = mock(async ({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
  id: 'oracle-1',
  ...(Object.keys(update).length > 0 ? update : create),
}));

const auditCreateMock = mock(async () => ({ id: 'audit-1' }));

mock.module('@/lib/db', () => ({
  db: {
    market: {
      findUnique: findUniqueMock,
    },
    oracleCheck: {
      upsert: upsertMock,
    },
    auditLog: {
      create: auditCreateMock,
    },
  },
}));

describe('oracle route workflow', () => {
  beforeEach(() => {
    findUniqueMock.mockClear();
    upsertMock.mockClear();
    auditCreateMock.mockClear();
  });

  it('creates manual review requirement for high-risk oracle markets', async () => {
    const { POST } = await import('../../../app/api/oracle/route');

    const response = await POST(
      new Request('http://localhost/api/oracle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId: 'market-1' }),
      }) as never,
    );

    const payload = await response.json();
    expect(payload.review.manualReviewRequired).toBe(true);
    expect(payload.review.manualReviewStatus).toBe('REQUIRED');
    expect(auditCreateMock).toHaveBeenCalledTimes(1);
  });
});
