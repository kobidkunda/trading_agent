import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import type { QdrantDistanceMetric } from '@/lib/types';

async function getCredentialHeaders(credentialId: string): Promise<{ baseUrl: string; headers: Record<string, string> } | null> {
  const credential = await db.credential.findUnique({ where: { id: credentialId } });
  if (!credential || !credential.serviceUrl) return null;

  let parsedData: Record<string, unknown> = {};
  try {
    if (credential.encryptedData) parsedData = JSON.parse(credential.encryptedData);
  } catch {}

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (parsedData.apiKey) {
    headers['Authorization'] = `Bearer ${parsedData.apiKey}`;
  }

  return { baseUrl: credential.serviceUrl.replace(/\/$/, ''), headers };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const credentialId = searchParams.get('credentialId');

    if (!credentialId) {
      return NextResponse.json({ error: 'credentialId is required' }, { status: 400 });
    }

    const conn = await getCredentialHeaders(credentialId);
    if (!conn) {
      return NextResponse.json({ error: 'Credential not found or no URL' }, { status: 404 });
    }

    const res = await fetch(`${conn.baseUrl}/collections`, {
      method: 'GET',
      headers: conn.headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch collections from Qdrant' }, { status: res.status });
    }

    const data = await res.json();
    const collections = data.result?.collections || data.collections || [];

    return NextResponse.json({ collections });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to list collections' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { credentialId, name, vectorSize, distance, payloadIndexes } = body as {
      credentialId: string;
      name: string;
      vectorSize: number;
      distance: QdrantDistanceMetric;
      payloadIndexes?: string[];
    };

    if (!credentialId || !name || !vectorSize || !distance) {
      return NextResponse.json({ error: 'credentialId, name, vectorSize, and distance are required' }, { status: 400 });
    }

    const conn = await getCredentialHeaders(credentialId);
    if (!conn) {
      return NextResponse.json({ error: 'Credential not found or no URL' }, { status: 404 });
    }

    const createPayload: Record<string, unknown> = {
      vectors: {
        size: vectorSize,
        distance,
      },
    };

    const createRes = await fetch(`${conn.baseUrl}/collections/${name}`, {
      method: 'PUT',
      headers: conn.headers,
      body: JSON.stringify(createPayload),
      signal: AbortSignal.timeout(15000),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      return NextResponse.json({ error: `Qdrant create failed: ${errText}` }, { status: createRes.status });
    }

    if (payloadIndexes && payloadIndexes.length > 0) {
      for (const field of payloadIndexes) {
        try {
          await fetch(`${conn.baseUrl}/collections/${name}/index`, {
            method: 'PUT',
            headers: conn.headers,
            body: JSON.stringify({ field_name: field, field_schema: 'keyword' }),
            signal: AbortSignal.timeout(5000),
          });
        } catch {}
      }
    }

    await db.auditLog.create({
      data: {
        action: 'CREATE_QDRANT_COLLECTION',
        entityType: 'QdrantCollection',
        entityId: name,
        details: `Collection "${name}" created (${vectorSize}d ${distance})`,
      },
    });

    return NextResponse.json({ success: true, name });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create collection' }, { status: 500 });
  }
}