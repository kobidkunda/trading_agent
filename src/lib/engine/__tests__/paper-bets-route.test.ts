import { beforeEach, describe, expect, it, mock } from 'bun:test';

const paperLoopTestBet = {
  id: 'paper-test-bet',
  marketId: 'market-1',
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
  market: {
    title: 'Test V2: Paper Orders should work in paper mode',
    venue: 'KALSHI',
    externalId: 'PAPER_TEST_MARKET',
  },
};

const paperBetFindManyMock = mock(async (args?: { where?: { market?: { title?: { not?: string }, externalId?: { not?: string } } } }) => {
  const marketWhere = args?.where?.market;
  if (
    marketWhere?.title?.not === paperLoopTestBet.market.title
    || marketWhere?.externalId?.not === paperLoopTestBet.market.externalId
  ) {
    return [];
  }
  return [paperLoopTestBet];
});
const paperBetCountMock = mock(async () => 0);
const paperBetGroupByMock = mock(async () => []);
const paperBetFindUniqueMock = mock(async () => ({
  id: 'paper-test-bet',
  marketId: 'market-1',
}));
const reconcileMarketResolutionMock = mock(async () => ({
  outcomeCreated: true,
  outcomeRecord: {
    id: 'outcome-1',
    marketId: 'market-1',
    result: 'YES',
    resolvedProb: 1,
  },
}));

mock.module('@/lib/db', () => ({
  db: {
    paperBet: {
      findMany: paperBetFindManyMock,
      count: paperBetCountMock,
      groupBy: paperBetGroupByMock,
      findUnique: paperBetFindUniqueMock,
      update: mock(async () => null),
    },
    position: {
      findMany: mock(async () => []),
      update: mock(async () => null),
    },
  },
}));

mock.module('@/lib/engine/resolution-poller', () => ({
  reconcileMarketResolution: reconcileMarketResolutionMock,
  runResolutionCycle: mock(async () => ({ status: 'NOOP' })),
}));

mock.module('@/lib/engine/profit-evidence', () => ({
  summarizeProfitEvidence: (counts: {
    resolvedPaperBets: number;
    executedUnresolvedPaperBets: number;
    historicalResolvedMarkets: number;
    historicalResolvedWithPredictions: number;
    openPaperStake?: number;
    openModelExpectedValue?: number;
    openModelExpectedRoi?: number | null;
    openPositiveEvBets?: number;
    openNegativeEvBets?: number;
    openAverageEdge?: number | null;
  }) => {
    const normalized = {
      ...counts,
      openPaperStake: Math.round((counts.openPaperStake ?? 0) * 100) / 100,
      openModelExpectedValue: Math.round((counts.openModelExpectedValue ?? 0) * 100) / 100,
      openModelExpectedRoi: counts.openModelExpectedRoi == null ? null : Math.round(counts.openModelExpectedRoi * 10000) / 10000,
      openPositiveEvBets: counts.openPositiveEvBets ?? 0,
      openNegativeEvBets: counts.openNegativeEvBets ?? 0,
      openAverageEdge: counts.openAverageEdge == null ? null : Math.round(counts.openAverageEdge * 10000) / 10000,
    };
    if (counts.resolvedPaperBets > 0 || counts.historicalResolvedWithPredictions > 0) {
      return { ...normalized, status: 'AVAILABLE', canEvaluateProfit: true, reason: 'Profit evidence is available from resolved paper bets or historical markets that also have archived predictions.' };
    }
    if (counts.executedUnresolvedPaperBets > 0) {
      return {
        ...normalized,
        status: 'AWAITING_RESOLUTION',
        canEvaluateProfit: false,
        reason: normalized.openModelExpectedValue > 0
          ? 'Paper bets have been placed with real data and are positive expected value by stored model probabilities, but none have resolved yet. ROI/PnL is not meaningful until settlement.'
          : 'Paper bets have been placed with real data, but none have resolved yet. ROI/PnL is not meaningful until settlement.',
      };
    }
    return { ...normalized, status: 'UNAVAILABLE', canEvaluateProfit: false, reason: 'No resolved paper bets and no historical resolved markets with archived predictions were found. ROI/PnL cannot be evaluated yet.' };
  },
  getProfitEvidenceSummary: mock(async () => ({
    status: 'UNAVAILABLE',
    canEvaluateProfit: false,
    reason: 'No resolved paper bets and no historical resolved markets with archived predictions were found. ROI/PnL cannot be evaluated yet.',
    resolvedPaperBets: 0,
    executedUnresolvedPaperBets: 0,
    historicalResolvedMarkets: 0,
    historicalResolvedWithPredictions: 0,
    openPaperStake: 0,
    openModelExpectedValue: 0,
    openModelExpectedRoi: null,
    openPositiveEvBets: 0,
    openNegativeEvBets: 0,
    openAverageEdge: null,
  })),
  getPaperSettlementReadiness: mock(async () => ({
    executedUnresolvedPaperBets: 0,
    executedUnresolvedWithArchivedPrediction: 0,
    missingArchivedPrediction: 0,
    executedUnresolvedPaperBetMarkets: 0,
    activeResolutionJobMarkets: 0,
    missingResolutionJobs: 0,
    dueResolutionJobs: 0,
    nextResolutionAt: null,
    nextResolutionMarket: null,
  })),
}));

describe('paper-bets route', () => {
  beforeEach(() => {
    paperBetFindManyMock.mockClear();
    paperBetCountMock.mockClear();
    paperBetGroupByMock.mockClear();
    paperBetFindUniqueMock.mockClear();
    reconcileMarketResolutionMock.mockClear();
  });

  it('excludes paper-loop test market rows when metrics include them', async () => {
    const { GET } = await import('../../../app/api/paper-bets/route');

    const res = await GET(new Request('http://localhost/api/paper-bets?limit=25') as never);
    const payload = await res.json();

    expect(payload.data).toHaveLength(0);
    expect(payload.totalBets).toBe(0);
    expect(payload.executedBets).toBe(0);
    expect(payload.profitEvidence.status).toBe('UNAVAILABLE');
    expect(payload.settlementReadiness.executedUnresolvedPaperBets).toBe(0);
  });

  it('resolves a paper bet through canonical market outcome reconciliation', async () => {
    const { POST } = await import('../../../app/api/paper-bets/route');

    const res = await POST(new Request('http://localhost/api/paper-bets', {
      method: 'POST',
      body: JSON.stringify({ action: 'resolve_bet', betId: 'paper-test-bet', actualOutcome: 'YES', resolvedProb: 1 }),
    }) as never);
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(reconcileMarketResolutionMock).toHaveBeenCalledWith({
      marketId: 'market-1',
      outcome: 'YES',
      resolvedProb: 1,
      source: 'PAPER_BET_MANUAL_RESOLVE',
    });
    expect(payload.outcome.result).toBe('YES');
  });
});
