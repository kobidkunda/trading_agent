import { beforeEach, describe, expect, it, mock } from 'bun:test';

let currentOutcome: { id: string; marketId: string; result: 'YES' | 'NO' | 'CANCELLED'; resolvedProb: number | null } | null = null;
let currentMarketOracleCheck: { riskLevel: string; manualReviewStatus: string | null } | null = null;
let tradingModeValue: string | null = null;
let queuedJob: Record<string, unknown> | null = null;
let activeMarkets: Array<Record<string, unknown>> = [];
let paperBets: Array<Record<string, unknown>> = [];
let positions: Array<Record<string, unknown>> = [];

const outcomeFindFirstMock = mock(async ({ where }: { where: { marketId: string } }) => {
  if (currentOutcome && currentOutcome.marketId === where.marketId) return currentOutcome;
  return null;
});
const outcomeFindManyMock = mock(async ({ where }: { where: { marketId: string } }) => {
  if (currentOutcome && currentOutcome.marketId === where.marketId) return [currentOutcome] as any[];
  return [] as any[];
});
const outcomeCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => {
  currentOutcome = {
    id: 'outcome-created',
    marketId: String(data.marketId),
    result: data.result as 'YES' | 'NO' | 'CANCELLED',
    resolvedProb: (data.resolvedProb as number | null) ?? null,
  };
  return currentOutcome;
});
const marketUpdateMock = mock(async () => ({ id: 'market-1' }));
const marketFindManyMock = mock(async () => activeMarkets as any[]);
const marketCountMock = mock(async () => activeMarkets.length);
const marketFindUniqueMock = mock(async () => ({
  id: 'market-any',
  oracleCheck: currentMarketOracleCheck,
}));
const settingsFindUniqueMock = mock(async ({ where }: { where: { key: string } }) => {
  if (where.key === 'trading_mode') return { key: 'trading_mode', value: tradingModeValue ?? 'PAPER' } as any;
  return null as any;
});
const auditCreateMock = mock(async () => ({ id: 'audit-1' }));
const tradeCandidateCountMock = mock(async () => 1);
const tradeCandidateUpdateManyMock = mock(async () => ({ count: 1 }));
const tradeCandidateFindUniqueMock = mock(async () => null);
const researchRunUpdateManyMock = mock(async () => ({ count: 0 }));
const researchRunFindFirstMock = mock(async () => null);
const decisionFindManyMock = mock(async () => ([{ id: 'decision-1', judgeProbability: 0.7 } as any]));
const decisionUpdateMock = mock(async () => ({ id: 'decision-1' }));
const jobFindFirstMock = mock(async () => queuedJob as any);
const jobUpdateMock = mock(async () => ({ id: 'job-1' }));
const jobFindManyMock = mock(async () => []);
const paperBetFindManyMock = mock(async () => paperBets as any[]);
const paperBetFindUniqueMock = mock(async ({ where }: { where: { id: string } }) =>
  (paperBets.find((bet) => bet.id === where.id) as any) ?? null,
);
const paperBetUpdateMock = mock(async ({ where, data }: { where: { id: string }, data: Record<string, unknown> }) => {
  const idx = paperBets.findIndex((bet) => bet.id === where.id);
  if (idx >= 0) paperBets[idx] = { ...paperBets[idx], ...data };
  return idx >= 0 ? (paperBets[idx] as any) : null;
});
const positionCountMock = mock(async () => positions.length);
const positionFindManyMock = mock(async () => positions as any[]);
const positionUpdateMock = mock(async ({ where, data }: { where: { id: string }, data: Record<string, unknown> }) => {
  const idx = positions.findIndex((pos) => pos.id === where.id);
  if (idx >= 0) positions[idx] = { ...positions[idx], ...data };
  return idx >= 0 ? (positions[idx] as any) : null;
});

mock.module('@/lib/db', () => ({
  db: {
    outcome: { findFirst: outcomeFindFirstMock, findMany: outcomeFindManyMock, create: outcomeCreateMock },
    market: { update: marketUpdateMock, findMany: marketFindManyMock, count: marketCountMock, findUnique: marketFindUniqueMock },
    auditLog: { create: auditCreateMock },
    tradeCandidate: {
      count: tradeCandidateCountMock,
      updateMany: tradeCandidateUpdateManyMock,
      findUnique: tradeCandidateFindUniqueMock,
    },
    decision: { findMany: decisionFindManyMock, update: decisionUpdateMock },
    researchRun: { updateMany: researchRunUpdateManyMock, findFirst: researchRunFindFirstMock },
    job: { findFirst: jobFindFirstMock, update: jobUpdateMock, findMany: jobFindManyMock },
    settings: { findUnique: settingsFindUniqueMock },
    paperBet: {
      findMany: paperBetFindManyMock,
      findUnique: paperBetFindUniqueMock,
      update: paperBetUpdateMock,
    },
    position: {
      count: positionCountMock,
      findMany: positionFindManyMock,
      update: positionUpdateMock,
    },
  },
}));

