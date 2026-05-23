import { beforeEach, describe, expect, it, mock } from 'bun:test';

const paperBetFindManyMock = mock(async () => ([
  {
    id: 'paper-test-bet',
    marketTitle: 'Test V2: Paper Orders should work in paper mode',
    predictionType: 'BID',
    predictedProb: 0.65,
    predictedSide: 'YES',
    impliedProb: 0.6,
    edge: 0.05,
    confidence: 0.8,
    stake: 100,
    entryPrice: 0.6,
    executionStatus: 'FILLED',
    actualOutcome: 'YES',
    directionCorrect: true,
    probError: 0,
    brierScore: 0,
    pnl: 0,
    createdAt: new Date('2026-05-19T00:00:00.000Z'),
    resolvedAt: new Date('2026-05-19T00:00:00.000Z'),
    setupType: null,
    aPlusStatus: null,
    market: { title: 'Test V2: Paper Orders should work in paper mode' },
  },
]));

mock.module('@/lib/db', () => ({
  db: {
    paperBet: {
      findMany: paperBetFindManyMock,
      findUnique: mock(async () => null),
      update: mock(async () => null),
    },
    position: {
      findMany: mock(async () => []),
      update: mock(async () => null),
    },
  },
}));

describe('paper-bets route', () => {
  beforeEach(() => {
    paperBetFindManyMock.mockClear();
  });

  it('excludes paper-loop test market rows when metrics include them', async () => {
    const { GET } = await import('../../../app/api/paper-bets/route');

    const res = await GET(new Request('http://localhost/api/paper-bets?limit=25') as never);
    const payload = await res.json();

    expect(payload.data).toHaveLength(0);
    expect(payload.totalBets).toBe(0);
  });
});
