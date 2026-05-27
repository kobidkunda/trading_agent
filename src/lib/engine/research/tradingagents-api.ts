import { getCredentialForService } from './search';
import type { MetadataOption, StageServiceMapping, TradingAgentsMetadataResponse } from '@/lib/types';

export interface TradingAgentsResult {
  status: string;
  query: string;
  newsReport: Record<string, unknown> | null;
  sentimentReport: Record<string, unknown> | null;
  technicalReport: Record<string, unknown> | null;
  fundamentalsReport: Record<string, unknown> | null;
  redditReport: Record<string, unknown> | null;
  xReport: Record<string, unknown> | null;
  bullDebate: string | null;
  bearDebate: string | null;
  decision: string | null;
  confidence: number | null;
  rawOutput: Record<string, unknown> | null;
  error: string | null;
}

export interface TradingAgentsSimpleResult {
  status: string;
  query: string;
  newsReport: Record<string, unknown> | null;
  sentimentReport: Record<string, unknown> | null;
  technicalReport: Record<string, unknown> | null;
  fundamentalsReport: Record<string, unknown> | null;
  redditReport: Record<string, unknown> | null;
  xReport: Record<string, unknown> | null;
  error: string | null;
}

async function getLlmForwardingPayload(): Promise<Record<string, string>> {
  const llmCred = await getCredentialForService('llm');
  const envBaseUrl = process.env.TRADINGAGENTS_LLM_BACKEND_URL
    || process.env.OPENAI_BASE_URL
    || process.env.LLM_BASE_URL
    || process.env.LITELLM_BASE_URL
    || '';
  const envApiKey = process.env.TRADINGAGENTS_LLM_API_KEY
    || process.env.OPENAI_API_KEY
    || process.env.LLM_API_KEY
    || process.env.LITELLM_API_KEY
    || '';
  const payload: Record<string, string> = {};
  const baseUrl = envBaseUrl || llmCred?.baseUrl;
  const apiKey = envApiKey || llmCred?.apiKey;
  if (baseUrl) payload.llm_base_url = baseUrl;
  if (apiKey) payload.llm_api_key = apiKey;
  return payload;
}

function buildTradingAgentsConfigPayload(routing?: StageServiceMapping): Record<string, unknown> {
  if (!routing) return {};

  const dataVendors = {
    ...(routing.analystCoreStockVendor ? { core_stock_apis: routing.analystCoreStockVendor } : {}),
    ...(routing.analystTechnicalIndicatorsVendor ? { technical_indicators: routing.analystTechnicalIndicatorsVendor } : {}),
    ...(routing.analystFundamentalDataVendor ? { fundamental_data: routing.analystFundamentalDataVendor } : {}),
    ...(routing.analystNewsDataVendor ? { news_data: routing.analystNewsDataVendor } : {}),
  };

  return {
    ...(routing.analystLlmProvider ? { llm_provider: routing.analystLlmProvider } : {}),
    ...(routing.analystDeepThinkLlm ? { deep_think_llm: routing.analystDeepThinkLlm } : {}),
    ...(routing.analystQuickThinkLlm ? { quick_think_llm: routing.analystQuickThinkLlm } : {}),
    ...(routing.analystMaxDebateRounds ? { max_debate_rounds: routing.analystMaxDebateRounds } : {}),
    ...(routing.analystMaxRiskRounds ? { max_risk_discuss_rounds: routing.analystMaxRiskRounds } : {}),
    ...(routing.analystOutputLanguage ? { output_language: routing.analystOutputLanguage } : {}),
    ...(typeof routing.analystCheckpointEnabled === 'boolean' ? { checkpoint_enabled: routing.analystCheckpointEnabled } : {}),
    ...(routing.analystSelectedAnalysts?.length ? { selected_analysts: routing.analystSelectedAnalysts } : {}),
    ...(routing.analystBenchmarkTicker ? { benchmark_ticker: routing.analystBenchmarkTicker } : {}),
    ...(routing.analystBenchmarkMap && Object.keys(routing.analystBenchmarkMap).length ? { benchmark_map: routing.analystBenchmarkMap } : {}),
    ...(routing.analystAssetType ? { asset_type: routing.analystAssetType } : {}),
    ...(routing.analystMaxRecurLimit ? { max_recur_limit: routing.analystMaxRecurLimit } : {}),
    ...(routing.analystNativeTimeoutSeconds ? { native_timeout_seconds: routing.analystNativeTimeoutSeconds } : {}),
    ...(routing.analystLlmRequestTimeoutSeconds ? { llm_request_timeout_seconds: routing.analystLlmRequestTimeoutSeconds } : {}),
    ...(routing.analystLlmRequestMaxAttempts ? { llm_request_max_attempts: routing.analystLlmRequestMaxAttempts } : {}),
    ...(routing.analystMemoryLogMaxEntries ? { memory_log_max_entries: routing.analystMemoryLogMaxEntries } : {}),
    ...(routing.analystConcurrencyLimit ? { analyst_concurrency_limit: routing.analystConcurrencyLimit } : {}),
    ...(routing.analystNewsArticleLimit ? { news_article_limit: routing.analystNewsArticleLimit } : {}),
    ...(routing.analystGlobalNewsArticleLimit ? { global_news_article_limit: routing.analystGlobalNewsArticleLimit } : {}),
    ...(routing.analystGlobalNewsLookbackDays ? { global_news_lookback_days: routing.analystGlobalNewsLookbackDays } : {}),
    ...(routing.analystGlobalNewsQueries?.length ? { global_news_queries: routing.analystGlobalNewsQueries } : {}),
    ...(routing.analystOpenAIReasoningEffort ? { openai_reasoning_effort: routing.analystOpenAIReasoningEffort } : {}),
    ...(routing.analystGoogleThinkingLevel ? { google_thinking_level: routing.analystGoogleThinkingLevel } : {}),
    ...(routing.analystAnthropicEffort ? { anthropic_effort: routing.analystAnthropicEffort } : {}),
    ...(Object.keys(dataVendors).length ? { data_vendors: dataVendors } : {}),
    ...(routing.analystToolVendorOverrides && Object.keys(routing.analystToolVendorOverrides).length
      ? { tool_vendors: routing.analystToolVendorOverrides }
      : {}),
  };
}

