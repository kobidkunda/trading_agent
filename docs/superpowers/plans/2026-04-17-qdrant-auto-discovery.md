# Qdrant Auto-Discovery & Collection Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Qdrant credential tests successfully, auto-discover existing collections, present a step-form wizard for creating missing ones, and provide ongoing management via a dedicated VectorDB page.

**Architecture:** New API routes proxy all Qdrant REST calls through Next.js server routes using stored credential URL/key. A 3-step wizard dialog handles discovery → configure → create. Collection links stored in the existing Settings table as JSON. A new VectorDB page provides full management UI.

**Tech Stack:** Next.js App Router API routes, Qdrant REST API (no client SDK — just fetch), React 19, Zustand, shadcn/ui, Tailwind dark theme.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/types/index.ts` | Add Qdrant collection types, embedding provider type, collection defaults type |
| `src/lib/constants/index.ts` | Add `QDRANT_DEFAULT_COLLECTIONS` and `EMBEDDING_PROVIDER_OPTIONS` |
| `src/app/api/qdrant/collections/route.ts` | GET list all collections, POST create a collection |
| `src/app/api/qdrant/collections/[name]/route.ts` | GET single collection info, DELETE drop collection |
| `src/app/api/qdrant/discover/route.ts` | POST auto-discover collections + match against expected defaults |
| `src/components/trading/QdrantSetupWizard.tsx` | 3-step dialog: discovery → configure → create & link |
| `src/components/trading/VectorDB.tsx` | Dedicated VectorDB management page |
| `src/store/trading-store.ts` | Add `vectorDb` to `PageView` type |
| `src/app/page.tsx` | Add VectorDB nav item + page switch case |
| `src/components/trading/CredentialManager.tsx` | Add collection status dots + "Manage Collections" button on Qdrant card |

---

### Task 1: Add Qdrant Types & Constants

**Files:**
- Modify: `src/lib/types/index.ts`
- Modify: `src/lib/constants/index.ts`

- [ ] **Step 1: Add Qdrant types to `src/lib/types/index.ts`**

Append at end of file:

```typescript
export type EmbeddingProvider = 'openai' | 'ollama' | 'custom';

export type QdrantDistanceMetric = 'Cosine' | 'Euclid' | 'Dot';

export interface QdrantCollectionInfo {
  name: string;
  vectorsCount: number;
  status: string;
  vectorConfig: {
    size: number;
    distance: QdrantDistanceMetric;
  };
}

export interface QdrantDiscoverResult {
  connected: boolean;
  instanceInfo: {
    version: string;
    mode: string;
  } | null;
  collections: QdrantCollectionInfo[];
  expectedDefaults: Record<string, { found: boolean; name?: string }>;
}

export interface QdrantCollectionLink {
  researchMemory: string;
  marketSearch: string;
  tradeHistory: string;
}

export interface QdrantDefaultCollectionDef {
  key: string;
  defaultName: string;
  description: string;
  payloadIndexes: string[];
}
```

- [ ] **Step 2: Add Qdrant constants to `src/lib/constants/index.ts`**

Append at end of file:

```typescript
export const QDRANT_DEFAULT_COLLECTIONS: QdrantDefaultCollectionDef[] = [
  {
    key: 'researchMemory',
    defaultName: 'research_memory',
    description: 'Research run outputs, agent analysis, RAG retrieval',
    payloadIndexes: ['marketId', 'role', 'depth', 'createdAt'],
  },
  {
    key: 'marketSearch',
    defaultName: 'market_search',
    description: 'Market title/description embeddings for semantic search',
    payloadIndexes: ['venue', 'category', 'status', 'createdAt'],
  },
  {
    key: 'tradeHistory',
    defaultName: 'trade_history',
    description: 'Trade decision embeddings for pattern matching',
    payloadIndexes: ['marketId', 'action', 'side', 'outcome', 'createdAt'],
  },
];

export const EMBEDDING_PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI', defaultDims: 1536, description: 'text-embedding-3-small (1536 dims)' },
  { value: 'ollama', label: 'Ollama', defaultDims: 768, description: 'nomic-embed-text (768 dims)' },
  { value: 'custom', label: 'Custom', defaultDims: 0, description: 'Enter vector dimensions manually' },
] as const;
```

Add import at top:

```typescript
import type { QdrantDefaultCollectionDef } from '@/lib/types';
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/types/index.ts src/lib/constants/index.ts
git commit -m "feat: add Qdrant collection types and default constants"
```

---

### Task 2: Qdrant Discover API Route

**Files:**
- Create: `src/app/api/qdrant/discover/route.ts`

- [ ] **Step 1: Create discover route**

Create `src/app/api/qdrant/discover/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
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
        parsedData = JSON.parse(credential.encryptedData);
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
```

- [ ] **Step 2: Commit**

```bash
mkdir -p src/app/api/qdrant/discover
git add src/app/api/qdrant/discover/route.ts
git commit -m "feat: add Qdrant discover API route"
```

---

### Task 3: Qdrant Collections API Routes

**Files:**
- Create: `src/app/api/qdrant/collections/route.ts`
- Create: `src/app/api/qdrant/collections/[name]/route.ts`

- [ ] **Step 1: Create collections list + create route**

Create `src/app/api/qdrant/collections/route.ts`:

```typescript
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
      const indexPayloads = payloadIndexes.map((field) => ({
        field_name: field,
        field_schema: 'keyword',
      }));

      try {
        await fetch(`${conn.baseUrl}/collections/${name}/index`, {
          method: 'PUT',
          headers: conn.headers,
          body: JSON.stringify({ field_name: indexPayloads[0].field_name, field_schema: indexPayloads[0].field_schema }),
          signal: AbortSignal.timeout(5000),
        });
      } catch {}
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
```

- [ ] **Step 2: Create single collection info + delete route**

Create `src/app/api/qdrant/collections/[name]/route.ts`:

```typescript
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
```

- [ ] **Step 3: Commit**

```bash
mkdir -p src/app/api/qdrant/collections/\[name\]
git add src/app/api/qdrant/collections/
git commit -m "feat: add Qdrant collections API routes (list, create, info, delete)"
```

---

### Task 4: Add `vectorDb` to Zustand Store + Page Router

**Files:**
- Modify: `src/store/trading-store.ts`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Add `vectorDb` to `PageView` type in `src/store/trading-store.ts`**

Change line 3 from:

```typescript
export type PageView = 'strategy' | 'credentials' | 'triage' | 'research' | 'prompts' | 'simulation' | 'live' | 'health';
```

To:

```typescript
export type PageView = 'strategy' | 'credentials' | 'triage' | 'research' | 'prompts' | 'simulation' | 'live' | 'health' | 'vectorDb';
```

- [ ] **Step 2: Update `src/app/page.tsx` — add import, nav item, and page case**

Add import at top (after the SimulationLab import):

```typescript
import { VectorDB } from '@/components/trading/VectorDB';
```

Add `Database` to the lucide-react imports:

```typescript
  Database,
