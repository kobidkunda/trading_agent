import { beforeEach, describe, expect, it, mock } from 'bun:test';

const marketFindFirstMock = mock(async () => null);
const marketCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'market-1', ...data }));
const marketUpdateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'market-1', ...data }));
const marketSnapshotCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'snapshot-1', ...data }));
const tradeCandidateCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'candidate-1', ...data }));
const tradeCandidateFindFirstMock = mock(async () => null);
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
    marketFindFirstMock.mockClear();
    marketFindFirstMock.mockImplementation(async () => null);
    marketCreateMock.mockClear();
    marketUpdateMock.mockClear();
    marketSnapshotCreateMock.mockClear();
    historicalSnapshotCreateMock.mockClear();
    orderbookSnapshotCreateMock.mockClear();
    tradeCandidateCreateMock.mockClear();
    tradeCandidateFindFirstMock.mockClear();
    tradeCandidateFindFirstMock.mockImplementation(async () => null);
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
    expect(result.scoreAction).toBe('SNAPSHOT_ONLY');
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
    expect(jobCreateMock).not.toHaveBeenCalled();
  });
});
