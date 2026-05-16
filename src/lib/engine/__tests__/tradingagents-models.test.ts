import { beforeEach, describe, expect, it, mock } from 'bun:test';

const getCredentialForServiceMock: any = mock(async () => null);

mock.module('../research/search', () => ({
  getCredentialForService: getCredentialForServiceMock,
}));

describe('fetchTradingAgentsMetadata', () => {
  beforeEach(() => {
    getCredentialForServiceMock.mockClear();
    getCredentialForServiceMock.mockResolvedValue(null);
    delete process.env.TRADINGAGENTS_URL;
  });

  it('returns normalized metadata when TradingAgents /models succeeds', async () => {
    const { fetchTradingAgentsMetadata } = await import('../research/tradingagents-api');

    getCredentialForServiceMock.mockResolvedValue({
      baseUrl: 'http://tradingagents.local',
      apiKey: 'test-key',
    });

    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        providers: [
          { id: 'openai', name: 'OpenAI' },
          { id: 'anthropic', name: 'Anthropic' },
        ],
        models: [
          { id: 'gpt-4', name: 'GPT-4' },
          { id: 'claude-3', name: 'Claude 3' },
        ],
      }),
    })) as unknown as typeof fetch;

    const result = await fetchTradingAgentsMetadata();

    expect(result).not.toBeNull();
    expect(result?.source).toBe('tradingagents');
    expect(result?.providers).toHaveLength(2);
    expect(result?.models).toHaveLength(2);
    expect(result?.providers[0]).toEqual({ id: 'openai', label: 'OpenAI' });
    expect(result?.models[0]).toEqual({ id: 'gpt-4', label: 'GPT-4' });
    expect(result?.error).toBeUndefined();
  });

  it('returns null when TradingAgents /models returns non-ok', async () => {
    const { fetchTradingAgentsMetadata } = await import('../research/tradingagents-api');

    getCredentialForServiceMock.mockResolvedValue({
      baseUrl: 'http://tradingagents.local',
      apiKey: 'test-key',
    });

    global.fetch = mock(async () => ({
      ok: false,
      status: 500,
    })) as unknown as typeof fetch;

    const result = await fetchTradingAgentsMetadata();

    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    const { fetchTradingAgentsMetadata } = await import('../research/tradingagents-api');

    getCredentialForServiceMock.mockResolvedValue({
      baseUrl: 'http://tradingagents.local',
      apiKey: 'test-key',
    });

    global.fetch = mock(async () => {
      throw new Error('Network error');
    }) as unknown as typeof fetch;

    const result = await fetchTradingAgentsMetadata();

    expect(result).toBeNull();
  });

  it('uses environment variable when no credential', async () => {
    const { fetchTradingAgentsMetadata } = await import('../research/tradingagents-api');

    getCredentialForServiceMock.mockResolvedValue(null);
    process.env.TRADINGAGENTS_URL = 'http://env-tradingagents.local';

    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ providers: [], models: [] }),
    })) as unknown as typeof fetch;

    await fetchTradingAgentsMetadata();

    expect(global.fetch).toHaveBeenCalledWith(
      'http://env-tradingagents.local/models',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    );
  });

  it('handles providers/models in data.data wrapper', async () => {
    const { fetchTradingAgentsMetadata } = await import('../research/tradingagents-api');

    getCredentialForServiceMock.mockResolvedValue({
      baseUrl: 'http://tradingagents.local',
      apiKey: 'test-key',
    });

    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        data: {
          providers: [{ id: 'ollama', name: 'Ollama' }],
          models: [{ id: 'llama2', name: 'Llama 2' }],
        },
      }),
    })) as unknown as typeof fetch;

    const result = await fetchTradingAgentsMetadata();

    expect(result).not.toBeNull();
    expect(result?.providers).toHaveLength(1);
    expect(result?.models).toHaveLength(1);
    expect(result?.providers[0]).toEqual({ id: 'ollama', label: 'Ollama' });
    expect(result?.models[0]).toEqual({ id: 'llama2', label: 'Llama 2' });
  });

  it('filters out items with empty ids', async () => {
    const { fetchTradingAgentsMetadata } = await import('../research/tradingagents-api');

    getCredentialForServiceMock.mockResolvedValue({
      baseUrl: 'http://tradingagents.local',
      apiKey: 'test-key',
    });

    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({
        providers: [
          { id: 'valid', name: 'Valid Provider' },
          { id: '', name: 'Empty ID' },
          { name: 'No ID Field' },
        ],
        models: [
          { id: 'valid-model', name: 'Valid Model' },
          { id: '', name: 'Empty ID' },
        ],
      }),
    })) as unknown as typeof fetch;

    const result = await fetchTradingAgentsMetadata();

    expect(result?.providers).toHaveLength(1);
    expect(result?.models).toHaveLength(1);
    expect(result?.providers[0].id).toBe('valid');
    expect(result?.models[0].id).toBe('valid-model');
  });

  it('includes authorization header when apiKey is available', async () => {
    const { fetchTradingAgentsMetadata } = await import('../research/tradingagents-api');

    getCredentialForServiceMock.mockResolvedValue({
      baseUrl: 'http://tradingagents.local',
      apiKey: 'secret-api-key',
    });

    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({ providers: [], models: [] }),
    })) as unknown as typeof fetch;

    await fetchTradingAgentsMetadata();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer secret-api-key',
        }),
      })
    );
  });

  it('returns empty arrays when response has no providers/models', async () => {
    const { fetchTradingAgentsMetadata } = await import('../research/tradingagents-api');

    getCredentialForServiceMock.mockResolvedValue({
      baseUrl: 'http://tradingagents.local',
      apiKey: 'test-key',
    });

    global.fetch = mock(async () => ({
      ok: true,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    const result = await fetchTradingAgentsMetadata();

    expect(result).not.toBeNull();
    expect(result?.providers).toEqual([]);
    expect(result?.models).toEqual([]);
    expect(result?.source).toBe('tradingagents');
  });
});
