import { beforeEach, describe, expect, it, mock } from 'bun:test';

const marketFindFirstMock = mock(async () => null);
const marketUpsertMock = mock(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'market-1', ...create }));
const marketCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'market-1', ...data }));
const marketUpdateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'market-1', ...data }));
const marketSnapshotCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'snapshot-1', ...data }));
const tradeCandidateCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'candidate-1', ...data }));
const tradeCandidateFindFirstMock = mock(async () => null);
const tradeCandidateFindUniqueMock = mock(async () => null);
const tradeCandidateUpsertMock = mock(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'candidate-1', ...create }));
const tradeCandidateUpdateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'candidate-1', ...data }));
const jobCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: `${data.type}-job`, ...data }));
const historicalSnapshotCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'historical-1', ...data }));
const orderbookSnapshotCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'orderbook-1', ...data }));
const marketFindUniqueMock = mock(async () => null);
const correlationClusterFindUniqueMock = mock(async () => null);
const correlationClusterCreateMock = mock(async () => ({ id: 'cluster-1' }));
const clusterMarketLinkUpsertMock = mock(async () => ({ id: 'link-1' }));

mock.module('@/lib/db', () => ({
  db: {
    market: {
      findFirst: marketFindFirstMock,
      findUnique: marketFindUniqueMock,
      upsert: marketUpsertMock,
      create: marketCreateMock,
      update: marketUpdateMock,
    },
    marketSnapshot: {
      create: marketSnapshotCreateMock,
    },
    historicalSnapshot: {
      create: historicalSnapshotCreateMock,
    },
    orderbookSnapshot: {
      create: orderbookSnapshotCreateMock,
    },
    tradeCandidate: {
      create: tradeCandidateCreateMock,
      findFirst: tradeCandidateFindFirstMock,
      findUnique: tradeCandidateFindUniqueMock,
      upsert: tradeCandidateUpsertMock,
      update: tradeCandidateUpdateMock,
    },
    job: {
      create: jobCreateMock,
    },
    correlationCluster: {
      findUnique: correlationClusterFindUniqueMock,
      create: correlationClusterCreateMock,
    },
    clusterMarketLink: {
      upsert: clusterMarketLinkUpsertMock,
    },
  },
}));

describe('scanner upsert', () => {
  beforeEach(() => {
    delete process.env.SCANNER_BACKGROUND_MAINTENANCE;
    marketFindFirstMock.mockClear();
    marketFindFirstMock.mockImplementation(async () => null);
    marketUpsertMock.mockClear();
    marketCreateMock.mockClear();
    marketUpdateMock.mockClear();
    marketSnapshotCreateMock.mockClear();
    historicalSnapshotCreateMock.mockClear();
    orderbookSnapshotCreateMock.mockClear();
    tradeCandidateCreateMock.mockClear();
    tradeCandidateFindFirstMock.mockClear();
    tradeCandidateFindFirstMock.mockImplementation(async () => null);
    tradeCandidateFindUniqueMock.mockClear();
    tradeCandidateFindUniqueMock.mockImplementation(async () => null);
    tradeCandidateUpsertMock.mockClear();
    tradeCandidateUpdateMock.mockClear();
    jobCreateMock.mockClear();
    marketFindUniqueMock.mockClear();
    correlationClusterFindUniqueMock.mockClear();
    correlationClusterFindUniqueMock.mockResolvedValue(null);
    correlationClusterCreateMock.mockClear();
    clusterMarketLinkUpsertMock.mockClear();
  });

  it('keeps snapshot-only new candidates out of the job queue', async () => {
    const { upsertScannedMarket } = await import('../scanner-upsert');

    const result = await upsertScannedMarket({
      scanRunId: 'scan-1',
      market: {
        externalId: 'poly-1',
        title: 'Real worthy market',
        description: 'sample',
        category: 'crypto',
        venue: 'POLYMARKET',
        status: 'ACTIVE',
        impliedProb: 0.61,
        liquidity: 250000,
        spread: 0.005,
        volume24h: 240000,
        bestBid: 0.6,
        bestAsk: 0.62,
      },
    });

    expect(result.created).toBe(true);
    expect(jobCreateMock).not.toHaveBeenCalled();
  });

  it('can suppress candidate job enqueueing for scan-only passes', async () => {
    const { upsertScannedMarket } = await import('../scanner-upsert');

    const result = await upsertScannedMarket({
      scanRunId: 'scan-1',
      enqueueCandidateJobs: false,
      market: {
        externalId: 'poly-2',
        title: 'Scan only market',
        description: 'sample',
        category: 'crypto',
        venue: 'POLYMARKET',
        status: 'ACTIVE',
        impliedProb: 0.61,
        liquidity: 250000,
        spread: 0.005,
        volume24h: 240000,
        bestBid: 0.6,
        bestAsk: 0.62,
      },
    });

    expect(result.created).toBe(true);
    expect(result.scoreAction).toBeDefined();
    expect(jobCreateMock).not.toHaveBeenCalled();
  });

  it('does not run scan-side relation maintenance unless explicitly enabled', async () => {
    const { upsertScannedMarket } = await import('../scanner-upsert');

    await upsertScannedMarket({
      scanRunId: 'scan-1',
      market: {
        externalId: 'poly-3',
        title: 'No background maintenance market',
        description: 'sample',
        category: 'crypto',
        venue: 'POLYMARKET',
        status: 'ACTIVE',
        impliedProb: 0.61,
        liquidity: 250000,
        spread: 0.005,
        volume24h: 240000,
        bestBid: 0.6,
        bestAsk: 0.62,
      },
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(marketFindUniqueMock).not.toHaveBeenCalled();
    expect(correlationClusterCreateMock).not.toHaveBeenCalled();
    expect(clusterMarketLinkUpsertMock).not.toHaveBeenCalled();
  });

  it('runs scan-side relation maintenance through the bounded opt-in queue', async () => {
    process.env.SCANNER_BACKGROUND_MAINTENANCE = '1';
    const { enqueueScannerBackgroundMaintenance } = await import('../scanner-upsert');

    enqueueScannerBackgroundMaintenance({
      id: 'market-1',
      title: 'Queued maintenance market',
      category: 'crypto',
      venue: 'POLYMARKET',
      resolutionTime: null,
    });

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(marketFindUniqueMock).toHaveBeenCalled();
    expect(correlationClusterCreateMock).toHaveBeenCalled();
    expect(clusterMarketLinkUpsertMock).toHaveBeenCalled();
  });
});
