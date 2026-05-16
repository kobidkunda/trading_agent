import { beforeEach, describe, expect, it, mock } from 'bun:test';

const findManyMock = mock(async () => ([
  {
    id: 'scan-1',
    venue: 'POLYMARKET',
    mode: 'PAPER',
    status: 'COMPLETED',
    marketsFetched: 12,
    marketsCreated: 3,
    marketsUpdated: 9,
    marketsSkipped: 0,
    startedAt: new Date('2026-05-15T00:00:00.000Z'),
    finishedAt: new Date('2026-05-15T00:01:00.000Z'),
  },
]));

const settingsFindUniqueMock = mock(async ({ where }: { where: { key: string } }) => {
  if (where.key === 'trading_mode') {
    return { key: 'trading_mode', value: 'PAPER' };
  }
  if (where.key === 'strategy_settings') {
    return { key: 'strategy_settings', value: JSON.stringify({ enabledVenues: ['POLYMARKET'] }) };
  }
  return null;
});

mock.module('@/lib/db', () => ({
  db: {
    scanRun: {
      findMany: findManyMock,
    },
    settings: {
      findUnique: settingsFindUniqueMock,
    },
  },
}));

describe('scan runs route', () => {
  beforeEach(() => {
    findManyMock.mockClear();
    settingsFindUniqueMock.mockClear();
  });

  it('returns recent scan runs', async () => {
    const { GET } = await import('../../../app/api/trading/scan-runs/route');
    const res = await GET();
    const payload = await res.json();

    expect(payload.scanRuns).toHaveLength(1);
    expect(payload.scanRuns[0].venue).toBe('POLYMARKET');
    expect(payload.scanRuns[0].mode).toBe('PAPER');
  });
});
