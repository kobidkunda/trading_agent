import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isEncrypted, decrypt } from '@/lib/engine/crypto';

export async function GET() {
  try {
    const llmCred = await db.credential.findFirst({
      where: { service: { in: ['llm', 'LLM Provider', 'OpenAI', 'openai'] }, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!llmCred || !llmCred.serviceUrl) {
      return NextResponse.json({ models: [], error: 'No LLM credential configured' });
    }

    let parsedData: Record<string, unknown> = {};
    try {
      if (llmCred.encryptedData) {
        const rawData = isEncrypted(llmCred.encryptedData) ? decrypt(llmCred.encryptedData) : llmCred.encryptedData;
        parsedData = JSON.parse(rawData);
      }
    } catch {}

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (parsedData.apiKey) {
      headers['Authorization'] = `Bearer ${parsedData.apiKey}`;
    }

    const baseUrl = llmCred.serviceUrl.replace(/\/$/, '');
    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ models: [], error: `Failed to fetch models: HTTP ${res.status}` });
    }

    const data = await res.json();
    const rawModels = data.data || data.models || [];

    const models = rawModels.map((m: { id?: string; name?: string; model?: string }) => ({
      id: m.id || m.name || m.model || '',
      name: m.id || m.name || m.model || '',
    })).filter((m: { id: string }) => m.id);

    return NextResponse.json({ models, provider: baseUrl });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ models: [], error: `Failed to list models: ${msg}` });
  }
}