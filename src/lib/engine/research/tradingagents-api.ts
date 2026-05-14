import { getCredentialForService } from './search';
import type { MetadataOption, TradingAgentsMetadataResponse } from '@/lib/types';

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

export async function runTradingAgentsAnalysis(
  query: string,
  date?: string,
  llmProvider?: string,
  deepThinkLlm?: string,
  quickThinkLlm?: string,
  maxDebateRounds?: number,
): Promise<TradingAgentsResult | null> {
  const cred = await getCredentialForService('tradingagents');
  const baseUrl = cred?.baseUrl || process.env.TRADINGAGENTS_URL || 'http://localhost:8100';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cred?.apiKey) {
    headers['Authorization'] = `Bearer ${cred.apiKey}`;
  }

  try {
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

export async function runTradingAgentsSimple(
  query: string,
  date?: string,
  deepThinkLlm?: string,
  quickThinkLlm?: string,
  llmProvider?: string,
  maxDebateRounds?: number,
): Promise<TradingAgentsSimpleResult | null> {
  const cred = await getCredentialForService('tradingagents');
  const baseUrl = cred?.baseUrl || process.env.TRADINGAGENTS_URL || 'http://localhost:8100';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cred?.apiKey) {
    headers['Authorization'] = `Bearer ${cred.apiKey}`;
  }

  try {
    console.log(`[TradingAgents Simple] Calling API for: ${query?.substring(0, 50)}...`);
    const startTime = Date.now();
    
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
  const baseUrl = cred?.baseUrl || process.env.TRADINGAGENTS_URL || 'http://localhost:8100';
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

    // Normalize models - handle both [{id, name}] objects and ["string"] flat arrays
    const rawModels = data.models || data.data?.models || [];
    const models: MetadataOption[] = Array.isArray(rawModels)
      ? rawModels
          .filter((m: unknown) => {
            if (typeof m === 'string') return m.trim().length > 0;
            if (typeof m === 'object' && m !== null) return !!(m as Record<string, unknown>).id;
            return false;
          })
          .map((m: unknown) => {
            if (typeof m === 'string') return { id: m, label: m };
            const obj = m as Record<string, unknown>;
            return { id: obj.id as string, label: (obj.name || obj.label || obj.id) as string };
          })
      : [];

    // Normalize providers
    const rawProviders = data.providers || data.data?.providers || [];
    const providers: MetadataOption[] = Array.isArray(rawProviders)
      ? rawProviders
          .filter((p: unknown) => {
            if (typeof p === 'object' && p !== null) return !!(p as Record<string, unknown>).id;
            return false;
          })
          .map((p: unknown) => {
            const obj = p as Record<string, unknown>;
            return { id: obj.id as string, label: (obj.name || obj.id) as string };
          })
      : [];

    return {
      providers,
      models,
      source: 'tradingagents',
    };
  } catch (e) {
    console.error('[TradingAgents] Metadata fetch error:', e);
    return null;
  }
}