mock.module('@/lib/engine/worker-checkpoint', () => ({
  saveCheckpoint: mock(async () => undefined),
  saveFailureCheckpoint: mock(async () => undefined),
  saveDeepResearchProgress: mock(async () => undefined),
  deleteCheckpoint: mock(async () => undefined),
  loadDeepResearchProgress: mock(async () => null),
  logStageTransition: mock(async () => undefined),
}));

describe('settlement flows', () => {
  beforeEach(() => {
    currentOutcome = null;
    queuedJob = null;
    activeMarkets = [];
    paperBets = [
      {
        id: 'bet-1',
        marketId: 'market-any',
        executionStatus: 'FILLED',
        actualOutcome: null,
        predictedProb: 0.7,
        predictedSide: 'YES',
        entryPrice: 0.4,
        stake: 100,
      },
    ];
    positions = [
      { id: 'pos-1', marketId: 'market-any', status: 'OPEN', side: 'YES', entryPrice: 0.4, currentSize: 100 },
    ];

    outcomeFindFirstMock.mockClear();
    outcomeFindManyMock.mockClear();
    outcomeCreateMock.mockClear();
    marketUpdateMock.mockClear();
    marketFindManyMock.mockClear();
    auditCreateMock.mockClear();
    tradeCandidateCountMock.mockClear();
    tradeCandidateUpdateManyMock.mockClear();
    currentMarketOracleCheck = null;
    tradingModeValue = 'PAPER';

    decisionFindManyMock.mockClear();
    decisionUpdateMock.mockClear();
    jobFindFirstMock.mockClear();
    jobUpdateMock.mockClear();
    paperBetFindManyMock.mockClear();
    paperBetFindUniqueMock.mockClear();
    paperBetUpdateMock.mockClear();
    positionCountMock.mockClear();
    positionFindManyMock.mockClear();
    positionUpdateMock.mockClear();
  });

  it('reconciles an existing outcome without duplicating it', async () => {
    currentOutcome = { id: 'outcome-1', marketId: 'market-existing', result: 'YES', resolvedProb: 1 };
    paperBets = [{ ...paperBets[0], marketId: 'market-existing' }];
    positions = [{ ...positions[0], marketId: 'market-existing' }];
    const { reconcileMarketResolution } = await import('../resolution-poller');

    const result = await reconcileMarketResolution({
      marketId: 'market-existing',
      outcome: 'NO',
      resolvedProb: 0,
      source: 'TEST',
    });

    expect(result.outcomeCreated).toBe(false);
    expect(result.outcomeRecord.result).toBe('YES');
    expect(outcomeCreateMock).toHaveBeenCalledTimes(0);
    expect(paperBetUpdateMock).toHaveBeenCalledTimes(1);
    expect(decisionUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('creates and reconciles a fresh outcome', async () => {
    paperBets = [{ ...paperBets[0], marketId: 'market-new' }];
    positions = [{ ...positions[0], marketId: 'market-new' }];
    const { reconcileMarketResolution } = await import('../resolution-poller');

    const result = await reconcileMarketResolution({
      marketId: 'market-new',
      outcome: 'YES',
      resolvedProb: 1,
      source: 'TEST',
    });

    expect(result.outcomeCreated).toBe(true);
    expect(outcomeCreateMock).toHaveBeenCalledTimes(1);
    expect(paperBetUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('settles NO positions with the same contract payoff formula as paper bets', async () => {
    paperBets = [{
      ...paperBets[0],
      marketId: 'market-no-win',
      predictedSide: 'NO',
      entryPrice: 0.2,
    }];
    positions = [{
      id: 'pos-no',
      marketId: 'market-no-win',
      status: 'OPEN',
      side: 'NO',
      entryPrice: 0.2,
      currentSize: 100,
    }];
    const { reconcileMarketResolution } = await import('../resolution-poller');

    await reconcileMarketResolution({
      marketId: 'market-no-win',
      outcome: 'NO',
      resolvedProb: 0,
      source: 'TEST',
    });

    expect(positionUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pos-no' },
      data: expect.objectContaining({ realizedPnl: 80 }),
    }));
  });

  it('POST /api/outcomes rejects duplicate manual outcomes', async () => {
    currentOutcome = { id: 'outcome-dupe', marketId: 'market-route', result: 'YES', resolvedProb: 1 };
    const { POST } = await import('../../../app/api/outcomes/route');

    const response = await POST(new Request('http://localhost/api/outcomes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketId: 'market-route', result: 'YES', resolvedProb: 1 }),
    }) as never);

    expect(response.status).toBe(409);
  });

  it('POST /api/outcomes reconciles immediately', async () => {
    paperBets = [{ ...paperBets[0], marketId: 'market-route' }];
    positions = [{ ...positions[0], marketId: 'market-route' }];
    const { POST } = await import('../../../app/api/outcomes/route');

    const response = await POST(new Request('http://localhost/api/outcomes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketId: 'market-route', result: 'YES', resolvedProb: 1 }),
    }) as never);

    const payload = await response.json();
    expect(response.status).toBe(201);
    expect(payload.marketId).toBe('market-route');
    expect(paperBetUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('PUT /api/outcomes runs reconciliation cycle for existing outcomes', async () => {
    currentOutcome = { id: 'outcome-resolved', marketId: 'market-cycle', result: 'YES', resolvedProb: 1 };
    paperBets = [{ ...paperBets[0], marketId: 'market-cycle' }];
    positions = [{ ...positions[0], marketId: 'market-cycle' }];
    activeMarkets = [{
      id: 'market-cycle',
      venue: 'POLYMARKET',
      externalId: 'ext-1',
      status: 'RESOLVED',
      outcomes: [currentOutcome],
      decisions: [{ id: 'decision-1', dryRun: true }],
    }];

    const { PUT } = await import('../../../app/api/outcomes/route');
    const response = await PUT();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.checked).toBe(1);
    expect(payload.scored).toBe(1);
    expect(paperBetUpdateMock).toHaveBeenCalledTimes(1);
  });

  it('resolution cycle excludes quarantined Kalshi combo markets', async () => {
    activeMarkets = [];
    const { runResolutionCycle } = await import('../resolution-poller');

    await runResolutionCycle({ limit: 5 });

    const findManyCalls = (marketFindManyMock as any).mock.calls as Array<Array<{ where?: Record<string, any> }>>;
    expect(findManyCalls.length).toBeGreaterThanOrEqual(2);
    expect(findManyCalls[0]?.[0]?.where?.OR).toContainEqual({ duplicateStatus: null });
    expect(findManyCalls[0]?.[0]?.where?.OR).toContainEqual({ duplicateStatus: { not: 'INVALID_KALSHI_COMBO' } });
    expect(findManyCalls[1]?.[0]?.where?.AND?.[0]?.OR).toContainEqual({ duplicateStatus: null });
    expect(findManyCalls[1]?.[0]?.where?.AND?.[0]?.OR).toContainEqual({ duplicateStatus: { not: 'INVALID_KALSHI_COMBO' } });
  });

  it('queued PAPER_EXECUTE quarantines when oracle risk is BLOCK in LIVE mode', async () => {
    currentMarketOracleCheck = { riskLevel: 'BLOCK', manualReviewStatus: 'PENDING' };
    tradingModeValue = 'LIVE';
    queuedJob = {
      id: 'job-quarantine',
      type: 'PAPER_EXECUTE',
      payload: JSON.stringify({
        marketId: 'market-any',
        decisionId: 'decision-1',
        judgeProbability: 0.62,
        judgeConfidence: 0.55,
        judgeUncertainty: 0.28,
        aPlusGatePassed: true,
      }),
      retryCount: 0,
      maxRetries: 3,
      maxRuntimeSec: 300,
    };

    const worker = await import('../worker');
    const result = await worker.processNextQueuedJobOnce();

    expect(result?.status).toBe('COMPLETED');
    const completedCall = ((jobUpdateMock as any).mock.calls.at(-1)?.[0] as any)?.data;
    const completedResult = JSON.parse(String(completedCall?.result));
    expect(completedResult.status).toBe('ANOMALY_QUARANTINED');
    expect(tradeCandidateUpdateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { marketId: 'market-any' },
      data: expect.objectContaining({
        stage: 'WATCHING',
        skipReason: 'ANOMALY_QUARANTINE_TRIGGERED',
      }),
    }));
  });

  it('queued SETTLE with existing outcome reconciles directly', async () => {
    currentOutcome = { id: 'outcome-1', marketId: 'market-with-outcome', result: 'YES', resolvedProb: 1 };
    paperBets = [{ ...paperBets[0], marketId: 'market-with-outcome' }];
    positions = [{ ...positions[0], marketId: 'market-with-outcome' }];
    queuedJob = {
      id: 'job-1',
      type: 'SETTLE',
      payload: JSON.stringify({ marketId: 'market-with-outcome' }),
      retryCount: 0,
      maxRetries: 3,
      maxRuntimeSec: 300,
    };

    const worker = await import('../worker');
    const result = await worker.processNextQueuedJobOnce();

    expect(result?.status).toBe('COMPLETED');
    const completedCall = ((jobUpdateMock as any).mock.calls.at(-1)?.[0] as any)?.data;
    expect(JSON.parse(String(completedCall?.result)).status).toBe('SETTLED');
  });

  it('queued SETTLE without marketId falls back to resolution cycle', async () => {
    activeMarkets = [];
    queuedJob = {
      id: 'job-2',
      type: 'SETTLE',
      payload: JSON.stringify({}),
      retryCount: 0,
      maxRetries: 3,
      maxRuntimeSec: 300,
    };

    const worker = await import('../worker');
    const result = await worker.processNextQueuedJobOnce();

    expect(result?.status).toBe('COMPLETED');
    const completedCall = ((jobUpdateMock as any).mock.calls.at(-1)?.[0] as any)?.data;
    expect(JSON.parse(String(completedCall?.result)).status).toBe('RESOLUTION_CYCLE_COMPLETED');
  });
});