export async function runTradingAgentsAnalysis(
  query: string,
  date?: string,
  llmProvider?: string,
  deepThinkLlm?: string,
  quickThinkLlm?: string,
  maxDebateRounds?: number,
): Promise<TradingAgentsResult | null> {
  const cred = await getCredentialForService('tradingagents');
  const baseUrl = cred?.baseUrl || process.env.TRADINGAGENTS_URL || 'http://localhost:6503';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cred?.apiKey) {
    headers['Authorization'] = `Bearer ${cred.apiKey}`;
  }

  try {
    const llmForwardingPayload = await getLlmForwardingPayload();
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/analyze`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query,
        date: date || new Date().toISOString().split('T')[0],
        depth: 'full',
        ...(llmProvider ? { llm_provider: llmProvider } : {}),
        ...(deepThinkLlm ? { deep_think_llm: deepThinkLlm } : {}),
        ...(quickThinkLlm ? { quick_think_llm: quickThinkLlm } : {}),
        ...(maxDebateRounds ? { max_debate_rounds: maxDebateRounds } : {}),
        ...llmForwardingPayload,
      }),
      signal: AbortSignal.timeout(300000),
    });

    if (!response.ok) {
      console.error(`[TradingAgents] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return {
      status: data.status || 'unknown',
      query: data.query || query,
      newsReport: data.news_report || null,
      sentimentReport: data.sentiment_report || null,
      technicalReport: data.technical_report || null,
      fundamentalsReport: data.fundamentals_report || null,
      redditReport: data.reddit_report || null,
      xReport: data.x_report || null,
      bullDebate: data.bull_debate || null,
      bearDebate: data.bear_debate || null,
      decision: data.decision || null,
      confidence: data.confidence || null,
      rawOutput: data.raw_output || null,
      error: data.error || null,
    };
  } catch (e) {
    console.error('[TradingAgents] Error:', e);
    return null;
  }
}

// ── Native Graph Result ────────────────────────────────────────────

