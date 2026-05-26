import { beforeEach, describe, expect, it, mock } from 'bun:test';

const getCredentialForServiceMock: any = mock(async () => null);
const runDeerFlowResearchMock: any = mock(async () => null);
const runAgentReachResearchMock: any = mock(async () => null);
const canRunStageMock: any = mock(async (_stage?: string) => ({ canRun: true, skipReason: null as string | null }));
const isServiceReachableMock = mock(async () => true);
const checkServiceHealthMock = mock(async () => ({
  name: 'Mock Service',
  status: 'UP' as const,
  lastChecked: new Date().toISOString(),
}));

const LLM_FORWARDING_ENV_KEYS = [
  'TRADINGAGENTS_LLM_BACKEND_URL',
  'OPENAI_BASE_URL',
  'LLM_BASE_URL',
  'LITELLM_BASE_URL',
  'TRADINGAGENTS_LLM_API_KEY',
  'OPENAI_API_KEY',
  'LLM_API_KEY',
  'LITELLM_API_KEY',
] as const;

function clearLlmForwardingEnv() {
  for (const key of LLM_FORWARDING_ENV_KEYS) {
    delete process.env[key];
  }
}

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
    clearLlmForwardingEnv();
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
      marketCategory: 'crypto',
      impliedProbability: 0.42,
      routing: {
        researchDepth: 'FULL',
        deerflowApiModel: 'test-deerflow',
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
      marketCategory: 'crypto',
      impliedProbability: 0.42,
      routing: {
        researchDepth: 'FULL',
        deerflowApiModel: 'test-deerflow',
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

  it('uses routed Agent-Reach URL for fallback health checks', async () => {
    const { runFullResearch } = await import('../research/full-research');

    canRunStageMock.mockImplementation(async (stage: string) => ({
      canRun: stage !== 'AGENT_REACH',
      skipReason: stage === 'AGENT_REACH' ? 'env URL missing' : null,
    }));
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
      }),
    })) as unknown as typeof fetch;

    const result = await runFullResearch({
      marketId: 'm1',
      marketTitle: 'Will BTC hit 100k?',
      marketDescription: 'Test market',
      marketCategory: 'crypto',
      impliedProbability: 0.42,
      routing: {
        researchDepth: 'FULL',
        analystLlmProvider: 'openai',
        analystDeepThinkLlm: 'paper_proglm',
        analystQuickThinkLlm: 'paper_lite',
        analystMaxDebateRounds: 2,
        agentReachEnabled: true,
        agentReachServiceUrl: 'http://agent-reach:6656',
      },
    });

    expect(isServiceReachableMock).toHaveBeenCalledWith('agent-reach', 'http://agent-reach:6656');
    expect(result.providers).toContain('agent_reach');
  });
});

describe('tradingagents simple request body', () => {
  beforeEach(() => {
    clearLlmForwardingEnv();
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
          llm_base_url: 'http://configured-tradingagents.local',
          llm_api_key: 'secret-key',
        }),
      })
    );
  });
});

