import { describe, expect, it } from 'bun:test';
import { buildOperatorDashboardPayload } from '../operator-dashboard-view-model';

describe('operator dashboard view model', () => {
  it('builds grouped attempts and focus data for mixed market states', () => {
    const payload = buildOperatorDashboardPayload({
      mode: 'PAPER',
      simulation: {
        status: 'RUNNING',
        startedAt: '2026-05-15T10:00:00.000Z',
        stoppedAt: null,
        currentCycle: 4,
        marketsScanned: 12,
        marketsRelevant: 3,
        ordersPlaced: 1,
        ordersSkipped: 1,
        totalExposure: 245,
        totalEstimatedPnl: 34,
        paperBetsResolved: 1,
        paperBetAccuracy: 100,
        lastActivity: '2026-05-15T10:02:00.000Z',
        currentStage: 'RISK',
        currentStageStartedAt: '2026-05-15T10:01:30.000Z',
        currentMarketTitle: 'Will BTC rally?',
        activityEvents: [],
        marketProgress: [
          {
            marketId: 'market-1',
            marketTitle: 'Will BTC rally?',
            currentStage: 'RISK',
            currentStageStartedAt: '2026-05-15T10:01:30.000Z',
            status: 'running',
            history: [],
            lastUpdatedAt: '2026-05-15T10:02:00.000Z',
          },
        ],
        lastCompletedMarket: null,
        error: null,
        config: {
          venues: ['POLYMARKET'],
          categories: ['crypto'],
          scanIntervalSec: 120,
          marketsPerScan: 2,
          maxPortfolioExposure: 500,
        },
      },
      markets: [
        {
          id: 'market-1',
          title: 'Will BTC rally?',
          venue: 'POLYMARKET',
          category: 'crypto',
          status: 'ACTIVE',
          resolutionTime: null,
          updatedAt: new Date('2026-05-15T10:02:00.000Z'),
          snapshots: [
            {
              impliedProb: 0.61,
              liquidity: 12000,
              spread: 0.02,
              volume24h: 3300,
              bestBid: 0.6,
              bestAsk: 0.62,
              timestamp: new Date('2026-05-15T10:00:00.000Z'),
            },
          ],
          tradeCandidates: [
            {
              stage: 'RESEARCHING',
              triageStatus: 'RELEVANT',
              updatedAt: new Date('2026-05-15T09:59:00.000Z'),
            },
          ],
          decisions: [
            {
              id: 'decision-1',
              action: 'BUY',
              side: 'YES',
              reason: 'Edge survives costs',
              confidence: 0.78,
              edge: 0.11,
              urgency: 'HIGH',
              mode: 'PAPER',
              executionMode: 'SIMULATED',
              createdAt: new Date('2026-05-15T10:00:30.000Z'),
            },
          ],
          orders: [
            {
              id: 'order-1',
              venueOrderId: 'v-1',
              side: 'YES',
              price: 0.61,
              size: 245,
              filledSize: 245,
              remainingSize: 0,
              avgFillPrice: 0.61,
              failureReason: null,
              status: 'FILLED',
              lifecycleStatus: 'FILLED',
              executionMode: 'SIMULATED',
              submittedAt: new Date('2026-05-15T10:01:00.000Z'),
              filledAt: new Date('2026-05-15T10:01:20.000Z'),
              cancelledAt: null,
              expiredAt: null,
              createdAt: new Date('2026-05-15T10:01:00.000Z'),
              updatedAt: new Date('2026-05-15T10:01:20.000Z'),
            },
          ],
          paperBets: [],
          outcomes: [],
          researchRuns: [
            {
              status: 'RUNNING',
              startedAt: new Date('2026-05-15T09:58:00.000Z'),
              completedAt: null,
              createdAt: new Date('2026-05-15T09:58:00.000Z'),
              agentOutputs: [
                {
                  role: 'BULL',
                  summary: 'Momentum is improving fast.',
                  output: 'Momentum is improving fast.',
                  failureReason: null,
                  createdAt: new Date('2026-05-15T09:58:30.000Z'),
                },
                {
                  role: 'BEAR',
                  summary: 'Macro headwinds remain.',
                  output: 'Macro headwinds remain.',
                  failureReason: null,
                  createdAt: new Date('2026-05-15T09:58:45.000Z'),
                },
                {
                  role: 'JUDGE',
                  summary: 'Bull case leads for now.',
                  output: 'Bull case leads for now.',
                  failureReason: null,
                  createdAt: new Date('2026-05-15T09:59:00.000Z'),
                },
              ],
            },
          ],
        },
        {
          id: 'market-2',
          title: 'Will ETH hold support?',
          venue: 'KALSHI',
          category: 'crypto',
          status: 'ACTIVE',
          resolutionTime: null,
          updatedAt: new Date('2026-05-15T08:00:00.000Z'),
          snapshots: [],
          tradeCandidates: [],
          decisions: [
            {
              id: 'decision-2',
              action: 'SKIP',
              side: null,
              reason: 'Needs better liquidity',
              confidence: 0.42,
              edge: 0.01,
              urgency: 'LOW',
              mode: 'PAPER',
              executionMode: 'SIMULATED',
              createdAt: new Date('2026-05-15T08:00:00.000Z'),
            },
          ],
          orders: [],
          paperBets: [],
          outcomes: [],
          researchRuns: [],
        },
      ] as never,
    });

    expect(payload.summary.currentlyPlaying).toBe('Will BTC rally?');
    expect(payload.summary.openBets).toBe(0);
    expect(payload.summary.pendingDecisions).toBe(1);
    expect(payload.summary.exposure).toBe(245);
    expect(payload.focus.marketId).toBe('market-1');
    expect(payload.focus.stage).toBe('RISK');
    expect(payload.focus.bullThesis).toBe('Momentum is improving fast.');
    expect(payload.markets).toHaveLength(2);
    const btcMarket = payload.markets.find((market) => market.marketId === 'market-1');
    const ethMarket = payload.markets.find((market) => market.marketId === 'market-2');
    expect(btcMarket?.attempts).toHaveLength(1);
    expect(btcMarket?.attempts[0].kind).toBe('ORDER');
    expect(btcMarket?.attempts[0].status).toBe('FILLED');
    expect(ethMarket?.attempts[0].kind).toBe('DECISION');
    expect(ethMarket?.attempts[0].status).toBe('WATCH');
  });
});
