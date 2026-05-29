import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isEncrypted, decrypt } from '@/lib/engine/crypto';

export async function GET() {
  try {
    const llmCred = await db.credential.findFirst({
      where: { service: { in: ['llm', 'LLM Provider', 'OpenAI', 'openai'] }, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!llmCred?.serviceUrl) {
      return NextResponse.json({ provider: null, models: [], source: 'credential-missing', error: 'No active LLM Provider credential with serviceUrl' }, { status: 200 });
    }

    let parsedData: Record<string, unknown> = {};
    try {
      if (llmCred.encryptedData) {
        const rawData = isEncrypted(llmCred.encryptedData) ? decrypt(llmCred.encryptedData) : llmCred.encryptedData;
        parsedData = JSON.parse(rawData);
      }
    } catch {
      parsedData = {};
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const candidateKeys = ['apiKey', 'api_key', 'key', 'token', 'accessToken', 'authorization'];
    let authToken = '';

    for (const key of candidateKeys) {
      const value = parsedData[key];
      if (typeof value === 'string' && value.trim()) {
        authToken = value.trim();
        break;
      }
    }

    if (!authToken && typeof llmCred.encryptedData === 'string') {
      try {
        const rawData = isEncrypted(llmCred.encryptedData) ? decrypt(llmCred.encryptedData) : llmCred.encryptedData;
        const direct = rawData.trim();
        if (direct && !direct.startsWith('{') && !direct.startsWith('[')) {
          authToken = direct;
        }
      } catch {
        // keep empty token
      }
    }

    if (authToken) {
      headers.Authorization = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
    }

    const baseUrl = llmCred.serviceUrl.replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ provider: baseUrl, models: [], source: 'credential-api-failed', error: `Failed to fetch models: HTTP ${res.status}` }, { status: 200 });
    }

    const data = await res.json();
    const rawModels = data.data || data.models || [];

    const allModels = rawModels
      .map((m: { id?: string; name?: string; model?: string }) => m.id || m.name || m.model || '')
      .filter((id: string) => Boolean(id));

    const embeddingLike = allModels.filter((id: string) => id.toLowerCase().includes('embed'));
    const selected = embeddingLike.length > 0 ? embeddingLike : allModels;

    const unique = Array.from(new Set(selected));

    return NextResponse.json({ provider: baseUrl, models: unique, source: 'credential-api' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ provider: null, models: [], source: 'credential-api-failed', error: 'Failed to fetch embedding models', detail: message }, { status: 200 });
  }
}
