import { beforeEach, describe, expect, it, mock } from 'bun:test';

const findUniqueMock = mock(async ({ where }: { where: { key: string } }) => {
  if (where.key === 'strategy_settings') {
    return {
      key: 'strategy_settings',
      value: JSON.stringify({ enabledVenues: ['POLYMARKET'], enabledCategories: ['crypto'], minLiquidity: 1500 }),
    };
  }

  return null;
});

const upsertMock = mock(async ({ where, create, update }: { where: { key: string }; create: { key: string; value: string }; update: { value: string } }) => ({
  key: where.key,
  value: update.value ?? create.value,
}));

const auditCreateMock = mock(async () => ({ id: 'audit-1' }));

mock.module('@/lib/db', () => ({
  db: {
    settings: {
      findUnique: findUniqueMock,
      upsert: upsertMock,
    },
    auditLog: {
      create: auditCreateMock,
    },
  },
}));

describe('trading mode api', () => {
  beforeEach(() => {
    findUniqueMock.mockClear();
    upsertMock.mockClear();
    auditCreateMock.mockClear();
  });

  it('returns normalized paper mode defaults on GET', async () => {
    const { GET } = await import('../../../app/api/trading/mode/route');

    const response = await GET(new Request('http://localhost/api/trading/mode', {
      headers: { 'x-role': 'Admin' },
    }) as never);
    const payload = await response.json();

    expect(payload.mode).toBe('PAPER');
    expect(payload.dataSource).toBe('REAL');
    expect(payload.executionMode).toBe('SIMULATED');
    expect(payload.candidateThreshold).toBe(75);
  });

  it('sanitizes demo mode updates on POST', async () => {
    const { POST } = await import('../../../app/api/trading/mode/route');

    const response = await POST(
      new Request('http://localhost/api/trading/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-role': 'Admin' },
        body: JSON.stringify({ mode: 'DEMO' }),
      }) as never,
    );

    const payload = await response.json();

    expect(payload).toEqual({
      mode: 'DEMO',
      dataSource: 'MOCK',
      executionMode: 'SIMULATED',
      globalKillSwitch: true,
      liveExecutionEnabled: false,
    });

    expect(upsertMock).toHaveBeenCalledTimes(3);
  });
});
