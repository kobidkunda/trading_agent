import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../research/search', () => ({
  getCredentialForService: vi.fn(),
}));

import { getCredentialForService } from '../research/search';
import { runFullResearch } from '../research/full-research';
import { runTradingAgentsSimple } from '../research/tradingagents-api';
import { runDeerFlowResearch } from '../research/deerflow';

vi.mock('../research/deerflow', () => ({
  runDeerFlowResearch: vi.fn(),
}));

vi.mock('../research/tradingagents-api', async () => {
  const actual = await vi.importActual<typeof import('../research/tradingagents-api')>('../research/tradingagents-api');
  return {
    ...actual,
    runTradingAgentsSimple: vi.fn(),
  };
});

vi.mock('../research/agent-reach', () => ({
  runAgentReachResearch: vi.fn(),
}));

describe('full research orchestrator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('runs all full research providers in parallel and returns the combined result shape', async () => {
    vi.mocked(runDeerFlowResearch).mockResolvedValue({
      summary: 'DeerFlow summary',
      keyFindings: ['finding'],
      contradictions: [],
      confidenceAssessment: 0.8,
      sourceQuality: 0.7,
      allSearchResults: [],
      allExtractedContent: [],
    } as Awaited<ReturnType<typeof runDeerFlowResearch>>);
    vi.mocked(runTradingAgentsSimple).mockResolvedValue({
      status: 'completed',
      query: 'Will BTC hit 100k?',
      newsReport: { outlook: 'bullish' },
      sentimentReport: null,
      technicalReport: null,
      fundamentalsReport: null,
      redditReport: null,
      xReport: null,
      error: null,
    });
    const { runAgentReachResearch } = await import('../research/agent-reach');
    vi.mocked(runAgentReachResearch).mockResolvedValue({
      provider: 'agent_reach',
      status: 'completed',
      summary: 'Agent Reach summary',
      sources: [{ title: 'Source A', url: 'https://example.com/a', snippet: 'Evidence A' }],
    });

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
    vi.mocked(runDeerFlowResearch).mockRejectedValue(new Error('timeout'));
    vi.mocked(runTradingAgentsSimple).mockResolvedValue({
      status: 'completed',
      query: 'Will BTC hit 100k?',
      newsReport: { outlook: 'bullish' },
      sentimentReport: null,
      technicalReport: null,
      fundamentalsReport: null,
      redditReport: null,
      xReport: null,
      error: null,
    });
    const { runAgentReachResearch } = await import('../research/agent-reach');
    vi.mocked(runAgentReachResearch).mockResolvedValue({
      provider: 'agent_reach',
      status: 'completed',
      summary: 'Agent Reach summary',
      sources: [],
    });

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
    vi.resetAllMocks();
    vi.mocked(getCredentialForService).mockResolvedValue({
      baseUrl: 'http://configured-tradingagents.local',
      apiKey: 'secret-key',
    });
  });

  it('includes llm_provider and max_debate_rounds when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'completed', query: 'Will BTC hit 100k?' }),
    }) as unknown as typeof fetch;

    await vi.importActual<typeof import('../research/tradingagents-api')>('../research/tradingagents-api')
      .then((module) => module.runTradingAgentsSimple(
        'Will BTC hit 100k?',
        '2026-04-19',
        'paper_proglm',
        'paper_lite',
        'openai',
        3,
      ));

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
