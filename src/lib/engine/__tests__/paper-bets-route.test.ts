import { beforeEach, describe, expect, it, mock } from 'bun:test';

const getAccuracyMetricsMock = mock(async () => ({
  totalBets: 1,
  resolvedBets: 1,
  pendingBets: 0,
  aPlusResolvedBets: 0,
  aPlusPendingBets: 0,
  aPlusDirectionAccuracy: 0,
  aPlusAvgBrierScore: 0,
  aPlusTotalPnl: 0,
  directionAccuracy: 100,
  avgBrierScore: 0,
  avgProbError: 0,
  totalPnl: 0,
  bidCount: 1,
  bidCorrect: 1,
  bidPnl: 0,
  watchCount: 0,
  watchCorrect: 0,
  watchPnl: 0,
  recentBets: [
    {
      id: 'paper-test-bet',
      marketTitle: 'Test V2: Paper Orders should work in paper mode',
      predictionType: 'BID',
      predictedProb: 0.65,
      predictedSide: 'YES',
      impliedProb: 0.6,
      actualOutcome: 'YES',
      directionCorrect: true,
      brierScore: 0,
      pnl: 0,
      createdAt: new Date('2026-05-19T00:00:00.000Z'),
      resolvedAt: new Date('2026-05-19T00:00:00.000Z'),
    },
  ],
}));

mock.module('@/lib/engine/paper-bets', () => ({
  getAccuracyMetrics: getAccuracyMetricsMock,
  resolvePaperBet: mock(async () => ({ ok: true })),
}));

mock.module('@/lib/engine/resolution-poller', () => ({
  runResolutionCycle: mock(async () => ({ ok: true })),
}));

describe('paper-bets route', () => {
  beforeEach(() => {
    getAccuracyMetricsMock.mockClear();
  });

  it('excludes paper-loop test market rows when metrics include them', async () => {
    const { GET } = await import('../../../app/api/paper-bets/route');

    const res = await GET(new Request('http://localhost/api/paper-bets?limit=25') as never);
    const payload = await res.json();

    expect(payload.data).toHaveLength(0);
    expect(payload.totalBets).toBe(0);
  });
});