describe('tradingagents native request body', () => {
  beforeEach(() => {
    clearLlmForwardingEnv();
    getCredentialForServiceMock.mockClear();
    getCredentialForServiceMock.mockResolvedValue({
      baseUrl: 'http://configured-tradingagents.local',
      apiKey: 'secret-key',
    });
  });

  it('calls the native graph endpoint with routed analyst models', async () => {
    const { runTradingAgentsNative } = await import('../research/tradingagents-api');

    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        status: 'completed',
        query: 'Will BTC hit 100k?',
        signal: 'Buy',
        full_report: { signal: 'Buy' },
        confidence: 0.6,
        probability: 0.65,
      }),
      status: 200,
    })) as unknown as typeof fetch;

    await runTradingAgentsNative(
      'Will BTC hit 100k?',
      '2026-05-26',
      'gpt-5.4',
      'gpt-5.4-mini',
      'openai',
      {
        analystMaxRiskRounds: 2,
        analystOutputLanguage: 'English',
        analystCheckpointEnabled: true,
        analystSelectedAnalysts: ['market', 'news', 'fundamentals'],
        analystBenchmarkTicker: 'QQQ',
        analystBenchmarkMap: { '.T': '^N225', '': 'SPY' },
        analystAssetType: 'crypto',
        analystMaxRecurLimit: 150,
        analystMemoryLogMaxEntries: 25,
        analystConcurrencyLimit: 4,
        analystNewsArticleLimit: 30,
        analystGlobalNewsArticleLimit: 12,
        analystGlobalNewsLookbackDays: 10,
        analystGlobalNewsQueries: ['bitcoin ETF flows', 'crypto regulation'],
        analystOpenAIReasoningEffort: 'high',
        analystGoogleThinkingLevel: 'minimal',
        analystAnthropicEffort: 'medium',
        analystCoreStockVendor: 'alpha_vantage',
        analystTechnicalIndicatorsVendor: 'yfinance',
        analystFundamentalDataVendor: 'alpha_vantage',
        analystNewsDataVendor: 'yfinance',
        analystToolVendorOverrides: {
          get_stock_data: 'alpha_vantage',
        },
      },
    );

    expect(global.fetch).toHaveBeenCalledWith(
      'http://configured-tradingagents.local/analyze/native',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer secret-key',
        }),
        body: JSON.stringify({
          query: 'Will BTC hit 100k?',
          date: '2026-05-26',
          deep_think_llm: 'gpt-5.4',
          quick_think_llm: 'gpt-5.4-mini',
          llm_provider: 'openai',
          max_risk_discuss_rounds: 2,
          output_language: 'English',
          checkpoint_enabled: true,
          selected_analysts: ['market', 'news', 'fundamentals'],
          benchmark_ticker: 'QQQ',
          benchmark_map: { '.T': '^N225', '': 'SPY' },
          asset_type: 'crypto',
          max_recur_limit: 150,
          memory_log_max_entries: 25,
          analyst_concurrency_limit: 4,
          news_article_limit: 30,
          global_news_article_limit: 12,
          global_news_lookback_days: 10,
          global_news_queries: ['bitcoin ETF flows', 'crypto regulation'],
          openai_reasoning_effort: 'high',
          google_thinking_level: 'minimal',
          anthropic_effort: 'medium',
          data_vendors: {
            core_stock_apis: 'alpha_vantage',
            technical_indicators: 'yfinance',
            fundamental_data: 'alpha_vantage',
            news_data: 'yfinance',
          },
          tool_vendors: {
            get_stock_data: 'alpha_vantage',
          },
          llm_base_url: 'http://configured-tradingagents.local',
          llm_api_key: 'secret-key',
        }),
      }),
    );
  });

  it('forwards LLM endpoint and key from env when no LLM credential is saved', async () => {
    const previousBackendUrl = process.env.TRADINGAGENTS_LLM_BACKEND_URL;
    const previousApiKey = process.env.TRADINGAGENTS_LLM_API_KEY;
    process.env.TRADINGAGENTS_LLM_BACKEND_URL = 'http://env-litellm.local/v1';
    process.env.TRADINGAGENTS_LLM_API_KEY = 'env-llm-key';

    getCredentialForServiceMock.mockImplementation(async (service: string) => {
      if (service === 'tradingagents') {
        return { baseUrl: 'http://configured-tradingagents.local', apiKey: 'bridge-key' };
      }
      return null;
    });

    try {
      const { runTradingAgentsNative } = await import('../research/tradingagents-api');

      global.fetch = mock(async () => ({
        ok: true,
        json: async () => ({
          status: 'completed',
          query: 'Will BTC hit 100k?',
          signal: 'Buy',
        }),
        status: 200,
      })) as unknown as typeof fetch;

      await runTradingAgentsNative('Will BTC hit 100k?', '2026-05-26', undefined, undefined, undefined, {});

      expect(global.fetch).toHaveBeenCalledWith(
        'http://configured-tradingagents.local/analyze/native',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer bridge-key',
          }),
          body: JSON.stringify({
            query: 'Will BTC hit 100k?',
            date: '2026-05-26',
            llm_base_url: 'http://env-litellm.local/v1',
            llm_api_key: 'env-llm-key',
          }),
        }),
      );
    } finally {
      if (previousBackendUrl === undefined) {
        delete process.env.TRADINGAGENTS_LLM_BACKEND_URL;
      } else {
        process.env.TRADINGAGENTS_LLM_BACKEND_URL = previousBackendUrl;
      }
      if (previousApiKey === undefined) {
        delete process.env.TRADINGAGENTS_LLM_API_KEY;
      } else {
        process.env.TRADINGAGENTS_LLM_API_KEY = previousApiKey;
      }
    }
  });

  it('lets env override a saved LLM credential', async () => {
    const previousBackendUrl = process.env.TRADINGAGENTS_LLM_BACKEND_URL;
    const previousApiKey = process.env.TRADINGAGENTS_LLM_API_KEY;
    process.env.TRADINGAGENTS_LLM_BACKEND_URL = 'http://env-router.local/v1';
    process.env.TRADINGAGENTS_LLM_API_KEY = 'env-router-key';

    getCredentialForServiceMock.mockImplementation(async (service: string) => {
      if (service === 'tradingagents') {
        return { baseUrl: 'http://configured-tradingagents.local', apiKey: 'bridge-key' };
      }
      if (service === 'llm') {
        return { baseUrl: 'http://stale-ui-llm.local/v1', apiKey: 'stale-ui-key' };
      }
      return null;
    });

    try {
      const { runTradingAgentsNative } = await import('../research/tradingagents-api');

      global.fetch = mock(async () => ({
        ok: true,
        json: async () => ({ status: 'completed', query: 'Will BTC hit 100k?' }),
        status: 200,
      })) as unknown as typeof fetch;

      await runTradingAgentsNative('Will BTC hit 100k?', '2026-05-26', undefined, undefined, undefined, {});

      expect(global.fetch).toHaveBeenCalledWith(
        'http://configured-tradingagents.local/analyze/native',
        expect.objectContaining({
          body: JSON.stringify({
            query: 'Will BTC hit 100k?',
            date: '2026-05-26',
            llm_base_url: 'http://env-router.local/v1',
            llm_api_key: 'env-router-key',
          }),
        }),
      );
    } finally {
      if (previousBackendUrl === undefined) {
        delete process.env.TRADINGAGENTS_LLM_BACKEND_URL;
      } else {
        process.env.TRADINGAGENTS_LLM_BACKEND_URL = previousBackendUrl;
      }
      if (previousApiKey === undefined) {
        delete process.env.TRADINGAGENTS_LLM_API_KEY;
      } else {
        process.env.TRADINGAGENTS_LLM_API_KEY = previousApiKey;
      }
    }
  });
});
