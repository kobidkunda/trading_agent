import { beforeEach, describe, expect, it, mock } from 'bun:test';

const getCredentialForServiceMock: any = mock(async () => null);
const runDeerFlowResearchMock: any = mock(async () => null);
const runAgentReachResearchMock: any = mock(async () => null);
const canRunStageMock = mock(async () => ({ canRun: true, skipReason: null }));
const isServiceReachableMock = mock(async () => true);
const checkServiceHealthMock = mock(async () => ({
  name: 'Mock Service',
  status: 'UP' as const,
  lastChecked: new Date().toISOString(),
}));

mock.module('../research/search', () => ({
  getCredentialForService: getCredentialForServiceMock,
}));

mock.module('../research/deerflow', () => ({
  runDeerFlowResearch: runDeerFlowResearchMock,
}));

mock.module('../research/agent-reach', () => ({
  runAgentReachResearch: runAgentReachResearchMock,
}));

mock.module('@/lib/engine/health-check', () => ({
  canRunStage: canRunStageMock,
  isServiceReachable: isServiceReachableMock,
  checkServiceHealth: checkServiceHealthMock,
}));

describe('full research orchestrator', () => {
  beforeEach(() => {
    getCredentialForServiceMock.mockClear();
    runDeerFlowResearchMock.mockClear();
    runAgentReachResearchMock.mockClear();
    canRunStageMock.mockClear();
    isServiceReachableMock.mockClear();
    canRunStageMock.mockResolvedValue({ canRun: true, skipReason: null });
    isServiceReachableMock.mockResolvedValue(true);
    getCredentialForServiceMock.mockResolvedValue({
      baseUrl: 'http://configured-tradingagents.local',
      apiKey: 'secret-key',
    });
  });

  it('runs all full research providers in parallel and returns the combined result shape', async () => {
    const { runFullResearch } = await import('../research/full-research');

    runDeerFlowResearchMock.mockResolvedValue({
      summary: 'DeerFlow summary',
      keyFindings: ['finding'],
      contradictions: [],
      confidenceAssessment: 0.8,
      sourceQuality: 0.7,
      allSearchResults: [],
      allExtractedContent: [],
    });
    runAgentReachResearchMock.mockResolvedValue({
      provider: 'agent_reach',
      status: 'completed',
      summary: 'Agent Reach summary',
      sources: [{ title: 'Source A', url: 'https://example.com/a', snippet: 'Evidence A' }],
    });
    global.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'completed',
        query: 'Will BTC hit 100k?',
        news_report: { outlook: 'bullish' },
        sentiment_report: null,
        technical_report: null,
        fundamentals_report: null,
        reddit_report: null,
        x_report: null,
        error: null,
      }),
    })) as unknown as typeof fetch;

    const result = await runFullResearch({
      marketId: 'm1',
      marketTitle: 'Will BTC hit 100k?',
      marketDescription: 'Test market',
      impliedProbability: 0.42,
      routing: {
        researchDepth: 'FULL',
        analystLlmProvider: 'openai',
        analystDeepThinkLlm: 'paper_proglm',
        analystQuickThinkLlm: 'paper_lite',
        analystMaxDebateRounds: 2,
        agentReachEnabled: true,
      },
    });

    expect(result.providers).toEqual(expect.arrayContaining(['deerflow', 'tradingagents', 'agent_reach']));
    expect(result.status).toBe('completed');
    expect(result.deerflow?.summary).toBe('DeerFlow summary');
    expect(result.tradingagents?.status).toBe('completed');
    expect(result.agentReach?.status).toBe('completed');
  });

  it('returns degraded when one provider fails and others succeed', async () => {
    const { runFullResearch } = await import('../research/full-research');

    runDeerFlowResearchMock.mockRejectedValue(new Error('timeout'));
    runAgentReachResearchMock.mockResolvedValue({
      provider: 'agent_reach',
      status: 'completed',
      summary: 'Agent Reach summary',
      sources: [],
    });
    global.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'completed',
        query: 'Will BTC hit 100k?',
        news_report: { outlook: 'bullish' },
        sentiment_report: null,
        technical_report: null,
        fundamentals_report: null,
        reddit_report: null,
        x_report: null,
        error: null,
      }),
    })) as unknown as typeof fetch;

    const result = await runFullResearch({
      marketId: 'm1',
      marketTitle: 'Will BTC hit 100k?',
      marketDescription: 'Test market',
      impliedProbability: 0.42,
      routing: {
        researchDepth: 'FULL',
        analystLlmProvider: 'openai',
        analystDeepThinkLlm: 'paper_proglm',
        analystQuickThinkLlm: 'paper_lite',
        agentReachEnabled: true,
      },
    });

    expect(result.status).toBe('degraded');
    expect(result.deerflow).toBeNull();
    expect(result.tradingagents?.status).toBe('completed');
    expect(result.agentReach?.status).toBe('completed');
  });
});

describe('tradingagents simple request body', () => {
  beforeEach(() => {
    getCredentialForServiceMock.mockClear();
    getCredentialForServiceMock.mockResolvedValue({
      baseUrl: 'http://configured-tradingagents.local',
      apiKey: 'secret-key',
    });
  });

  it('includes llm_provider and max_debate_rounds when provided', async () => {
    const { runTradingAgentsSimple } = await import('../research/tradingagents-api');

    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ status: 'completed', query: 'Will BTC hit 100k?' }),
      status: 200,
    })) as unknown as typeof fetch;

    await runTradingAgentsSimple(
      'Will BTC hit 100k?',
      '2026-04-19',
      'paper_proglm',
      'paper_lite',
      'openai',
      3,
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'http://configured-tradingagents.local/analyze/all',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-key',
        }),
        body: JSON.stringify({
          query: 'Will BTC hit 100k?',
          date: '2026-04-19',
          deep_think_llm: 'paper_proglm',
          quick_think_llm: 'paper_lite',
          llm_provider: 'openai',
          max_debate_rounds: 3,
        }),
      })
    );
  });
});
