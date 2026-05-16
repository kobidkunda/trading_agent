import { beforeEach, describe, expect, it, mock } from 'bun:test';

const findManyMock = mock(async () => ([
  {
    id: 'watch-1',
    reason: 'Need better spread',
    targetPrice: 0.44,
    status: 'ACTIVE',
    market: {
      id: 'market-1',
      title: 'Will Bitcoin exceed $100,000 by end of 2026?',
      venue: 'POLYMARKET',
      category: 'crypto',
    },
    decision: {
      id: 'decision-1',
      action: 'WATCH',
      reason: 'Need better spread',
      createdAt: new Date('2026-05-15T00:00:00.000Z'),
    },
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
    watchlist: {
      findMany: findManyMock,
    },
    settings: {
      findUnique: settingsFindUniqueMock,
    },
  },
}));

describe('watchlist route', () => {
  beforeEach(() => {
    findManyMock.mockClear();
    settingsFindUniqueMock.mockClear();
  });

  it('returns watchlist entries with related market and decision context', async () => {
    const { GET } = await import('../../../app/api/trading/watchlist/route');

    const response = await GET();
    const payload = await response.json();

    expect(payload.watchlist).toHaveLength(1);
    expect(payload.watchlist[0].decision.action).toBe('WATCH');
    expect(payload.watchlist[0].market.venue).toBe('POLYMARKET');
  });
});
