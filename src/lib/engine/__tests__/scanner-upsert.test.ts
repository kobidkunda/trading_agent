import { beforeEach, describe, expect, it, mock } from 'bun:test';

const marketFindFirstMock = mock(async () => null);
const marketCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'market-1', ...data }));
const marketUpdateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'market-1', ...data }));
const marketSnapshotCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'snapshot-1', ...data }));
const tradeCandidateCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'candidate-1', ...data }));
const tradeCandidateFindFirstMock = mock(async () => null);
const tradeCandidateUpdateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'candidate-1', ...data }));
const jobCreateMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: `${data.type}-job`, ...data }));

mock.module('@/lib/db', () => ({
  db: {
    market: {
      findFirst: marketFindFirstMock,
      create: marketCreateMock,
      update: marketUpdateMock,
    },
    marketSnapshot: {
      create: marketSnapshotCreateMock,
    },
    tradeCandidate: {
      create: tradeCandidateCreateMock,
      findFirst: tradeCandidateFindFirstMock,
      update: tradeCandidateUpdateMock,
    },
    job: {
      create: jobCreateMock,
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
    tradeCandidateCreateMock.mockClear();
    tradeCandidateFindFirstMock.mockClear();
    tradeCandidateFindFirstMock.mockImplementation(async () => null);
    tradeCandidateUpdateMock.mockClear();
    jobCreateMock.mockClear();
  });

  it('creates downstream jobs for triage and research worthy new candidates', async () => {
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
    expect(result.scoreAction).toBe('TRIAGE');
    expect(jobCreateMock).toHaveBeenCalledTimes(1);
  });
});
