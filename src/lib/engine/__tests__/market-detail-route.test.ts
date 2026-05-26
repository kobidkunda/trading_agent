import { beforeEach, describe, expect, it, mock } from 'bun:test';

const researchStartedAt = new Date('2026-05-25T03:23:47.509Z');
const researchCompletedAt = new Date('2026-05-25T03:30:21.011Z');
const candidateCreatedAt = new Date('2026-05-24T03:35:56.629Z');
const candidateUpdatedAt = new Date('2026-05-25T03:30:46.806Z');
const decisionCreatedAt = new Date('2026-05-25T03:30:46.700Z');
const paperBetCreatedAt = new Date('2026-05-25T03:30:46.764Z');

const marketFindUniqueMock = mock(async () => ({
  id: 'market-1',
  title: 'Will Tulsi Gabbard leave Director of National Intelligence before Jun 1, 2026?',
  description: 'Market detail regression fixture',
  venue: 'KALSHI',
  status: 'ACTIVE',
  externalId: 'kalshi-market-1',
  category: 'politics',
  resolutionTime: new Date('2026-06-01T03:59:00.000Z'),
  snapshots: [{
    impliedProb: 0.018,
    spread: 0.001,
    liquidity: 1700000,
    timestamp: new Date('2026-05-25T03:30:00.000Z'),
  }],
  tradeCandidates: [{
    id: 'candidate-1',
    stage: 'EXECUTION_PENDING',
    candidateScore: 62.27,
    triageStatus: 'RELEVANT',
    researchQueued: true,
    skipReason: null,
    lastError: null,
    reprocessReason: JSON.stringify([
      {
        from: 'TRIAGED',
        to: 'RESEARCHING',
        timestamp: '2026-05-25T03:23:47.000Z',
        jobId: 'job-research',
      },
      {
        from: 'DECIDED',
        to: 'EXECUTED',
        timestamp: '2026-05-25T03:30:46.000Z',
        jobId: 'job-execute',
      },
    ]),
    createdAt: candidateCreatedAt,
    updatedAt: candidateUpdatedAt,
    lastProcessedAt: candidateUpdatedAt,
  }],
  researchRuns: [{
    id: 'research-1',
    status: 'COMPLETED',
    depth: 'FULL',
    startedAt: researchStartedAt,
    completedAt: researchCompletedAt,
    createdAt: researchStartedAt,
    updatedAt: researchCompletedAt,
    sources: [
      {
        id: 'source-1',
        title: 'Tulsi Gabbard resigns as director of national intelligence',
        url: 'https://example.com/tulsi-gabbard-resigns',
        content: 'Tulsi Gabbard resigns as director of national intelligence.',
        sourceType: 'SEARCH',
        provider: 'SEARXNG',
      },
      {
        id: 'source-2',
        title: 'Tulsi Gabbard resigns as Director of National Intelligence',
        url: 'https://reddit.com/r/news/comments/example',
        content: JSON.stringify({
          title: 'Tulsi Gabbard resigns as Director of National Intelligence',
          subreddit: 'news',
          score: 120,
          numComments: 12,
          selftext: 'Relevant discussion',
          upvoteRatio: 0.95,
        }),
        sourceType: 'REDDIT',
        provider: 'REDDIT',
      },
    ],
    agentOutputs: [
      {
        role: 'BULL',
        stage: 'DEBATE',
        serviceName: 'tradingagents',
        provider: 'tradingagents',
        modelUsed: 'fixture-model',
        output: 'Bull thesis text',
        rawOutput: 'Bull thesis text',
        summary: 'Bull summary',
        referencesJson: '[]',
        failureReason: null,
        startedAt: researchStartedAt,
        endedAt: researchCompletedAt,
      },
      {
        role: 'JUDGE',
        stage: 'JUDGE',
        serviceName: 'tradingagents',
        provider: 'tradingagents',
        modelUsed: 'fixture-model',
        output: JSON.stringify({ decision: 'BID' }),
        rawOutput: JSON.stringify({ decision: 'BID' }),
        summary: 'Judge summary',
        referencesJson: '[]',
        failureReason: null,
        startedAt: researchStartedAt,
        endedAt: researchCompletedAt,
      },
    ],
  }],
  decisions: [{
    id: 'decision-1',
    action: 'BID',
    side: 'YES',
    judgeProbability: 0.05,
    impliedProb: 0.018,
    edge: 0.032,
    confidence: 0.85,
    reason: 'Strong edge',
    reasonCode: null,
    createdAt: decisionCreatedAt,
  }],
  outcomes: [],
  paperBets: [{
    id: 'paper-bet-1',
    orderId: 'order-1',
    executionStatus: 'PARTIAL',
    stake: 10.28,
    entryPrice: 0.018405,
    predictedProb: 0.05,
    predictedSide: 'YES',
    actualOutcome: null,
    resolvedProb: null,
    pnl: null,
    brierScore: null,
    directionCorrect: null,
    createdAt: paperBetCreatedAt,
    executedAt: paperBetCreatedAt,
    updatedAt: paperBetCreatedAt,
    resolvedAt: null,
  }],
  postmortems: [],
}));
const orderbookSnapshotCountMock = mock(async () => 1);
const auditLogFindManyMock = mock(async () => []);

mock.module('@/lib/db', () => ({
  db: {
    market: { findUnique: marketFindUniqueMock },
    orderbookSnapshot: { count: orderbookSnapshotCountMock },
    auditLog: { findMany: auditLogFindManyMock },
  },
}));

describe('market detail route', () => {
  beforeEach(() => {
    marketFindUniqueMock.mockClear();
    orderbookSnapshotCountMock.mockClear();
    auditLogFindManyMock.mockClear();
  });

  it('exposes research run summaries, sources, and durable pipeline stages for researched markets', async () => {
    const { GET } = await import('../../../app/api/market/[id]/detail/route');

    const res = await GET(
      new Request('http://localhost/api/market/market-1/detail') as never,
      { params: Promise.resolve({ id: 'market-1' }) },
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.counts.researchRuns).toBe(1);
    expect(payload.researchRuns).toHaveLength(1);
    expect(payload.researchRuns[0]).toEqual(expect.objectContaining({
      id: 'research-1',
      status: 'COMPLETED',
      depth: 'FULL',
      sourceCount: 2,
      agentOutputCount: 2,
    }));
    expect(payload.sources.searxng).toHaveLength(1);
    expect(payload.sources.reddit).toHaveLength(1);
    expect(payload.agentOutputs).toHaveLength(2);
    expect(payload.pipeline.stages.some((stage: { stage: string }) => stage.stage === 'RESEARCH_FULL')).toBe(true);
    expect(payload.pipeline.stages.some((stage: { stage: string }) => stage.stage === 'PAPER_EXECUTED')).toBe(true);
  });
});
