import { beforeEach, describe, expect, it, mock } from 'bun:test';

const findUniqueMock = mock(async ({ where }: { where: { key: string } }) => {
  if (where.key === 'trading_mode') {
    return { key: 'trading_mode', value: 'DEMO' };
  }

  if (where.key === 'strategy_settings') {
    return {
      key: 'strategy_settings',
      value: JSON.stringify({ enabledVenues: ['POLYMARKET'], enabledCategories: ['crypto'] }),
    };
  }

  return null;
});

const marketFindManyMock = mock(async () => ([
  {
    id: 'market-1',
    title: 'Will BTC rally?',
    venue: 'POLYMARKET',
    category: 'crypto',
    status: 'ACTIVE',
    resolutionTime: null,
    updatedAt: new Date('2026-05-15T10:00:00.000Z'),
    snapshots: [
      {
        impliedProb: 0.63,
        liquidity: 9000,
        spread: 0.03,
        volume24h: 2000,
        bestBid: 0.62,
        bestAsk: 0.64,
        timestamp: new Date('2026-05-15T10:00:00.000Z'),
      },
    ],
    tradeCandidates: [
      {
        stage: 'TRIAGED',
        triageStatus: 'RELEVANT',
        updatedAt: new Date('2026-05-15T09:58:00.000Z'),
      },
    ],
    decisions: [
      {
        id: 'decision-1',
        action: 'BUY',
        side: 'YES',
        reason: 'Positive edge',
        confidence: 0.72,
        edge: 0.08,
        urgency: 'HIGH',
        createdAt: new Date('2026-05-15T09:59:00.000Z'),
      },
    ],
    orders: [],
    paperBets: [],
    outcomes: [],
    researchRuns: [
      {
        status: 'RUNNING',
        startedAt: new Date('2026-05-15T09:57:00.000Z'),
        completedAt: null,
        createdAt: new Date('2026-05-15T09:57:00.000Z'),
        agentOutputs: [
          {
            role: 'BULL',
            summary: 'Upside catalysts remain.',
            output: 'Upside catalysts remain.',
            failureReason: null,
            createdAt: new Date('2026-05-15T09:57:30.000Z'),
          },
        ],
      },
    ],
  },
]));

mock.module('@/lib/db', () => ({
  db: {
    settings: {
      findUnique: findUniqueMock,
    },
    market: {
      findMany: marketFindManyMock,
    },
  },
}));

mock.module('@/lib/engine/live-simulation', () => ({
  getSimState: () => ({
    status: 'RUNNING',
    startedAt: '2026-05-15T09:55:00.000Z',
    stoppedAt: null,
    currentCycle: 2,
    marketsScanned: 4,
    marketsRelevant: 1,
    ordersPlaced: 0,
    ordersSkipped: 0,
    totalExposure: 0,
    totalEstimatedPnl: 0,
    paperBetsResolved: 0,
    paperBetAccuracy: 0,
    lastActivity: '2026-05-15T10:00:00.000Z',
    currentStage: 'JUDGE',
    currentStageStartedAt: '2026-05-15T09:59:00.000Z',
    currentMarketTitle: 'Will BTC rally?',
    activityEvents: [],
    marketProgress: [
      {
        marketId: 'market-1',
        marketTitle: 'Will BTC rally?',
        currentStage: 'JUDGE',
        currentStageStartedAt: '2026-05-15T09:59:00.000Z',
        status: 'running',
        history: [],
        lastUpdatedAt: '2026-05-15T10:00:00.000Z',
      },
    ],
    lastCompletedMarket: null,
    error: null,
    config: {
      venues: ['POLYMARKET'],
      categories: ['crypto'],
      scanIntervalSec: 120,
      marketsPerScan: 1,
      maxPortfolioExposure: 500,
    },
  }),
  startSimulation: mock(async (config?: unknown) => ({ status: 'RUNNING', config })),
  stopSimulation: mock(() => ({ status: 'STOPPED' })),
  updateConfig: mock((config?: unknown) => ({ status: 'STOPPED', config })),
}));

describe('operator route', () => {
  beforeEach(() => {
    findUniqueMock.mockClear();
    marketFindManyMock.mockClear();
  });

  it('returns normalized operator payload', async () => {
    const { GET } = await import('../../../app/api/trading/operator/route');
    const response = await GET(new Request('http://localhost/api/trading/operator?limit=1') as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.mode).toBe('DEMO');
    expect(payload.markets).toHaveLength(1);
    expect(payload.markets[0].title).toBe('Will BTC rally?');
    expect(payload.focus.marketId).toBe('market-1');
    expect(payload.focus.stage).toBe('JUDGE');
    expect(payload.summary.currentlyPlaying).toBe('Will BTC rally?');
    expect(payload.markets[0].bullThesis).toBe('Upside catalysts remain.');
  });
});