export interface TradingAgentsNativeResult {
  status: string;
  query: string;
  fundamentals: Record<string, unknown> | null;
  sentiment: Record<string, unknown> | null;
  news: Record<string, unknown> | null;
  technical: Record<string, unknown> | null;
  bullResearcher: Record<string, unknown> | null;
  bearResearcher: Record<string, unknown> | null;
  trader: Record<string, unknown> | null;
  riskManager: Record<string, unknown> | null;
  portfolioManager: Record<string, unknown> | null;
  fullReport: Record<string, unknown> | null;
  confidence: number | null;
  probability: number | null;
  error: string | null;
}

/** Financial market categories that benefit from native graph propagation */
export const NATIVE_ANALYSIS_CATEGORIES = [
  'crypto',
  'stocks',
  'macro',
  'commodities',
  'finance',
  'economics',
] as const;

export type NativeAnalysisCategory = (typeof NATIVE_ANALYSIS_CATEGORIES)[number];

/** Check if a market category qualifies for native graph analysis */
export function isNativeAnalysisCandidate(category: string): boolean {
  const lower = category.toLowerCase();
  return NATIVE_ANALYSIS_CATEGORIES.some((c) => lower === c || lower.includes(c));
}

/** Run native graph analysis via /analyze/native endpoint.
 *  Gracefully falls back — returns null on any error (caller uses existing /analyze/all path). */
export async function runTradingAgentsNative(
  query: string,
  date?: string,
  deepThinkLlm?: string,
  quickThinkLlm?: string,
  llmProvider?: string,
  routing?: StageServiceMapping,
): Promise<TradingAgentsNativeResult | null> {
  const cred = await getCredentialForService('tradingagents');
  const baseUrl = cred?.baseUrl || process.env.TRADINGAGENTS_URL || 'http://localhost:6503';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cred?.apiKey) {
    headers['Authorization'] = `Bearer ${cred.apiKey}`;
  }

  try {
    console.log(`[TradingAgents Native] Calling /analyze/native for: ${query?.substring(0, 50)}...`);
    const startTime = Date.now();
    const llmForwardingPayload = await getLlmForwardingPayload();

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/analyze/native`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query,
        date: date || new Date().toISOString().split('T')[0],
        ...(deepThinkLlm ? { deep_think_llm: deepThinkLlm } : {}),
        ...(quickThinkLlm ? { quick_think_llm: quickThinkLlm } : {}),
        ...(llmProvider ? { llm_provider: llmProvider } : {}),
        ...buildTradingAgentsConfigPayload(routing),
        ...llmForwardingPayload,
      }),
      signal: AbortSignal.timeout(300000),
    });

    const duration = Date.now() - startTime;
    console.log(`[TradingAgents Native] Response received in ${duration}ms, status: ${response.status}`);

    if (!response.ok) {
      console.error(`[TradingAgents Native] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    return {
      status: data.status || 'unknown',
      query: data.query || query,
      fundamentals: data.fundamentals || null,
      sentiment: data.sentiment || null,
      news: data.news || null,
      technical: data.technical || null,
      bullResearcher: data.bull_researcher || null,
      bearResearcher: data.bear_researcher || null,
      trader: data.trader || null,
      riskManager: data.risk_manager || null,
      portfolioManager: data.portfolio_manager || null,
      fullReport: data.full_report || null,
      confidence: typeof data.confidence === 'number' ? data.confidence : null,
      probability: typeof data.probability === 'number' ? data.probability : null,
      error: data.error || null,
    };
  } catch (e) {
    console.error('[TradingAgents Native] Error:', e);
    return null;
  }
}