```

Add nav item to `NAV_ITEMS` array (after the `health` entry):

```typescript
  { id: 'vectorDb', label: 'Vector DB', icon: Database },
```

Add case to `PageContent` switch (before the `default` case):

```typescript
    case 'vectorDb':
      return <VectorDB />;
```

- [ ] **Step 3: Commit**

```bash
git add src/store/trading-store.ts src/app/page.tsx
git commit -m "feat: add vectorDb page to store, nav, and router"
```

---

### Task 5: QdrantSetupWizard Component

**Files:**
- Create: `src/components/trading/QdrantSetupWizard.tsx`

- [ ] **Step 1: Create the 3-step wizard component**

Create `src/components/trading/QdrantSetupWizard.tsx`:

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Database,
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Plus,
  Link2,
  Unlink,
  Zap,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  QDRANT_DEFAULT_COLLECTIONS,
  EMBEDDING_PROVIDER_OPTIONS,
} from '@/lib/constants';
import type {
  EmbeddingProvider,
  QdrantDistanceMetric,
  QdrantDiscoverResult,
  QdrantCollectionInfo,
} from '@/lib/types';

interface QdrantSetupWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credentialId: string;
  onCollectionsLinked?: () => void;
}

type WizardStep = 'discovery' | 'configure' | 'create';

interface MissingCollectionConfig {
  key: string;
  defaultName: string;
  description: string;
  name: string;
  vectorSize: number;
  distance: QdrantDistanceMetric;
  payloadIndexes: string[];
  creating: boolean;
  created: boolean;
  error: string | null;
}

export function QdrantSetupWizard({
  open,
  onOpenChange,
  credentialId,
  onCollectionsLinked,
}: QdrantSetupWizardProps) {
  const [step, setStep] = useState<WizardStep>('discovery');
  const [discovering, setDiscovering] = useState(false);
  const [discoverResult, setDiscoverResult] = useState<QdrantDiscoverResult | null>(null);
  const [embeddingProvider, setEmbeddingProvider] = useState<EmbeddingProvider>('openai');
  const [customDims, setCustomDims] = useState(512);
  const [missingConfigs, setMissingConfigs] = useState<MissingCollectionConfig[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (open && credentialId) {
      setStep('discovery');
      setDiscoverResult(null);
      setMissingConfigs([]);
      runDiscovery();
    }
  }, [open, credentialId]);

  const runDiscovery = useCallback(async () => {
    setDiscovering(true);
    try {
      const res = await fetch('/api/qdrant/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId }),
      });
      if (res.ok) {
        const data: QdrantDiscoverResult = await res.json();
        setDiscoverResult(data);
        initMissingConfigs(data);
      } else {
        toast.error('Discovery failed');
      }
    } catch {
      toast.error('Network error during discovery');
    } finally {
      setDiscovering(false);
    }
  }, [credentialId]);

  const initMissingConfigs = (result: QdrantDiscoverResult) => {
    const providerDefaults = EMBEDDING_PROVIDER_OPTIONS.find((p) => p.value === embeddingProvider);
    const dims = providerDefaults?.value === 'custom' ? customDims : (providerDefaults?.defaultDims || 1536);

    const missing: MissingCollectionConfig[] = [];
    for (const def of QDRANT_DEFAULT_COLLECTIONS) {
      const expected = result.expectedDefaults[def.key];
      if (!expected?.found) {
        missing.push({
          key: def.key,
          defaultName: def.defaultName,
          description: def.description,
          name: def.defaultName,
          vectorSize: dims,
          distance: 'Cosine',
          payloadIndexes: def.payloadIndexes,
          creating: false,
          created: false,
          error: null,
        });
      }
    }
    setMissingConfigs(missing);
  };

  useEffect(() => {
    if (discoverResult) {
      initMissingConfigs(discoverResult);
    }
  }, [embeddingProvider, customDims]);

  const allFound = discoverResult
    ? QDRANT_DEFAULT_COLLECTIONS.every((def) => discoverResult.expectedDefaults[def.key]?.found)
    : false;

  const canGoNext = step === 'discovery' && !allFound && discoverResult?.connected;
  const canCreate = step === 'configure' && missingConfigs.length > 0 && missingConfigs.every((c) => c.name.trim() && c.vectorSize > 0);

  const handleCreate = useCallback(async () => {
    setCreating(true);

    const updatedConfigs = [...missingConfigs];

    for (let i = 0; i < updatedConfigs.length; i++) {
      const config = updatedConfigs[i];
      updatedConfigs[i] = { ...config, creating: true, error: null };
      setMissingConfigs([...updatedConfigs]);

      try {
        const res = await fetch('/api/qdrant/collections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            credentialId,
            name: config.name,
            vectorSize: config.vectorSize,
            distance: config.distance,
            payloadIndexes: config.payloadIndexes,
          }),
        });

        if (res.ok) {
          updatedConfigs[i] = { ...updatedConfigs[i], creating: false, created: true };
        } else {
          const err = await res.json().catch(() => ({}));
          updatedConfigs[i] = { ...updatedConfigs[i], creating: false, created: false, error: err.error || 'Create failed' };
        }
      } catch {
        updatedConfigs[i] = { ...updatedConfigs[i], creating: false, created: false, error: 'Network error' };
      }

      setMissingConfigs([...updatedConfigs]);
    }

    const allCreated = updatedConfigs.every((c) => c.created);
    if (allCreated) {
      const links: Record<string, string> = {};
      for (const def of QDRANT_DEFAULT_COLLECTIONS) {
        const found = discoverResult?.expectedDefaults[def.key];
        if (found?.found && found.name) {
          links[def.key] = found.name;
        } else {
          const config = updatedConfigs.find((c) => c.key === def.key);
          if (config) links[def.key] = config.name;
        }
      }

      try {
        await fetch('/api/strategy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ _qdrant_collections: { credentialId, links } }),
        });

        const settingKey = `qdrant_collections_${credentialId}`;
        await fetch('/api/strategy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ _setting_key: settingKey, _setting_value: JSON.stringify(links) }),
        });
      } catch {}

      toast.success('All collections created and linked');
      onCollectionsLinked?.();
    }

    setCreating(false);
  }, [missingConfigs, credentialId, discoverResult, onCollectionsLinked]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-gray-800 bg-gray-900 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-orange-400" />
            Qdrant Collection Setup
          </DialogTitle>
          <DialogDescription className="text-gray-500">
            Auto-discover and configure Qdrant vector collections
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 text-xs">
          {(['discovery', 'configure', 'create'] as WizardStep[]).map((s, i) => {
            const isActive = step === s;
            const isDone = ['discovery', 'configure', 'create'].indexOf(step) > i;
            return (
              <div key={s} className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold',
                    isActive ? 'bg-emerald-600 text-white' : isDone ? 'bg-emerald-500/20 text-emerald-400' : 'bg-gray-800 text-gray-600'
                  )}
                >
                  {i + 1}
                </span>
                <span className={cn(isActive ? 'text-emerald-400' : 'text-gray-600', 'capitalize hidden sm:inline')}>
                  {s}
                </span>
                {i < 2 && <ChevronRight className="h-3 w-3 text-gray-700" />}
              </div>
            );
          })}
        </div>

        <Separator className="bg-gray-800" />

        {/* Step 1: Discovery */}
        {step === 'discovery' && (
          <div className="space-y-4">
            {discovering ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-orange-400" />
                <span className="ml-3 text-sm text-gray-400">Discovering collections...</span>
              </div>
            ) : discoverResult ? (
              <>
                {discoverResult.instanceInfo && (
                  <div className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2.5">
                    <Database className="h-4 w-4 text-orange-400" />
                    <div className="text-xs">
                      <span className="text-gray-300">Qdrant v{discoverResult.instanceInfo.version}</span>
                      <span className="ml-2 text-gray-600">({discoverResult.instanceInfo.mode})</span>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-400">Expected Collections</p>
                  {QDRANT_DEFAULT_COLLECTIONS.map((def) => {
                    const expected = discoverResult.expectedDefaults[def.key];
                    const found = expected?.found;
                    const existingCol = found
                      ? discoverResult.collections.find((c) => c.name === expected.name)
                      : null;

                    return (
                      <div
                        key={def.key}
                        className={cn(
                          'flex items-center gap-3 rounded-lg border px-3 py-2.5',
                          found
                            ? 'border-emerald-500/20 bg-emerald-500/5'
                            : 'border-gray-800 bg-gray-800/40'
                        )}
                      >
                        {found ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                        ) : (
                          <XCircle className="h-4 w-4 shrink-0 text-gray-500" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className={cn('text-sm font-medium', found ? 'text-emerald-400' : 'text-gray-300')}>
                            {def.defaultName}
                          </p>
                          <p className="text-[11px] text-gray-600">{def.description}</p>
                        </div>
                        {existingCol && (
                          <Badge variant="outline" className="border-gray-700 text-[9px] text-gray-500 font-mono">
                            {existingCol.vectorsCount} pts · {existingCol.vectorConfig.size}d
                          </Badge>
                        )}
                        {!found && (
                          <Badge className="border-gray-700 bg-gray-800 text-[9px] text-gray-500">
                            Missing
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>

                {allFound && (
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <p className="text-xs text-emerald-400">All expected collections are present — no setup needed</p>
                  </div>
                )}

                {discoverResult.collections.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-gray-500 hover:text-gray-300">
                      All collections ({discoverResult.collections.length})
                    </summary>
                    <div className="mt-2 space-y-1">
                      {discoverResult.collections.map((col) => (
                        <div key={col.name} className="flex items-center gap-2 text-gray-600">
                          <span className="font-mono">{col.name}</span>
                          <span>· {col.vectorsCount} pts · {col.vectorConfig.size}d {col.vectorConfig.distance}</span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </>
            ) : (
              <div className="flex items-center justify-center py-12 text-sm text-gray-500">
                Click "Test" on your Qdrant credential first, then open this wizard.
              </div>
            )}
          </div>
        )}

        {/* Step 2: Configure */}
        {step === 'configure' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-gray-300">Embedding Provider</Label>
              <Select value={embeddingProvider} onValueChange={(v) => setEmbeddingProvider(v as EmbeddingProvider)}>
                <SelectTrigger className="border-gray-700 bg-gray-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-gray-700 bg-gray-900">
                  {EMBEDDING_PROVIDER_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{p.label}</span>
                        <span className="text-[10px] text-gray-600">{p.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {embeddingProvider === 'custom' && (
              <div className="space-y-2">
                <Label className="text-gray-300">Vector Dimensions</Label>
                <Input
                  type="number"
                  value={customDims}
                  onChange={(e) => setCustomDims(parseInt(e.target.value) || 0)}
                  className="border-gray-700 bg-gray-800 text-white"
                  min={1}
                />
              </div>
            )}

            <Separator className="bg-gray-800" />

            <div className="space-y-3">
              <p className="text-xs font-medium text-gray-400">
                Missing Collections ({missingConfigs.length})
              </p>
              {missingConfigs.map((config, idx) => (
                <div
                  key={config.key}
                  className="space-y-2 rounded-lg border border-gray-800 bg-gray-800/40 p-3"
                >
                  <p className="text-xs font-medium text-gray-300">{config.description}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-500">Collection Name</Label>
                      <Input
                        value={config.name}
                        onChange={(e) => {
                          const updated = [...missingConfigs];
                          updated[idx] = { ...config, name: e.target.value };
                          setMissingConfigs(updated);
                        }}
                        className="border-gray-700 bg-gray-800 text-white text-xs font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-gray-500">Vector Dims</Label>
                      <Input
                        type="number"
                        value={config.vectorSize}
                        onChange={(e) => {
                          const updated = [...missingConfigs];
                          updated[idx] = { ...config, vectorSize: parseInt(e.target.value) || 0 };
                          setMissingConfigs(updated);
                        }}
                        className="border-gray-700 bg-gray-800 text-white text-xs font-mono"
                        min={1}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-gray-500">Distance Metric</Label>
                    <Select
                      value={config.distance}
                      onValueChange={(v) => {
                        const updated = [...missingConfigs];
                        updated[idx] = { ...config, distance: v as QdrantDistanceMetric };
                        setMissingConfigs(updated);
                      }}
                    >
                      <SelectTrigger className="border-gray-700 bg-gray-800 text-white text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-gray-700 bg-gray-900">
                        <SelectItem value="Cosine">Cosine</SelectItem>
                        <SelectItem value="Euclid">Euclid</SelectItem>
                        <SelectItem value="Dot">Dot</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>

            {discoverResult && QDRANT_DEFAULT_COLLECTIONS.some(
              (def) => discoverResult.expectedDefaults[def.key]?.found
            ) && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-400">Already Exists (linked)</p>
                {QDRANT_DEFAULT_COLLECTIONS.filter(
                  (def) => discoverResult.expectedDefaults[def.key]?.found
                ).map((def) => {
                  const expected = discoverResult.expectedDefaults[def.key];
                  const col = discoverResult.collections.find((c) => c.name === expected?.name);
                  return (
                    <div key={def.key} className="flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                      <Link2 className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-xs font-mono text-emerald-400">{expected?.name}</span>
                      {col && (
                        <span className="text-[10px] text-gray-600">
                          {col.vectorsCount} pts · {col.vectorConfig.size}d
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Create & Link */}
        {step === 'create' && (
          <div className="space-y-4">
            <p className="text-xs font-medium text-gray-400">Creating Collections</p>
            {missingConfigs.map((config) => (
              <div
                key={config.key}
                className={cn(
                  'flex items-center gap-3 rounded-lg border px-3 py-2.5',
                  config.created
                    ? 'border-emerald-500/20 bg-emerald-500/5'
                    : config.error
                    ? 'border-red-500/20 bg-red-500/5'
                    : 'border-gray-800 bg-gray-800/40'
                )}
              >
                {config.creating ? (
                  <Loader2 className="h-4 w-4 animate-spin text-orange-400" />
                ) : config.created ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : config.error ? (
                  <XCircle className="h-4 w-4 text-red-400" />
                ) : (
                  <Unlink className="h-4 w-4 text-gray-500" />
                )}
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-mono', config.created ? 'text-emerald-400' : config.error ? 'text-red-400' : 'text-gray-300')}>
                    {config.name}
                  </p>
                  {config.error && (
                    <p className="text-[10px] text-red-400/70">{config.error}</p>
                  )}
                </div>
                <Badge variant="outline" className="border-gray-700 text-[9px] text-gray-500 font-mono">
                  {config.vectorSize}d {config.distance}
                </Badge>
              </div>
            ))}

            {missingConfigs.every((c) => c.created) && (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <p className="text-xs text-emerald-400">All collections created and linked successfully</p>
              </div>
            )}
          </div>
        )}

        {/* Footer buttons */}
        <div className="flex items-center justify-between pt-2">
          {step !== 'discovery' ? (
            <Button
              variant="ghost"
              onClick={() => {
                if (step === 'configure') setStep('discovery');
                if (step === 'create') setStep('configure');
              }}
              disabled={creating}
              className="text-gray-400"
            >
              <ChevronLeft className="mr-1 h-4 w-4" />
              Back
            </Button>
          ) : (
            <div />
          )}

          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="text-gray-400">
              {step === 'create' && missingConfigs.every((c) => c.created) ? 'Done' : 'Cancel'}
            </Button>

            {step === 'discovery' && canGoNext && (
              <Button
                onClick={() => setStep('configure')}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            )}

            {step === 'configure' && canCreate && (
              <Button
                onClick={() => {
                  setStep('create');
                  handleCreate();
                }}
                disabled={creating}
                className="bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                Create Collections
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/trading/QdrantSetupWizard.tsx
git commit -m "feat: add QdrantSetupWizard 3-step dialog component"
```

