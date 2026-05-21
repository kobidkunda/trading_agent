import { beforeEach, describe, expect, it, mock } from 'bun:test';

const baseCandidates = [
  {
    id: 'candidate-1',
    stage: 'WATCHING',
    candidateScore: 85.9,
    nextEligibleAt: '2026-05-15T06:00:00.000Z',
    market: {
      id: 'market-1',
      title: 'Will Bitcoin exceed $100,000 by end of 2026?',
      venue: 'POLYMARKET',
      category: 'crypto',
      externalId: 'poly-1',
    },
  },
];

const findManyMock: any = mock(async ({ where }: { where?: { market?: { NOT?: { OR?: Array<{ externalId?: { startsWith?: string } }> } } } }) => {
  const blockedPrefixes = where?.market?.NOT?.OR
    ?.map((entry) => entry.externalId?.startsWith)
    .filter((value): value is string => Boolean(value)) ?? [];
  return baseCandidates.filter((candidate) => !blockedPrefixes.some((prefix) => candidate.market.externalId.startsWith(prefix)));
});

const createJobMock: any = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'job-1', ...data }));
const findCandidateMock: any = mock(async ({ where }: { where: { id: string } }) => {
  if (where.id === 'candidate-1') {
    return {
      id: 'candidate-1',
      marketId: 'market-1',
      stage: 'WATCHING',
    };
  }

  return null;
});

const auditCreateMock: any = mock(async () => ({ id: 'audit-1' }));
const settingsFindUniqueMock: any = mock(async ({ where }: { where: { key: string } }) => {
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
    tradeCandidate: {
      findMany: findManyMock,
      count: mock(async () => 1),
      findUnique: findCandidateMock,
    },
    job: {
      create: createJobMock,
    },
    settings: {
      findUnique: settingsFindUniqueMock,
    },
    auditLog: {
      create: auditCreateMock,
    },
  },
}));

describe('candidates routes', () => {
  beforeEach(() => {
    findManyMock.mockClear();
    findCandidateMock.mockClear();
    createJobMock.mockClear();
    settingsFindUniqueMock.mockClear();
    auditCreateMock.mockClear();
  });

  it('returns current candidates with market context', async () => {
    const { GET } = await import('../../../app/api/trading/candidates/route');
    const res = await GET(new Request('http://localhost/api/trading/candidates?limit=10') as never);
    const payload = await res.json();

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].candidateScore).toBe(85.9);
    expect(payload.data[0].market.externalId).toBe('poly-1');
  });

  it('filters generated demo candidates out of paper mode results', async () => {
    findManyMock.mockImplementationOnce(async () => ([
      {
        id: 'candidate-demo',
        stage: 'WATCHING',
        candidateScore: 85.9,
        nextEligibleAt: '2026-05-15T06:00:00.000Z',
        market: {
          id: 'market-demo',
          title: 'Demo generated market',
          venue: 'POLYMARKET',
          category: 'crypto',
          externalId: 'live_1778786747451_h0zs3j',
        },
      },
      {
        id: 'candidate-real',
        stage: 'WATCHING',
        candidateScore: 74,
        nextEligibleAt: null,
        market: {
          id: 'market-real',
          title: 'Real market',
          venue: 'POLYMARKET',
          category: 'crypto',
          externalId: 'poly-123',
        },
      },
    ]));

    const { GET } = await import('../../../app/api/trading/candidates/route');
    const res = await GET(new Request('http://localhost/api/trading/candidates?limit=10') as never);
    const payload = await res.json();

    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(findManyMock.mock.calls[0]?.[0]?.where?.market?.NOT?.OR).toEqual([
      { externalId: { startsWith: 'live_' } },
      { externalId: { startsWith: 'sim_' } },
    ]);
    expect(payload.candidates).toHaveLength(2);
  });

  it('queues force-research jobs for an existing candidate', async () => {
    const { POST } = await import('../../../app/api/trading/candidates/[id]/force-research/route');
    const res = await POST(
      new Request('http://localhost/api/trading/candidates/candidate-1/force-research', { method: 'POST' }) as never,
      { params: Promise.resolve({ id: 'candidate-1' }) } as never,
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.job.type).toBe('RESEARCH_MARKET');
    expect(createJobMock).toHaveBeenCalledTimes(1);
  });
});
