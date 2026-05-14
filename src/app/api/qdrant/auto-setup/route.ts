import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isEncrypted, decrypt } from '@/lib/engine/crypto';
import { QDRANT_DEFAULT_COLLECTIONS, EMBEDDING_PROVIDER_OPTIONS } from '@/lib/constants';

async function getCredentialAuth(credentialId: string): Promise<{ baseUrl: string; headers: Record<string, string> } | null> {
  const credential = await db.credential.findUnique({ where: { id: credentialId } });
  if (!credential || !credential.serviceUrl) return null;

  let parsedData: Record<string, unknown> = {};
  try {
    if (credential.encryptedData) {
      const rawData = isEncrypted(credential.encryptedData) ? decrypt(credential.encryptedData) : credential.encryptedData;
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

  return { baseUrl: credential.serviceUrl.replace(/\/$/, ''), headers };
}

interface SetupResult {
  key: string;
  name: string;
  created: boolean;
  skipped: boolean;
  error: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { credentialId, vectorSize, distance } = body as {
      credentialId: string;
      vectorSize?: number;
      distance?: string;
    };

    if (!credentialId) {
      return NextResponse.json({ error: 'credentialId is required' }, { status: 400 });
    }

    const conn = await getCredentialAuth(credentialId);
    if (!conn) {
      return NextResponse.json({ error: 'Credential not found or no URL' }, { status: 404 });
    }

    const dims = vectorSize || EMBEDDING_PROVIDER_OPTIONS.find((p) => p.value === 'openai')!.defaultDims;
    const dist = distance || 'Cosine';

    const collectionsRes = await fetch(`${conn.baseUrl}/collections`, {
      method: 'GET',
      headers: conn.headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!collectionsRes.ok) {
      return NextResponse.json({ error: `Failed to list collections: HTTP ${collectionsRes.status}` }, { status: collectionsRes.status });
    }

    const collectionsData = await collectionsRes.json();
    const existingNames: Set<string> = new Set(
      (collectionsData.result?.collections || collectionsData.collections || []).map((c: { name: string }) => c.name)
    );

    const linkedSetting = await db.settings.findUnique({
      where: { key: `qdrant_collections_${credentialId}` },
    });
    const existingLinks: Record<string, string> = linkedSetting ? JSON.parse(linkedSetting.value) : {};

    const results: SetupResult[] = [];
    const newLinks: Record<string, string> = { ...existingLinks };

    for (const def of QDRANT_DEFAULT_COLLECTIONS) {
      const linkedName = existingLinks[def.key];
      if (linkedName && existingNames.has(linkedName)) {
        results.push({ key: def.key, name: linkedName, created: false, skipped: true, error: null });
        continue;
      }

      if (existingNames.has(def.defaultName)) {
        newLinks[def.key] = def.defaultName;
        results.push({ key: def.key, name: def.defaultName, created: false, skipped: true, error: null });
        continue;
      }

      const createPayload = {
        vectors: { size: dims, distance: dist },
      };

      try {
        const createRes = await fetch(`${conn.baseUrl}/collections/${def.defaultName}`, {
          method: 'PUT',
          headers: conn.headers,
          body: JSON.stringify(createPayload),
          signal: AbortSignal.timeout(15000),
        });

        if (!createRes.ok) {
          const errText = await createRes.text().catch(() => 'Unknown error');
          results.push({ key: def.key, name: def.defaultName, created: false, skipped: false, error: `HTTP ${createRes.status}: ${errText.slice(0, 200)}` });
          continue;
        }

        if (def.payloadIndexes && def.payloadIndexes.length > 0) {
          for (const field of def.payloadIndexes) {
            try {
              await fetch(`${conn.baseUrl}/collections/${def.defaultName}/index`, {
                method: 'PUT',
                headers: conn.headers,
                body: JSON.stringify({ field_name: field, field_schema: 'keyword' }),
                signal: AbortSignal.timeout(5000),
              });
            } catch {}
          }
        }

        newLinks[def.key] = def.defaultName;
        existingNames.add(def.defaultName);
        results.push({ key: def.key, name: def.defaultName, created: true, skipped: false, error: null });
      } catch (err) {
        results.push({ key: def.key, name: def.defaultName, created: false, skipped: false, error: err instanceof Error ? err.message : 'Network error' });
      }
    }

    await db.settings.upsert({
      where: { key: `qdrant_collections_${credentialId}` },
      update: { value: JSON.stringify(newLinks) },
      create: { key: `qdrant_collections_${credentialId}`, value: JSON.stringify(newLinks) },
    });

    await db.auditLog.create({
      data: {
        action: 'AUTO_SETUP_QDRANT',
        entityType: 'QdrantCollection',
        entityId: credentialId,
        details: `Auto-setup: ${results.filter((r) => r.created).length} created, ${results.filter((r) => r.skipped).length} existing`,
      },
    });

    return NextResponse.json({ success: true, results, links: newLinks });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: `Auto-setup failed: ${msg}` }, { status: 500 });
  }
}