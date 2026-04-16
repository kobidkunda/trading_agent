import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const { searchParams } = new URL(request.url);
    const credentialId = searchParams.get('credentialId');

    if (!credentialId) {
      return NextResponse.json({ error: 'credentialId is required' }, { status: 400 });
    }

    const conn = await getCredentialHeaders(credentialId);
    if (!conn) {
      return NextResponse.json({ error: 'Credential not found or no URL' }, { status: 404 });
    }

    const res = await fetch(`${conn.baseUrl}/collections/${name}`, {
      method: 'GET',
      headers: conn.headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Collection "${name}" not found` }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json(data.result || data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to get collection info' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params;
    const { searchParams } = new URL(request.url);
    const credentialId = searchParams.get('credentialId');

    if (!credentialId) {
      return NextResponse.json({ error: 'credentialId is required' }, { status: 400 });
    }

    const conn = await getCredentialHeaders(credentialId);
    if (!conn) {
      return NextResponse.json({ error: 'Credential not found or no URL' }, { status: 404 });
    }

    const res = await fetch(`${conn.baseUrl}/collections/${name}`, {
      method: 'DELETE',
      headers: conn.headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({ error: `Failed to delete collection "${name}"` }, { status: res.status });
    }

    await db.auditLog.create({
      data: {
        action: 'DELETE_QDRANT_COLLECTION',
        entityType: 'QdrantCollection',
        entityId: name,
        details: `Collection "${name}" deleted`,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete collection' }, { status: 500 });
  }
}