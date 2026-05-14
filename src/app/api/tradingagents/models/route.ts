import { NextResponse } from 'next/server';
import { fetchTradingAgentsMetadata } from '@/lib/engine/research/tradingagents-api';
import type { MetadataOption, TradingAgentsMetadataResponse } from '@/lib/types';

interface LlmModelsResponse {
  models: MetadataOption[];
  provider?: string;
  error?: string;
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

  if (nativeMetadata) {
    return NextResponse.json(nativeMetadata);
  }

  // Fallback to LLM models endpoint
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/llm/models`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const fallbackResponse: TradingAgentsMetadataResponse = {
        providers: [],
        models: [],
        source: 'llm-fallback',
        error: `LLM fallback failed: HTTP ${res.status}`,
      };
      return NextResponse.json(fallbackResponse, { status: 503 });
    }

    const llmData: LlmModelsResponse = await res.json();

    // Normalize LLM models response into TradingAgentsMetadataResponse shape
    const normalizedModels: MetadataOption[] = (llmData.models || []).map((m: unknown) => {
      if (typeof m === 'string') return { id: m, label: m };
      const obj = m as Record<string, unknown>;
      return {
        id: (obj.id || obj.name || '') as string,
        label: (obj.name || obj.label || obj.id || '') as string,
      };
    });

    const fallbackResponse: TradingAgentsMetadataResponse = {
      providers: llmData.provider
        ? [{ id: llmData.provider, label: llmData.provider }]
        : [{ id: 'llm', label: 'LLM Provider' }],
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
    return NextResponse.json(errorResponse, { status: 503 });
  }
}