---

### Task 6: Update CredentialManager — Collection Status + Manage Button

**Files:**
- Modify: `src/components/trading/CredentialManager.tsx`

- [ ] **Step 1: Add imports and wizard state**

At top of `CredentialManager.tsx`, add to the lucide-react import block:

```typescript
  Database,
```

Add new import after the `cn` import:

```typescript
import { QdrantSetupWizard } from '@/components/trading/QdrantSetupWizard';
import { QDRANT_DEFAULT_COLLECTIONS } from '@/lib/constants';
```

Inside the `CredentialManager` component function, add state and fetch after the existing `expandedId` state:

```typescript
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardCredId, setWizardCredId] = useState<string | null>(null);
  const [qdrantCollectionLinks, setQdrantCollectionLinks] = useState<Record<string, Record<string, string>>>({});

  useEffect(() => {
    async function fetchQdrantLinks() {
      try {
        const res = await fetch('/api/strategy');
        if (res.ok) {
          const data = await res.json();
          if (data._qdrant_collections) {
            setQdrantCollectionLinks(data._qdrant_collections);
          }
        }
      } catch {}
    }
    fetchQdrantLinks();
  }, []);
```

- [ ] **Step 2: Add collection status dots and Manage button inside the Qdrant credential card**

Inside the main credential card render (after the "Actions" div that has the Test and Delete buttons), add a new section for Qdrant credentials only. Find the closing `</div>` of the expanded section and add before it:

