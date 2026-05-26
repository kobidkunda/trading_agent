import { beforeEach, describe, expect, it, mock } from 'bun:test';

const baseMarkets = [
  {
    id: 'market-1',
    externalId: 'live_1778786747451_h0zs3j',
    venue: 'POLYMARKET',
    title: 'Demo generated market',
    description: null,
    category: 'crypto',
    status: 'ACTIVE',
    resolutionTime: null,
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
    snapshots: [],
    tradeCandidates: [],
  },
  {
    id: 'market-2',
    externalId: 'poly-123',
    venue: 'POLYMARKET',
    title: 'Real market',
    description: null,
    category: 'crypto',
    status: 'ACTIVE',
    resolutionTime: null,
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
    snapshots: [],
    tradeCandidates: [],
  },
];

const findManyMock = mock(async ({ where }: { where?: { NOT?: { OR?: Array<{ externalId?: { startsWith?: string } }> } } }) => {
  const blockedPrefixes = where?.NOT?.OR
    ?.map((entry) => entry.externalId?.startsWith)
    .filter((value): value is string => Boolean(value)) ?? [];
  return baseMarkets.filter((market) => !blockedPrefixes.some((prefix) => market.externalId.startsWith(prefix)));
});

const countMock = mock(async () => 2);
const aggregateMock = mock(async () => ({ _sum: { latestLiquidity: 0 } }));

const findUniqueMock = mock(async ({ where }: { where: { key: string } }) => {
  if (where.key === 'trading_mode') {
    return { key: 'trading_mode', value: 'PAPER' };
  }
  if (where.key === 'strategy_settings') {
    return { key: 'strategy_settings', value: JSON.stringify({ enabledVenues: ['POLYMARKET'] }) };
  }
  if (where.key === 'trading_config') {
    return { key: 'trading_config', value: JSON.stringify({ mode: 'PAPER', dataSource: 'REAL', executionMode: 'SIMULATED' }) };
  }
  return null;
});

mock.module('@/lib/db', () => ({
  db: {
    market: {
      findMany: findManyMock,
      count: countMock,
      aggregate: aggregateMock,
    },
    settings: {
      findUnique: findUniqueMock,
    },
  },
}));

describe('markets route mode filtering', () => {
  beforeEach(() => {
    findManyMock.mockClear();
    countMock.mockClear();
    aggregateMock.mockClear();
    findUniqueMock.mockClear();
  });

  it('filters generated demo rows in paper mode', async () => {
    const { GET } = await import('../../../app/api/markets/route');
    const res = await GET(new Request('http://localhost/api/markets?limit=10') as never);
    const payload = await res.json();

    expect(payload.markets).toHaveLength(1);
    expect(payload.markets[0].externalId).toBe('poly-123');
  });
});