export async function runTradingAgentsSimple(
  query: string,
  date?: string,
  deepThinkLlm?: string,
  quickThinkLlm?: string,
  llmProvider?: string,
  maxDebateRounds?: number,
  routing?: StageServiceMapping,
): Promise<TradingAgentsSimpleResult | null> {
  const cred = await getCredentialForService('tradingagents');
  const baseUrl = cred?.baseUrl || process.env.TRADINGAGENTS_URL || 'http://localhost:6503';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cred?.apiKey) {
    headers['Authorization'] = `Bearer ${cred.apiKey}`;
  }

  try {
    console.log(`[TradingAgents Simple] Calling API for: ${query?.substring(0, 50)}...`);
    const startTime = Date.now();
    const llmForwardingPayload = await getLlmForwardingPayload();
    
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/analyze/all`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query,
        date: date || new Date().toISOString().split('T')[0],
        ...(deepThinkLlm ? { deep_think_llm: deepThinkLlm } : {}),
        ...(quickThinkLlm ? { quick_think_llm: quickThinkLlm } : {}),
        ...(llmProvider ? { llm_provider: llmProvider } : {}),
        ...(maxDebateRounds ? { max_debate_rounds: maxDebateRounds } : {}),
        ...buildTradingAgentsConfigPayload(routing),
        ...llmForwardingPayload,
      }),
      signal: AbortSignal.timeout(180000),
    });

    const duration = Date.now() - startTime;
    console.log(`[TradingAgents Simple] Response received in ${duration}ms, status: ${response.status}`);

    if (!response.ok) {
      console.error(`[TradingAgents Simple] API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    console.log(`[TradingAgents Simple] Data received. Keys: ${Object.keys(data).join(', ')}`);
    console.log(`[TradingAgents Simple] reddit_report: ${data.reddit_report ? `YES (posts: ${data.reddit_report.posts?.length || 0})` : 'NO'}`);
    
    return {
      status: data.status || 'unknown',
      query: data.query || query,
      newsReport: data.news_report || null,
      sentimentReport: data.sentiment_report || null,
      technicalReport: data.technical_report || null,
      fundamentalsReport: data.fundamentals_report || null,
      redditReport: data.reddit_report || null,
      xReport: data.x_report || null,
      error: data.error || null,
    };
  } catch (e) {
    console.error('[TradingAgents Simple] Error:', e);
    return null;
  }
}

export async function testTradingAgentsConnection(
  baseUrl: string,
  apiKey?: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (res.ok) {
      const data = await res.json();
      return { ok: true, message: `Connected to ${data.service || 'TradingAgents'} v${data.version || '?'}` };
    }
    return { ok: false, message: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}

/**
 * Fetch metadata (providers and models) from the TradingAgents service.
 * Returns null on failure so the caller can fallback to LLM models.
 */
export async function fetchTradingAgentsMetadata(): Promise<TradingAgentsMetadataResponse | null> {
  const cred = await getCredentialForService('tradingagents');
  const baseUrl = cred?.baseUrl || process.env.TRADINGAGENTS_URL || 'http://localhost:6503';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cred?.apiKey) {
    headers['Authorization'] = `Bearer ${cred.apiKey}`;
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.error(`[TradingAgents] Metadata fetch error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Normalize models - handle [{id, name}], ["string"], and OpenAI-compatible data[] shapes.
    const rawModels = data.models || data.data?.models || [];
    const models: MetadataOption[] = Array.isArray(rawModels)
      ? rawModels
          .filter((m: unknown) => {
            if (typeof m === 'string') return m.trim().length > 0;
            if (typeof m === 'object' && m !== null) {
              const obj = m as Record<string, unknown>;
              if ('id' in obj) return !!obj.id;
              return !!(obj.id || obj.name || obj.model);
            }
            return false;
          })
          .map((m: unknown) => {
            if (typeof m === 'string') return { id: m, label: m };
            const obj = m as Record<string, unknown>;
            const id = String(obj.id || obj.name || obj.model);
            return { id, label: String(obj.name || obj.label || obj.id || obj.model || id) };
          })
      : [];

    // Normalize providers - handle [{id, name}] objects and ["openai"] flat arrays.
    const rawProviders = data.providers || data.data?.providers || [];
    const providers: MetadataOption[] = Array.isArray(rawProviders)
      ? rawProviders
          .filter((p: unknown) => {
            if (typeof p === 'string') return p.trim().length > 0;
            if (typeof p === 'object' && p !== null) {
              const obj = p as Record<string, unknown>;
              return !!obj.id;
            }
            return false;
          })
          .map((p: unknown) => {
            if (typeof p === 'string') return { id: p, label: p };
            const obj = p as Record<string, unknown>;
            const id = String(obj.id);
            return { id, label: String(obj.name || obj.label || obj.id || id) };
          })
      : [];

    if (providers.length === 0 && models.length === 0) {
      console.error('[TradingAgents] Metadata fetch returned no providers or models');
      return null;
    }

    return {
      providers,
      models,
      source: 'tradingagents',
      ...(typeof data.warning === 'string' ? { warning: data.warning } : {}),
    };
  } catch (e) {
    console.error('[TradingAgents] Metadata fetch error:', e);
    return null;
  }
}