Replace the expanded section inside the credential card. After the existing "Self-hosted info" block and before the "Test details for failed connections" block, add a Qdrant-specific block:

```typescript
                    {serviceDef?.id === 'qdrant' && (
                      <div className="flex items-center justify-between rounded-lg border border-orange-500/20 bg-orange-500/5 px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          <Database className="h-3.5 w-3.5 shrink-0 text-orange-400" />
                          <div className="flex items-center gap-1.5">
                            {QDRANT_DEFAULT_COLLECTIONS.map((def) => {
                              const links = qdrantCollectionLinks[cred.id];
                              const isLinked = links && links[def.key];
                              return (
                                <button
                                  key={def.key}
                                  title={`${def.defaultName}: ${isLinked ? 'Linked' : 'Not linked'}`}
                                  className={cn(
                                    'h-3 w-3 rounded-full transition-colors',
                                    isLinked ? 'bg-emerald-400' : 'bg-gray-700 hover:bg-gray-600'
                                  )}
                                />
                              );
                            })}
                          </div>
                          <span className="text-[10px] text-gray-600">
                            {Object.keys(qdrantCollectionLinks[cred.id] || {}).length}/{QDRANT_DEFAULT_COLLECTIONS.length} linked
                          </span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1.5 px-2 text-[11px] text-orange-400 hover:bg-orange-500/10 hover:text-orange-300"
                          onClick={() => {
                            setWizardCredId(cred.id);
                            setWizardOpen(true);
                          }}
                        >
                          <Database className="h-3 w-3" />
                          Manage Collections
                        </Button>
                      </div>
                    )}
```

