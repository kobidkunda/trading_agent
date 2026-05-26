import { NextResponse } from 'next/server';
import { fetchTradingAgentsMetadata } from '@/lib/engine/research/tradingagents-api';
import { db } from '@/lib/db';
import { isEncrypted, decrypt } from '@/lib/engine/crypto';
import type { MetadataOption, TradingAgentsMetadataResponse } from '@/lib/types';

interface LlmModelsResponse {
  models: MetadataOption[];
  data?: MetadataOption[];
  provider?: string;
  error?: string;
}

function mergeMetadataOptions(primary: MetadataOption[], secondary: MetadataOption[]): MetadataOption[] {
  const seen = new Set<string>();
  const merged: MetadataOption[] = [];
  for (const option of [...primary, ...secondary]) {
    if (!option.id || seen.has(option.id)) continue;
    seen.add(option.id);
    merged.push(option);
  }
  return merged;
}

/**
 * GET /api/tradingagents/models
 *
 * Returns TradingAgents metadata with live fallback to LLM models.
 * - First tries native TradingAgents /models endpoint
 * - Falls back to /api/llm/models if native unavailable
 * - Returns normalized TradingAgentsMetadataResponse shape
 */
export async function GET(): Promise<NextResponse> {
  // Try native TradingAgents metadata first
  const nativeMetadata = await fetchTradingAgentsMetadata();

  if (nativeMetadata && !nativeMetadata.error && !nativeMetadata.warning) {
    return NextResponse.json(nativeMetadata);
  }

  // Fallback to configured LLM models. Avoid self-fetching localhost:3000 from a dev server on port 6500.
  try {
    const llmCred = await db.credential.findFirst({
      where: { service: { in: ['llm', 'LLM Provider', 'OpenAI', 'openai'] }, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!llmCred?.serviceUrl) {
      return NextResponse.json(nativeMetadata || {
        providers: [],
        models: [],
        source: 'llm-fallback',
        error: 'No TradingAgents service or LLM credential configured',
      } satisfies TradingAgentsMetadataResponse);
    }

    let parsedData: Record<string, unknown> = {};
    try {
      if (llmCred.encryptedData) {
        const rawData = isEncrypted(llmCred.encryptedData) ? decrypt(llmCred.encryptedData) : llmCred.encryptedData;
        parsedData = JSON.parse(rawData);
      }
    } catch {}

    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (parsedData.apiKey) headers.Authorization = `Bearer ${parsedData.apiKey}`;
    const baseUrl = llmCred.serviceUrl.replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const fallbackResponse: TradingAgentsMetadataResponse = {
        providers: [],
        models: [],
        source: 'llm-fallback',
        error: `LLM fallback failed: HTTP ${res.status}`,
      };
      return NextResponse.json(fallbackResponse);
    }

    const llmData: LlmModelsResponse = await res.json();

    // Normalize LLM models response into TradingAgentsMetadataResponse shape
    const normalizedModels: MetadataOption[] = (llmData.models || llmData.data || []).map((m: unknown) => {
      if (typeof m === 'string') return { id: m, label: m };
      const obj = m as Record<string, unknown>;
      return {
        id: (obj.id || obj.name || '') as string,
        label: (obj.name || obj.label || obj.id || '') as string,
      };
    });

    const fallbackProviders = llmData.provider
      ? [{ id: llmData.provider, label: llmData.provider }]
      : [{ id: 'llm', label: 'LLM Provider' }];

    const fallbackResponse: TradingAgentsMetadataResponse = nativeMetadata ? {
      providers: mergeMetadataOptions(nativeMetadata.providers, fallbackProviders),
      models: mergeMetadataOptions(normalizedModels, nativeMetadata.models),
      source: 'tradingagents',
      ...(llmData.error ? { error: llmData.error } : {}),
      ...(nativeMetadata.warning ? { warning: `${nativeMetadata.warning}; app LLM credential fallback succeeded` } : {}),
    } : {
      providers: fallbackProviders,
      models: normalizedModels,
      source: 'llm-fallback',
      ...(llmData.error ? { error: llmData.error } : {}),
    };

    return NextResponse.json(fallbackResponse);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error';
    const errorResponse: TradingAgentsMetadataResponse = {
      providers: [],
      models: [],
      source: 'llm-fallback',
      error: `Failed to fetch metadata: ${msg}`,
    };
    return NextResponse.json(errorResponse);
  }
}
