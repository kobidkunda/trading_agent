import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { isEncrypted, decrypt } from '@/lib/engine/crypto';
import { QDRANT_DEFAULT_COLLECTIONS } from '@/lib/constants';
import type { QdrantCollectionInfo, QdrantDiscoverResult } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const credentialId = body.credentialId;

    if (!credentialId) {
      return NextResponse.json({ error: 'credentialId is required' }, { status: 400 });
    }

    const credential = await db.credential.findUnique({ where: { id: credentialId } });

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 });
    }

    if (!credential.serviceUrl) {
      return NextResponse.json({ error: 'No service URL configured' }, { status: 400 });
    }

    let parsedData: Record<string, unknown> = {};
    try {
      if (credential.encryptedData) {
        const rawData = isEncrypted(credential.encryptedData) ? decrypt(credential.encryptedData) : credential.encryptedData;
        parsedData = JSON.parse(rawData);
      }
    } catch {}

    const baseUrl = credential.serviceUrl.replace(/\/$/, '');
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (parsedData.apiKey) {
      headers['Authorization'] = `Bearer ${parsedData.apiKey}`;
    }

    let instanceInfo: QdrantDiscoverResult['instanceInfo'] = null;
    try {
      const healthRes = await fetch(`${baseUrl}/healthz`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (healthRes.ok) {
        const healthData = await healthRes.json();
        instanceInfo = {
          version: healthData.version || 'unknown',
          mode: healthData.mode || 'standalone',
        };
      }
    } catch {}

    const collectionsRes = await fetch(`${baseUrl}/collections`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!collectionsRes.ok) {
      return NextResponse.json({
        connected: false,
        instanceInfo: null,
        collections: [],
        expectedDefaults: QDRANT_DEFAULT_COLLECTIONS.reduce((acc, def) => {
          acc[def.key] = { found: false };
          return acc;
        }, {} as QdrantDiscoverResult['expectedDefaults']),
      });
    }

    const collectionsData = await collectionsRes.json();
    const rawCollections: Array<{ name: string }> = collectionsData.result?.collections || collectionsData.collections || [];

    const collectionDetails: QdrantCollectionInfo[] = [];

    for (const col of rawCollections) {
      try {
        const infoRes = await fetch(`${baseUrl}/collections/${col.name}`, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(5000),
        });
        if (infoRes.ok) {
          const infoData = await infoRes.json();
          const result = infoData.result;
          const vectorConfig = result?.config?.params?.vectors;
          let size = 0;
          let distance: string = 'Cosine';
          if (vectorConfig) {
            if (Array.isArray(vectorConfig)) {
              size = vectorConfig[0]?.size || 0;
              distance = vectorConfig[0]?.distance || 'Cosine';
            } else if (typeof vectorConfig === 'object') {
              const firstKey = Object.keys(vectorConfig)[0];
              if (firstKey && vectorConfig[firstKey]) {
                size = vectorConfig[firstKey].size || 0;
                distance = vectorConfig[firstKey].distance || 'Cosine';
              } else {
                size = vectorConfig.size || 0;
                distance = vectorConfig.distance || 'Cosine';
              }
            }
          }
          collectionDetails.push({
            name: col.name,
            vectorsCount: result?.points_count || result?.vectors_count || 0,
            status: result?.status || 'unknown',
            vectorConfig: {
              size,
              distance: distance as QdrantCollectionInfo['vectorConfig']['distance'],
            },
          });
        }
      } catch {}
    }

    const expectedDefaults: QdrantDiscoverResult['expectedDefaults'] = {};
    for (const def of QDRANT_DEFAULT_COLLECTIONS) {
      const found = collectionDetails.find((c) => c.name === def.defaultName);
      expectedDefaults[def.key] = found
        ? { found: true, name: found.name }
        : { found: false };
    }

    const linkedSetting = await db.settings.findUnique({
      where: { key: `qdrant_collections_${credentialId}` },
    });
    if (linkedSetting) {
      try {
        const links = JSON.parse(linkedSetting.value);
        for (const def of QDRANT_DEFAULT_COLLECTIONS) {
          const linkedName = links[def.key];
          if (linkedName) {
            const found = collectionDetails.find((c) => c.name === linkedName);
            expectedDefaults[def.key] = found
              ? { found: true, name: found.name }
              : { found: false };
          }
        }
      } catch {}
    }

    return NextResponse.json({
      connected: true,
      instanceInfo,
      collections: collectionDetails,
      expectedDefaults,
    } satisfies QdrantDiscoverResult);
  } catch (error) {
    return NextResponse.json({ error: 'Discovery failed' }, { status: 500 });
  }
}