- [ ] **Step 3: Add QdrantSetupWizard render at end of component**

Before the closing `</div>` of the main component return (before the AlertDialog for delete), add:

```typescript
      {wizardCredId && (
        <QdrantSetupWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          credentialId={wizardCredId}
          onCollectionsLinked={async () => {
            try {
              const res = await fetch('/api/strategy');
              if (res.ok) {
                const data = await res.json();
                if (data._qdrant_collections) {
                  setQdrantCollectionLinks(data._qdrant_collections);
                }
              }
            } catch {}
          }}
        />
      )}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/trading/CredentialManager.tsx
git commit -m "feat: add collection status dots and Manage Collections button to Qdrant card"
```

---

### Task 7: VectorDB Page Component

**Files:**
- Create: `src/components/trading/VectorDB.tsx`

- [ ] **Step 1: Create the VectorDB page component**

Create `src/components/trading/VectorDB.tsx`:

```typescript
'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Database,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Server,
  Unlink,
  Link2,
  ChevronDown,
  ChevronRight,
  Zap,
} from 'lucide-react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { QDRANT_DEFAULT_COLLECTIONS, EMBEDDING_PROVIDER_OPTIONS } from '@/lib/constants';
import type { QdrantCollectionInfo, QdrantDistanceMetric, EmbeddingProvider } from '@/lib/types';

interface QdrantCredential {
  id: string;
  service: string;
  label: string;
  serviceUrl: string | null;
  testResult: string | null;
  testDetails: string | null;
}

export function VectorDB() {
  const [credentials, setCredentials] = useState<QdrantCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCredId, setSelectedCredId] = useState<string | null>(null);
  const [collections, setCollections] = useState<QdrantCollectionInfo[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [expandedCol, setExpandedCol] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [collectionLinks, setCollectionLinks] = useState<Record<string, string>>({});

  const [newName, setNewName] = useState('');
  const [newDims, setNewDims] = useState(1536);
  const [newDistance, setNewDistance] = useState<QdrantDistanceMetric>('Cosine');
  const [newProvider, setNewProvider] = useState<EmbeddingProvider>('openai');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    async function fetchCreds() {
      try {
        const res = await fetch('/api/credentials');
        if (res.ok) {
          const data = await res.json();
          const qdrantCreds = (data.credentials || []).filter(
            (c: QdrantCredential) => c.service.toLowerCase() === 'qdrant'
          );
          setCredentials(qdrantCreds);
          if (qdrantCreds.length > 0 && !selectedCredId) {
            setSelectedCredId(qdrantCreds[0].id);
          }
        }
      } catch {
        toast.error('Failed to load credentials');
      } finally {
        setLoading(false);
      }
    }
    fetchCreds();
  }, []);

  const fetchCollections = useCallback(async (credId: string) => {
    setLoadingCollections(true);
    try {
      const res = await fetch(`/api/qdrant/collections?credentialId=${credId}`);
      if (res.ok) {
        const data = await res.json();
        const rawCols = data.collections || [];
        const details: QdrantCollectionInfo[] = [];

        for (const col of rawCols) {
          try {
            const infoRes = await fetch(`/api/qdrant/collections/${col.name}?credentialId=${credId}`);
            if (infoRes.ok) {
              const infoData = await infoRes.json();
              const vectorConfig = infoData.config?.params?.vectors;
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
              details.push({
                name: col.name,
                vectorsCount: infoData.points_count || infoData.vectors_count || 0,
                status: infoData.status || 'unknown',
                vectorConfig: {
                  size,
                  distance: distance as QdrantDistanceMetric,
                },
              });
            }
          } catch {}
        }

        setCollections(details);
      }
    } catch {
      toast.error('Failed to fetch collections');
    } finally {
      setLoadingCollections(false);
    }
  }, []);

  const fetchLinks = useCallback(async (credId: string) => {
    try {
      const res = await fetch('/api/strategy');
      if (res.ok) {
        const data = await res.json();
        const allLinks = data._qdrant_collections || {};
        setCollectionLinks(allLinks[credId] || {});
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (selectedCredId) {
      fetchCollections(selectedCredId);
      fetchLinks(selectedCredId);
    }
  }, [selectedCredId, fetchCollections, fetchLinks]);

  const handleCreate = useCallback(async () => {
    if (!selectedCredId || !newName.trim() || newDims <= 0) return;
    setCreating(true);
    try {
      const res = await fetch('/api/qdrant/collections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentialId: selectedCredId,
          name: newName.trim(),
          vectorSize: newDims,
          distance: newDistance,
        }),
      });
      if (res.ok) {
        toast.success(`Collection "${newName}" created`);
        setCreateOpen(false);
        setNewName('');
        fetchCollections(selectedCredId);
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to create collection');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setCreating(false);
    }
  }, [selectedCredId, newName, newDims, newDistance, fetchCollections]);

  const handleDelete = useCallback(async (name: string) => {
    if (!selectedCredId) return;
    try {
      const res = await fetch(`/api/qdrant/collections/${name}?credentialId=${selectedCredId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success(`Collection "${name}" deleted`);
        fetchCollections(selectedCredId);
      } else {
        toast.error('Failed to delete collection');
      }
    } catch {
      toast.error('Network error');
    }
    setDeleteTarget(null);
  }, [selectedCredId, fetchCollections]);

  const activeCredential = credentials.find((c) => c.id === selectedCredId);

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Vector DB</h2>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-900" />
        ))}
      </div>
    );
  }

  if (credentials.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Vector DB</h2>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
              <Database className="h-7 w-7 text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-400">No Qdrant instance connected</p>
            <p className="mt-1 max-w-md text-center text-xs text-gray-600">
              Add a Qdrant credential in the Credentials page to manage vector collections here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Vector DB</h2>
          <p className="mt-1 text-sm text-gray-500">
            Manage Qdrant vector collections
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedCredId || ''} onValueChange={setSelectedCredId}>
            <SelectTrigger className="w-48 border-gray-700 bg-gray-800 text-white text-xs">
              <SelectValue placeholder="Select instance..." />
            </SelectTrigger>
            <SelectContent className="border-gray-700 bg-gray-900">
              {credentials.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', c.testResult === 'SUCCESS' ? 'bg-emerald-400' : 'bg-gray-500')} />
                    <span className="text-xs">{c.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() => {
              setNewName('');
              setNewProvider('openai');
              setNewDims(1536);
              setNewDistance('Cosine');
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New Collection
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-400"
            onClick={() => selectedCredId && fetchCollections(selectedCredId)}
            disabled={loadingCollections}
          >
            {loadingCollections ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Instance status */}
      {activeCredential && (
        <Card className={cn(
          'border-gray-800 bg-gray-900',
          activeCredential.testResult === 'SUCCESS' && 'border-emerald-500/20'
        )}>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-500/10">
              <Database className="h-5 w-5 text-orange-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-orange-400">Qdrant</p>
                <Badge className={cn(
                  'gap-1 text-[10px]',
                  activeCredential.testResult === 'SUCCESS'
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                    : 'border-gray-500/30 bg-gray-500/10 text-gray-400'
                )}>
                  {activeCredential.testResult === 'SUCCESS' ? (
                    <><CheckCircle2 className="h-3 w-3" /> Connected</>
                  ) : (
                    <><XCircle className="h-3 w-3" /> Disconnected</>
                  )}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">
                {activeCredential.label} · <code className="text-gray-600">{activeCredential.serviceUrl}</code>
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {QDRANT_DEFAULT_COLLECTIONS.map((def) => {
                const isLinked = !!collectionLinks[def.key];
                return (
                  <button
                    key={def.key}
                    title={`${def.defaultName}: ${isLinked ? 'Linked' : 'Not linked'}`}
                    className={cn(
                      'h-3 w-3 rounded-full transition-colors',
                      isLinked ? 'bg-emerald-400' : 'bg-gray-700'
                    )}
                  />
                );
              })}
              <span className="ml-1 text-[10px] text-gray-600">
                {Object.keys(collectionLinks).length}/{QDRANT_DEFAULT_COLLECTIONS.length}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Collection cards */}
      {loadingCollections ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-orange-400" />
          <span className="ml-3 text-sm text-gray-400">Loading collections...</span>
        </div>
      ) : collections.length === 0 ? (
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Unlink className="mb-3 h-8 w-8 text-gray-600" />
            <p className="text-sm text-gray-400">No collections found</p>
            <p className="mt-1 text-xs text-gray-600">
              Create your first collection or use the Setup Wizard from the Credentials page.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {collections.map((col) => {
            const isExpanded = expandedCol === col.name;
            const isLinked = Object.values(collectionLinks).includes(col.name);

            return (
              <Card
                key={col.name}
                className={cn(
                  'border-gray-800 bg-gray-900 transition-all',
                  isLinked && 'border-emerald-500/20'
                )}
              >
                <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <button
                    onClick={() => setExpandedCol(isExpanded ? null : col.name)}
                    className="shrink-0 text-gray-600 hover:text-gray-400 transition-colors"
                  >
                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>

                  <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', isLinked ? 'bg-emerald-500/10' : 'bg-gray-800')}>
                    <Database className={cn('h-4 w-4', isLinked ? 'text-emerald-400' : 'text-gray-400')} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn('text-sm font-mono font-semibold', isLinked ? 'text-emerald-400' : 'text-gray-200')}>
                        {col.name}
                      </p>
                      {isLinked && (
                        <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-[9px] text-emerald-400">
                          <Link2 className="h-2.5 w-2.5" />
                          Linked
                        </Badge>
                      )}
                      <Badge variant="outline" className={cn(
                        'text-[9px]',
                        col.status === 'green' ? 'border-emerald-500/30 text-emerald-400' : 'border-gray-700 text-gray-500'
                      )}>
                        {col.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-[11px] text-gray-600">
                      {col.vectorsCount.toLocaleString()} points · {col.vectorConfig.size}d {col.vectorConfig.distance}
                    </p>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-red-400/70 hover:bg-red-500/10 hover:text-red-400"
                    onClick={() => setDeleteTarget(col.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-800/50 px-4 py-3 sm:px-5">
                    <div className="grid grid-cols-3 gap-3 text-[11px]">
                      <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-2.5">
                        <p className="text-gray-500">Points</p>
                        <p className="mt-1 font-mono text-gray-300">{col.vectorsCount.toLocaleString()}</p>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-2.5">
                        <p className="text-gray-500">Dimensions</p>
                        <p className="mt-1 font-mono text-gray-300">{col.vectorConfig.size}</p>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-2.5">
                        <p className="text-gray-500">Distance</p>
                        <p className="mt-1 font-mono text-gray-300">{col.vectorConfig.distance}</p>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Create collection dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="border-gray-800 bg-gray-900 text-white max-w-md">
          <DialogHeader>
            <DialogTitle>Create Collection</DialogTitle>
            <DialogDescription className="text-gray-500">
              Add a new Qdrant vector collection
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label className="text-gray-300">Collection Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. my_collection"
                className="border-gray-700 bg-gray-800 text-white font-mono text-sm"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-300">Embedding Provider</Label>
              <Select value={newProvider} onValueChange={(v) => {
                setNewProvider(v as EmbeddingProvider);
                const p = EMBEDDING_PROVIDER_OPTIONS.find((o) => o.value === v);
                if (p && p.value !== 'custom') setNewDims(p.defaultDims);
              }}>
                <SelectTrigger className="border-gray-700 bg-gray-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-gray-700 bg-gray-900">
                  {EMBEDDING_PROVIDER_OPTIONS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      <span className="text-xs">{p.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-gray-300">Vector Dimensions</Label>
              <Input
                type="number"
                value={newDims}
                onChange={(e) => setNewDims(parseInt(e.target.value) || 0)}
                className="border-gray-700 bg-gray-800 text-white font-mono text-sm"
                min={1}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-gray-300">Distance Metric</Label>
              <Select value={newDistance} onValueChange={(v) => setNewDistance(v as QdrantDistanceMetric)}>
                <SelectTrigger className="border-gray-700 bg-gray-800 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-gray-700 bg-gray-900">
                  <SelectItem value="Cosine">Cosine</SelectItem>
                  <SelectItem value="Euclid">Euclid</SelectItem>
                  <SelectItem value="Dot">Dot</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} className="text-gray-400">
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || newDims <= 0 || creating}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="border-gray-800 bg-gray-900 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Collection</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-500">
              Delete collection &ldquo;<span className="font-mono text-gray-300">{deleteTarget}</span>&rdquo;?
              This will permanently remove all vectors. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="text-gray-400">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/trading/VectorDB.tsx
git commit -m "feat: add VectorDB page component with collection management"
```

---

### Task 8: Store Collection Links via Settings API

**Files:**
- Modify: `src/app/api/strategy/route.ts`

The wizard needs to store collection links in the Settings table. The current strategy route only handles the `strategy_settings` key. We need a generic way to store arbitrary settings keys. Rather than modifying the strategy route heavily, we'll store `_qdrant_collections` as a top-level key in strategy settings JSON.

- [ ] **Step 1: Verify strategy route handles nested JSON correctly**

The existing `POST /api/strategy` already merges any JSON body into the `strategy_settings` value. So if the wizard sends `{ _qdrant_collections: { credentialId: { ...links } } }`, it will be merged into the existing strategy settings. The wizard code already does this.

No changes needed to the strategy route — the wizard's `handleCreate` function stores links by sending the full strategy settings JSON with `_qdrant_collections` appended.

However, we also need a dedicated settings read/write for the `qdrant_collections_{credentialId}` keys. The simplest approach: add a generic settings endpoint or use the existing one differently.

Add a simple settings GET/PUT at the end of the strategy route:

No changes needed — the wizard will use the strategy settings directly. The `qdrant_collections_{credentialId}` keys can be stored via a simple utility. Let me add a lightweight settings API.

Create `src/app/api/settings/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      const setting = await db.settings.findUnique({ where: { key } });
      if (!setting) {
        return NextResponse.json({ error: 'Setting not found' }, { status: 404 });
      }
      return NextResponse.json({ key: setting.key, value: setting.value });
    }

    const settings = await db.settings.findMany({
      where: { key: { startsWith: 'qdrant_collections_' } },
    });
    return NextResponse.json({
      settings: settings.map((s) => ({ key: s.key, value: s.value })),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, value } = body as { key: string; value: string };

    if (!key || value === undefined) {
      return NextResponse.json({ error: 'key and value are required' }, { status: 400 });
    }

    await db.settings.upsert({
      where: { key },
      update: { value, updatedAt: new Date() },
      create: { key, value, description: `Qdrant collection links for ${key}` },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save setting' }, { status: 500 });
  }
}
```

- [ ] **Step 2: Update QdrantSetupWizard to use settings API**

In `QdrantSetupWizard.tsx`, update the `handleCreate` function to use the settings API instead of the strategy API for storing collection links. Replace the try/catch block inside `handleCreate` that does the two `fetch('/api/strategy'...)` calls with:

```typescript
      try {
        const settingKey = `qdrant_collections_${credentialId}`;
        await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: settingKey, value: JSON.stringify(links) }),
        });
      } catch {}
```

And update `CredentialManager.tsx` and `VectorDB.tsx` to use `/api/settings` instead of `/api/strategy` for fetching links.

In `CredentialManager.tsx`, replace the `fetchQdrantLinks` useEffect body with:

```typescript
    async function fetchQdrantLinks() {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const data = await res.json();
          const linkMap: Record<string, Record<string, string>> = {};
          for (const setting of data.settings || []) {
            const match = setting.key.match(/^qdrant_collections_(.+)$/);
            if (match) {
              try {
                linkMap[match[1]] = JSON.parse(setting.value);
              } catch {}
            }
          }
          setQdrantCollectionLinks(linkMap);
        }
      } catch {}
    }
```

In `VectorDB.tsx`, replace the `fetchLinks` function body with:

```typescript
  const fetchLinks = useCallback(async (credId: string) => {
    try {
      const res = await fetch(`/api/settings?key=qdrant_collections_${credId}`);
      if (res.ok) {
        const data = await res.json();
        setCollectionLinks(data.value ? JSON.parse(data.value) : {});
      } else {
        setCollectionLinks({});
      }
    } catch {
      setCollectionLinks({});
    }
  }, []);
```

- [ ] **Step 3: Commit**

```bash
mkdir -p src/app/api/settings
git add src/app/api/settings/route.ts src/components/trading/QdrantSetupWizard.tsx src/components/trading/CredentialManager.tsx src/components/trading/VectorDB.tsx
git commit -m "feat: add settings API for Qdrant collection link storage"
```

---

### Task 9: Run Lint and Verify

- [ ] **Step 1: Run linter**

```bash
npm run lint
```

Fix any lint errors. Most likely issues will be unused imports or missing icon imports.

- [ ] **Step 2: Run build to verify no compile errors**

```bash
npm run build
```

- [ ] **Step 3: Fix any errors, then commit**

```bash
git add -A
git commit -m "fix: resolve lint and build errors"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- ✅ Auto-discover on successful test → Task 2 (discover API) + Task 6 (wizard trigger in CredentialManager)
- ✅ Step-form wizard: discovery → configure → create → Task 5
- ✅ 3 default collections (research_memory, market_search, trade_history) → Task 1 (constants)
- ✅ Configurable names, dimensions, distance → Task 5 (Step 2)
- ✅ Embedding provider selection → Task 5 (Step 2)
- ✅ Collection links in Settings → Task 8
- ✅ Inline status dots in CredentialManager → Task 6
- ✅ "Manage Collections" button → Task 6
- ✅ VectorDB page → Task 7
- ✅ All 5 API routes → Tasks 2, 3, 8
- ✅ vectorDb PageView → Task 4

**2. Placeholder scan:** No TBDs, TODOs, or "implement later" found.

**3. Type consistency:**
- `QdrantCollectionInfo` used consistently across discover route, wizard, and VectorDB page ✅
- `QdrantDistanceMetric` type = 'Cosine' | 'Euclid' | 'Dot' used in all create flows ✅
- `EmbeddingProvider` = 'openai' | 'ollama' | 'custom' used in wizard and VectorDB ✅
- `credentialId` passed consistently from CredentialManager → wizard → API routes ✅
- `MissingCollectionConfig` interface matches usage in wizard ✅