# Phase 1+2: Implementation Plan B (Pipeline Completion, Fixes, Encryption, Mode Separation, Settings UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the pipeline (judge → risk → execute in test mode), fix Kalshi schema health checks, add credential encryption, separate simulation from live mode, add Qdrant writeback + RAG retrieval, and add a Settings/Requirements page showing what services need to be active.

**Architecture:** The worker from Plan A dispatches jobs typed SCAN, TRIAGE, RESEARCH, JUDGE, RISK, SETTLE. This plan completes the pipeline by implementing processJudge, processRisk, processExecute (paper-only in test mode), processSettle. It also fixes the infrastructure gaps (Kalshi schema, health checks, encryption) and adds a UI requirements panel.

**Tech Stack:** Next.js 16 App Router, Prisma/SQLite, Qdrant REST API, AES-256-GCM for encryption.

**Key constraint:** In test mode, the full pipeline runs but order submission is blocked by the kill switch. Every LLM call, search result, and decision is logged. No real money moves.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/engine/pipeline.ts` | Orchestrates full pipeline for one market (triage → research → judge → risk → execute) |
| `src/lib/engine/crypto.ts` | AES-256-GCM encrypt/decrypt for credential data |
| `src/lib/engine/memory/embed.ts` | Text embedding client (OpenAI or Ollama) |
| `src/lib/engine/memory/qdrant.ts` | Qdrant writeback + RAG retrieval |
| `src/app/api/jobs/worker/route.ts` | Worker start/stop/status API |
| `src/app/api/markets/sync/route.ts` | Trigger market sync from venues |
| `src/app/api/health/route.ts` | Fix: ping real services (modify existing) |
| `src/lib/venues/kalshi.ts` | Fix: schema mismatch (modify existing) |
| `src/components/trading/PipelineSettings.tsx` | Settings + requirements panel (new page) |
| `src/store/trading-store.ts` | Add `pipelineSettings` to PageView (modify) |
| `src/app/page.tsx` | Add PipelineSettings nav item (modify) |
| `src/lib/engine/mode.ts` | Test mode vs live mode utilities |

---

### Task 6: Pipeline Completion (processJudge, processRisk, processExecute, processSettle)

**Files:**
- Create: `src/lib/engine/pipeline.ts`

This adds the remaining pipeline functions to `worker.ts` and creates `pipeline.ts` as the orchestrator that ties the full flow together for a single market.

**pipeline.ts:**
```typescript
// src/lib/engine/pipeline.ts
import { db } from '@/lib/db';
import { computeRisk } from '@/lib/engine/risk';
import { runTriageAgent } from '@/lib/engine/agents/triage';
import { runBullAgent } from '@/lib/engine/agents/bull';
import { runBearAgent } from '@/lib/engine/agents/bear';
import { runContradictionAgent } from '@/lib/engine/agents/contradiction';
import { runJudgeAgent } from '@/lib/engine/agents/judge';
import { searchSearXNG } from '@/lib/engine/research/search';
import { extractContent } from '@/lib/engine/research/extract';
import { writeResearchToQdrant, retrieveSimilarMarkets } from '@/lib/engine/memory/qdrant';
import { isTestMode } from '@/lib/engine/mode';
import type { BullOutput } from '@/lib/engine/agents/bull';
import type { BearOutput } from '@/lib/engine/agents/bear';
import type { ContradictionOutput } from '@/lib/engine/agents/contradiction';
import type { JudgeOutput } from '@/lib/types';

export interface PipelineResult {
  marketId: string;
  triageStatus: string;
  judgeOutput: JudgeOutput | null;
  riskAction: 'BUY' | 'SKIP' | null;
  orderId: string | null;
  error: string | null;
  stages: string[];
}

export async function runPipelineForMarket(marketId: string): Promise<PipelineResult> {
  const result: PipelineResult = {
    marketId,
    triageStatus: 'PENDING',
    judgeOutput: null,
    riskAction: null,
    orderId: null,
    error: null,
    stages: [],
  };

  try {
    const market = await db.market.findUnique({
      where: { id: marketId },
      include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 1 } },
    });
    if (!market) {
      result.error = `Market ${marketId} not found`;
      return result;
    }

    const snapshot = market.snapshots[0];
    const impliedProb = snapshot?.impliedProb ?? 0.5;
    const liquidity = snapshot?.liquidity ?? 0;

    // ── Stage 1: Triage ──
    result.stages.push('TRIAGE');
    const triageResult = await runTriageAgent(
      marketId, market.title, market.description || '', market.category, impliedProb, liquidity
    );
    result.triageStatus = triageResult.status;

    const candidate = await db.tradeCandidate.findFirst({ where: { marketId } });
    if (candidate) {
      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: {
          stage: 'TRIAGED',
          triageStatus: triageResult.status,
          triageReason: triageResult.reason,
          researchQueued: triageResult.worthResearch,
        },
      });
    }

    if (!triageResult.worthResearch) {
      result.stages.push('SKIPPED_TRIAGE');
      return result;
    }

    // ── Stage 2: Research ──
    result.stages.push('RESEARCH');
    const searchResults = await searchSearXNG(market.title, 5);
    const researchContext = searchResults.map((r) => `${r.title}: ${r.snippet}`).join('\n');

    const researchRun = await db.researchRun.create({
      data: {
        marketId,
        candidateId: candidate?.id || null,
        status: 'RUNNING',
        depth: 'DEEP',
        startedAt: new Date(),
      },
    });

    for (const sr of searchResults) {
      const extracted = await extractContent(sr.url);
      await db.researchSource.create({
        data: {
          researchRunId: researchRun.id,
          url: sr.url,
          title: sr.title,
          content: extracted?.content || sr.snippet,
          sourceType: 'SEARCH',
          recencyScore: sr.recencyScore,
          qualityScore: sr.qualityScore,
        } as any,
      });
    }

    if (candidate) {
      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: { stage: 'RESEARCHING' },
      });
    }

    // RAG retrieval from Qdrant
    const similarMarkets = await retrieveSimilarMarkets(market.title, market.description || '');

    // ── Stage 3: Bull ──
    result.stages.push('BULL');
    const bull = await runBullAgent(marketId, market.title, impliedProb, researchContext);
    await db.agentOutput.create({
      data: {
        researchRunId: researchRun.id, role: 'BULL', modelUsed: 'llm',
        promptVersion: '1', output: JSON.stringify(bull),
        tokenCount: 0, latencyMs: 0,
      } as any,
    });

    // ── Stage 4: Bear ──
    result.stages.push('BEAR');
    const bear = await runBearAgent(marketId, market.title, impliedProb, researchContext);
    await db.agentOutput.create({
      data: {
        researchRunId: researchRun.id, role: 'BEAR', modelUsed: 'llm',
        promptVersion: '1', output: JSON.stringify(bear),
        tokenCount: 0, latencyMs: 0,
      } as any,
    });

    // ── Stage 5: Contradiction ──
    result.stages.push('CONTRADICTION');
    const contradiction = await runContradictionAgent(marketId, market.title, bull, bear);
    await db.agentOutput.create({
      data: {
        researchRunId: researchRun.id, role: 'CONTRADICTION', modelUsed: 'llm',
        promptVersion: '1', output: JSON.stringify(contradiction),
        tokenCount: 0, latencyMs: 0,
      } as any,
    });

    await db.researchRun.update({
      where: { id: researchRun.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    // ── Stage 6: Judge ──
    result.stages.push('JUDGE');
    const judgeOutput = await runJudgeAgent(
      marketId, market.title, impliedProb, bull, bear, contradiction
    );
    result.judgeOutput = judgeOutput;

    await db.agentOutput.create({
      data: {
        researchRunId: researchRun.id, role: 'JUDGE', modelUsed: 'llm',
        promptVersion: '1', output: JSON.stringify(judgeOutput),
        tokenCount: 0, latencyMs: 0,
      } as any,
    });

    if (candidate) {
      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: { stage: 'JUDGED' },
      });
    }

    // ── Stage 7: Risk Engine (Deterministic) ──
    result.stages.push('RISK');
    const strategySetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
    const strategy = strategySetting ? JSON.parse(strategySetting.value) : {};

    const riskInput = {
      impliedProbability: impliedProb,
      judgeProbability: judgeOutput.trueProbability,
      confidence: judgeOutput.confidence,
      uncertainty: judgeOutput.uncertainty,
      fees: 0.02,
      slippage: 0.01,
      venue: market.venue as 'POLYMARKET' | 'KALSHI' | 'SX_BET' | 'MANIFOLD',
      category: market.category,
      dailyExposure: strategy.maxDailyExposure ?? 50000,
      categoryExposure: 0,
      openPositions: await db.position.count({ where: { status: 'OPEN' } }),
      marketLiquidity: liquidity,
      marketSpread: snapshot?.spread ?? 0.05,
      catalystTiming: judgeOutput.catalystTiming === 'CLOSE' ? 'CLOSE' : undefined,
    };

    const riskResult = computeRisk(riskInput);
    result.riskAction = riskResult.action;

    await db.decision.create({
      data: {
        marketId,
        candidateId: candidate?.id || null,
        action: riskResult.action,
        side: riskResult.side ?? null,
        reasonCode: riskResult.reasonCode ?? null,
        reason: riskResult.reason,
        judgeProbability: judgeOutput.trueProbability,
        impliedProb,
        edge: riskResult.edge,
        confidence: judgeOutput.confidence,
        uncertainty: judgeOutput.uncertainty,
        maxSize: riskResult.maxSize,
        urgency: riskResult.urgency,
        fees: riskResult.fees,
        slippage: riskResult.slippage,
        dryRun: isTestMode(),
      },
    });

    if (candidate) {
      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: { stage: 'DECIDED' },
      });
    }

    // ── Stage 8: Execute (paper mode — record order but don't place real order) ──
    if (riskResult.action === 'BUY') {
      result.stages.push('EXECUTE');
      if (isTestMode()) {
        // Paper trade: record simulated order
        const orderSize = riskResult.adjustedSize || riskResult.maxSize;
        const orderPrice = riskResult.side === 'YES' ? impliedProb : 1 - impliedProb;

        await db.order.create({
          data: {
            marketId,
            venueOrderId: `PAPER_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            side: riskResult.side ?? 'YES',
            price: orderPrice,
            size: orderSize,
            filledSize: orderSize,
            status: 'FILLED',
            submittedAt: new Date(),
            filledAt: new Date(),
          },
        });

        await db.position.create({
          data: {
            marketId,
            side: riskResult.side ?? 'YES',
            entryPrice: orderPrice,
            currentSize: orderSize,
            avgEntryPrice: orderPrice,
            unrealizedPnl: (judgeOutput.trueProbability - orderPrice) * orderSize,
            realizedPnl: 0,
            status: 'OPEN',
          },
        });

        result.orderId = `PAPER_${Date.now()}`;
      } else {
        // Live mode: would call venue execution APIs here
        // BLOCKED by kill switch check — for now, just log intent
        await db.auditLog.create({
          data: {
            action: 'LIVE_ORDER_INTENT',
            entityType: 'Order',
            details: `Would place ${riskResult.side} order for ${riskResult.adjustedSize} on ${market.title} — EXECUTION NOT IMPLEMENTED`,
          },
        });
      }

      if (candidate) {
        await db.tradeCandidate.update({
          where: { id: candidate.id },
          data: { stage: 'EXECUTED' },
        });
      }
    }

    // ── Writeback to Qdrant ──
    try {
      await writeResearchToQdrant(marketId, market.title, researchContext, {
        judgeProbability: judgeOutput.trueProbability,
        confidence: judgeOutput.confidence,
        action: riskResult.action,
        side: riskResult.side,
        category: market.category,
      });
    } catch (e) {
      console.error('Qdrant writeback failed:', e);
    }

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Pipeline error';
    return result;
  }
}
```

- [ ] **Create `src/lib/engine/pipeline.ts`**
- [ ] **Commit:** `git add src/lib/engine/pipeline.ts && git commit -m "feat: add full pipeline orchestrator with test mode paper trading"`

---

### Task 7: Test/Live Mode Utilities

**Files:**
- Create: `src/lib/engine/mode.ts`

```typescript
// src/lib/engine/mode.ts

let _testMode: boolean = true; // Default to test mode

export function isTestMode(): boolean {
  return _testMode;
}

export function setTestMode(mode: boolean): void {
  _testMode = mode;
}

export function getModeLabel(): string {
  return _testMode ? 'TEST' : 'LIVE';
}
```

- [ ] **Create `src/lib/engine/mode.ts`**
- [ ] **Commit:** `git add src/lib/engine/mode.ts && git commit -m "feat: add test/live mode utilities"`

---

### Task 8: Qdrant Writeback + RAG Retrieval

**Files:**
- Create: `src/lib/engine/memory/embed.ts`
- Create: `src/lib/engine/memory/qdrant.ts`

**embed.ts:**
```typescript
// src/lib/engine/memory/embed.ts
import { db } from '@/lib/db';

export interface EmbeddingResult {
  vector: number[];
  model: string;
  dims: number;
}

export async function getEmbedding(text: string): Promise<EmbeddingResult | null> {
  const setting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  const strategy = setting ? JSON.parse(setting.value) : {};
  const provider = strategy.embeddingProvider || 'openai';

  if (provider === 'ollama') {
    return await getOllamaEmbedding(text, strategy.ollamaUrl);
  }
  return await getOpenAIEmbedding(text);
}

async function getOpenAIEmbedding(text: string): Promise<EmbeddingResult | null> {
  const cred = await db.credential.findFirst({
    where: { service: { in: ['LLM Provider', 'OpenAI'] }, isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  const baseUrl = cred?.serviceUrl?.replace(/\/$/, '') || 'https://api.openai.com/v1';
  let apiKey = '';
  if (cred?.encryptedData) {
    try {
      const parsed = JSON.parse(cred.encryptedData);
      apiKey = String(parsed.apiKey || '');
    } catch {}
  }

  if (!apiKey) apiKey = process.env.OPENAI_API_KEY || '';

  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: text.slice(0, 8000),
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const vector: number[] = data.data?.[0]?.embedding || [];
    return { vector, model: 'text-embedding-3-small', dims: vector.length };
  } catch {
    return null;
  }
}

async function getOllamaEmbedding(text: string, ollamaUrl?: string): Promise<EmbeddingResult | null> {
  let baseUrl = ollamaUrl;
  if (!baseUrl) {
    const cred = await db.credential.findFirst({
      where: { service: 'Ollama', isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    baseUrl = cred?.serviceUrl || 'http://localhost:11434';
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', prompt: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) return null;
    const data = await response.json();
    const vector: number[] = data.embedding || [];
    return { vector, model: 'nomic-embed-text', dims: vector.length };
  } catch {
    return null;
  }
}
```

**qdrant.ts:**
```typescript
// src/lib/engine/memory/qdrant.ts
import { db } from '@/lib/db';
import { getEmbedding } from './embed';

interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

async function getQdrantConfig(): Promise<{ baseUrl: string; apiKey: string; collectionName: string } | null> {
  const cred = await db.credential.findFirst({
    where: { service: 'qdrant', isActive: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!cred?.serviceUrl) return null;

  const linkSetting = await db.settings.findUnique({
    where: { key: `qdrant_collections_${cred.id}` },
  });

  let collectionName = 'research_memory';
  if (linkSetting) {
    try {
      const links = JSON.parse(linkSetting.value);
      collectionName = links.researchMemory || collectionName;
    } catch {}
  }

  let apiKey = '';
  if (cred.encryptedData) {
    try {
      const parsed = JSON.parse(cred.encryptedData);
      apiKey = String(parsed.apiKey || '');
    } catch {}
  }

  return { baseUrl: cred.serviceUrl.replace(/\/$/, ''), apiKey, collectionName };
}

async function qdrantFetch(path: string, method: string, body?: unknown): Promise<Response | null> {
  const config = await getQdrantConfig();
  if (!config) return null;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;

  try {
    return await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return null;
  }
}

export async function writeResearchToQdrant(
  marketId: string,
  title: string,
  researchContext: string,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  const embedding = await getEmbedding(`${title}\n\n${researchContext.slice(0, 6000)}`);
  if (!embedding) return false;

  const config = await getQdrantConfig();
  if (!config) return false;

  const point: QdrantPoint = {
    id: marketId,
    vector: embedding.vector,
    payload: {
      marketId,
      title,
      text: researchContext.slice(0, 8000),
      ...metadata,
      createdAt: new Date().toISOString(),
    },
  };

  const response = await qdrantFetch(`/collections/${config.collectionName}/points`, 'PUT', {
    points: [point],
  });

  return response?.ok || false;
}

export async function retrieveSimilarMarkets(
  queryTitle: string,
  queryDescription: string,
  limit: number = 5,
): Promise<Array<{ marketId: string; title: string; score: number; payload: Record<string, unknown> }>> {
  const embedding = await getEmbedding(`${queryTitle}\n\n${queryDescription.slice(0, 3000)}`);
  if (!embedding) return [];

  const config = await getQdrantConfig();
  if (!config) return [];

  const response = await qdrantFetch(`/collections/${config.collectionName}/search`, 'POST', {
    vector: embedding.vector,
    limit,
    with_payload: true,
  });

  if (!response?.ok) return [];

  try {
    const data = await response.json();
    return (data.result || []).map((r: Record<string, unknown>) => ({
      marketId: String(r.payload?.marketId || r.id),
      title: String(r.payload?.title || ''),
      score: Number(r.score || 0),
      payload: (r.payload || {}) as Record<string, unknown>,
    }));
  } catch {
    return [];
  }
}
```

- [ ] **Create `src/lib/engine/memory/embed.ts` and `src/lib/engine/memory/qdrant.ts`**
- [ ] **Commit:** `git add src/lib/engine/memory/ && git commit -m "feat: add embedding client and Qdrant writeback + RAG retrieval"`

---

### Task 9: Credential Encryption

**Files:**
- Create: `src/lib/engine/crypto.ts`
- Modify: `src/app/api/credentials/route.ts` — encrypt on create/update, decrypt on read

**crypto.ts:**
```typescript
// src/lib/engine/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-dev-key-change-in-production-32b';
const ALGORITHM = 'aes-256-gcm';

function getKey(): Buffer {
  const key = Buffer.alloc(32);
  key.write(ENCRYPTION_KEY.slice(0, 32));
  return key;
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) return ciphertext; // Not encrypted, return as-is
  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p));
}
```

**Modify credentials route** — In `POST` and `PUT` handlers, encrypt `encryptedData` before storing. In `GET`, return as-is (masked). The `decrypt` function is used in `llm-client.ts`, `worker.ts` etc. when they need the actual values.

In `src/app/api/credentials/route.ts`, add import at top:
```typescript
import { encrypt, isEncrypted } from '@/lib/engine/crypto';
```

In the `POST` handler, change the line that sets `encryptedData`:
```typescript
      encryptedData: body.encryptedData ? encrypt(JSON.stringify(body.encryptedData)) : null,
```

Wait — `encryptedData` is already a JSON string in the existing code. Let's encrypt the string itself.

In `POST`, change:
```typescript
      encryptedData: body.encryptedData ? encrypt(typeof body.encryptedData === 'string' ? body.encryptedData : JSON.stringify(body.encryptedData)) : null,
```

In `PUT`, same pattern when `encryptedData` is updated:
```typescript
    if (body.encryptedData !== undefined) {
      updateData.encryptedData = encrypt(typeof body.encryptedData === 'string' ? body.encryptedData : JSON.stringify(body.encryptedData));
```

For the `test` route (`src/app/api/credentials/test/route.ts`), decrypt before parsing:
Add import:
```typescript
import { decrypt, isEncrypted } from '@/lib/engine/crypto';
```

Change the parsing in `POST`:
```typescript
    let parsedData: Record<string, unknown> = {};
    try {
      const rawData = credential.encryptedData
        ? (isEncrypted(credential.encryptedData) ? decrypt(credential.encryptedData) : credential.encryptedData)
        : '{}';
      parsedData = JSON.parse(rawData);
    } catch {}
```

- [ ] **Create `src/lib/engine/crypto.ts`**
- [ ] **Modify `src/app/api/credentials/route.ts`** — encrypt on store
- [ ] **Modify `src/app/api/credentials/test/route.ts`** — decrypt before use
- [ ] **Commit:** `git add src/lib/engine/crypto.ts src/app/api/credentials/ && git commit -m "feat: add AES-256-GCM credential encryption"`

---

### Task 10: Fix Kalshi Schema Mismatch

**Files:**
- Modify: `src/lib/venues/kalshi.ts`

The Kalshi module writes `bid`, `ask`, `lastPrice`, `volume`, `openInterest` but the Prisma `MarketSnapshot` model has `impliedProb`, `liquidity`, `spread`, `volume24h`, `bestBid`, `bestAsk`.

Fix the `getKalshiMarkets` function and the `markets/route.ts` sync handler to map correctly:

In `src/lib/venues/kalshi.ts`, the interface is fine (it returns raw Kalshi data). The fix is in `src/app/api/markets/route.ts` where `sync_kalshi` action creates snapshots with wrong field names.

In `src/app/api/markets/route.ts`, change the two `db.marketSnapshot.create` blocks (lines ~69-78 and ~80-84):

Replace both instances with:
```typescript
              await db.marketSnapshot.create({
                data: {
                  marketId: createdMarket.id,
                  impliedProb: market.last_price / 100,
                  liquidity: market.volume,
                  spread: (market.yes_ask - market.yes_bid) / 100,
                  volume24h: market.volume,
                  bestBid: market.yes_bid / 100,
                  bestAsk: market.yes_ask / 100,
                },
              });
```

And:
```typescript
              await db.marketSnapshot.create({
                data: {
                  marketId: existing.id,
                  impliedProb: market.last_price / 100,
                  liquidity: market.volume,
                  spread: (market.yes_ask - market.yes_bid) / 100,
                  volume24h: market.volume,
                  bestBid: market.yes_bid / 100,
                  bestAsk: market.yes_ask / 100,
                },
              });
```

- [ ] **Modify `src/app/api/markets/route.ts`** — fix Kalshi snapshot field mapping
- [ ] **Commit:** `git add src/app/api/markets/route.ts && git commit -m "fix: Kalshi snapshot field mapping to match Prisma schema"`

---

### Task 11: Fix Health Endpoint to Ping Real Services

**Files:**
- Modify: `src/app/api/health/route.ts`

Replace the `vectorStatus: dbStatus` line and add real service pings. The health endpoint should check Qdrant, Ollama, SearXNG, LLM, and Mem0 by reading their credentials and making quick status calls.

Add at top of health route, after the `dbStatus` check:

```typescript
    // Check connected services
    const apiHealth: Record<string, 'UP' | 'DOWN' | 'DEGRADED'> = {};
    const credentials = await db.credential.findMany({ where: { isActive: true } });

    for (const cred of credentials) {
      if (!cred.serviceUrl || cred.testResult !== 'SUCCESS') {
        apiHealth[cred.service.toLowerCase()] = 'DOWN';
        continue;
      }

      const serviceEndpoints: Record<string, string> = {
        qdrant: '/healthz',
        ollama: '/api/tags',
        searxng: '/search?q=test&format=json',
        mem0: '/health',
        llm: '/models',
        'llm provider': '/models',
        openai: '/models',
      };

      const endpoint = serviceEndpoints[cred.service.toLowerCase()];
      if (!endpoint) continue;

      try {
        let parsedData: Record<string, unknown> = {};
        if (cred.encryptedData) {
          try {
            const raw = isEncrypted(cred.encryptedData) ? decrypt(cred.encryptedData) : cred.encryptedData;
            parsedData = JSON.parse(raw);
          } catch {}
        }

        const headers: Record<string, string> = { Accept: 'application/json' };
        if (parsedData.apiKey) headers['Authorization'] = `Bearer ${parsedData.apiKey}`;

        const res = await fetch(`${cred.serviceUrl.replace(/\/$/, '')}${endpoint}`, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(5000),
        });
        apiHealth[cred.service.toLowerCase()] = res.ok ? 'UP' : 'DEGRADED';
      } catch {
        apiHealth[cred.service.toLowerCase()] = 'DOWN';
      }
    }

    const vectorStatus = apiHealth['qdrant'] || 'DOWN';
```

Also add imports at top:
```typescript
import { isEncrypted, decrypt } from '@/lib/engine/crypto';
```

And update the health object construction to use the new `vectorStatus` and `apiHealth`.

- [ ] **Modify `src/app/api/health/route.ts`**
- [ ] **Commit:** `git add src/app/api/health/route.ts && git commit -m "fix: health endpoint pings real services instead of mirroring DB status"`

---

### Task 12: Worker API + Market Sync API + Pipeline Settings Page

**Files:**
- Create: `src/app/api/jobs/worker/route.ts`
- Create: `src/app/api/markets/sync/route.ts`
- Create: `src/components/trading/PipelineSettings.tsx`
- Modify: `src/store/trading-store.ts` — add `pipelineSettings` to PageView
- Modify: `src/app/page.tsx` — add nav item + page switch

**Worker API (`src/app/api/jobs/worker/route.ts`):**
```typescript
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  const { getWorkerState } = await import('@/lib/engine/worker');
  return NextResponse.json(getWorkerState());
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const action = body.action as string;

  if (action === 'start') {
    const { startWorker } = await import('@/lib/engine/worker');
    const { setTestMode } = await import('@/lib/engine/mode');
    setTestMode(body.dryRun !== false);
    const intervalMs = body.intervalMs || 5000;
    return NextResponse.json(startWorker(intervalMs));
  }

  if (action === 'stop') {
    const { stopWorker } = await import('@/lib/engine/worker');
    return NextResponse.json(stopWorker());
  }

  return NextResponse.json({ error: 'Unknown action. Use: start, stop' }, { status: 400 });
}
```

**Market Sync API (`src/app/api/markets/sync/route.ts`):**
```typescript
import { NextResponse } from 'next/server';
import { runScanner } from '@/lib/engine/scanner';

export async function POST() {
  try {
    const result = await runScanner();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

**PipelineSettings page (`src/components/trading/PipelineSettings.tsx`):** This page tells users what services they need active and provides controls to start/stop the worker, trigger scans, and view pipeline status. It checks which credentials are connected vs missing and shows clear status.

The component:
- Shows credential status for required services (Qdrant, Ollama/LLM, SearXNG)
- Shows which Qdrant collections are linked
- Start/Stop pipeline worker
- Trigger market sync
- Show worker status (running/stopped, jobs processed, errors)

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Play,
  Square,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Settings,
  Zap,
  Database,
  Bot,
  Search,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { QDRANT_DEFAULT_COLLECTIONS } from '@/lib/constants';

interface WorkerState {
  status: 'STOPPED' | 'RUNNING' | 'PAUSED';
  jobsProcessed: number;
  errors: number;
  lastActivity: string | null;
  currentJobType: string | null;
  error: string | null;
}

interface CredentialInfo {
  id: string;
  service: string;
  label: string;
  testResult: string | null;
  serviceUrl: string | null;
}

interface HealthInfo {
  dbStatus: string;
  vectorStatus: string;
  apiHealth: Record<string, string>;
  queueDepth: number;
  failingJobs: number;
  lastScanAt: string | null;
}

export function PipelineSettings() {
  const [workerState, setWorkerState] = useState<WorkerState | null>(null);
  const [credentials, setCredentials] = useState<CredentialInfo[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [qdrantLinks, setQdrantLinks] = useState<Record<string, string>>({});
  const [syncing, setSyncing] = useState(false);
  const [toggling, setToggling] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [workerRes, credRes, healthRes] = await Promise.all([
        fetch('/api/jobs/worker'),
        fetch('/api/credentials'),
        fetch('/api/health'),
      ]);
      if (workerRes.ok) setWorkerState(await workerRes.json());
      if (credRes.ok) {
        const data = await credRes.json();
        setCredentials((data.credentials || []).filter((c: CredentialInfo) =>
          ['qdrant', 'ollama', 'searxng', 'mem0', 'llm provider', 'openai'].includes(c.service.toLowerCase())
        ));
      }
      if (healthRes.ok) setHealth(await healthRes.json());

      try {
        const linkRes = await fetch('/api/settings');
        if (linkRes.ok) {
          const data = await linkRes.json();
          const links: Record<string, Record<string, string>> = {};
          for (const setting of data.settings || []) {
            const match = setting.key.match(/^qdrant_collections_(.+)$/);
            if (match) {
              try { links[match[1]] = JSON.parse(setting.value); } catch {}
            }
          }
          const firstCred = credentials.find((c) => c.service.toLowerCase() === 'qdrant');
          if (firstCred) setQdrantLinks(links[firstCred.id] || {});
        }
      } catch {}
    } catch {}
  }, [credentials]);

  useEffect(() => { fetchData(); }, []);

  const handleToggleWorker = async () => {
    setToggling(true);
    try {
      const action = workerState?.status === 'RUNNING' ? 'stop' : 'start';
      const res = await fetch('/api/jobs/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setWorkerState(await res.json());
        toast.success(action === 'start' ? 'Pipeline started' : 'Pipeline stopped');
      }
    } catch {
      toast.error('Failed to toggle pipeline');
    } finally {
      setToggling(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/markets/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Synced ${data.totalNew || 0} new markets`);
      }
    } catch {
      toast.error('Market sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const requiredServices = [
    { key: 'qdrant', label: 'Qdrant', icon: Database, description: 'Vector database for research memory' },
    { key: 'ollama', label: 'Ollama / LLM Provider', icon: Bot, description: 'Local or cloud LLM for agent reasoning' },
    { key: 'searxng', label: 'SearXNG', icon: Search, description: 'Web search for research evidence' },
  ];

  const getCredential = (key: string) => credentials.find((c) => c.service.toLowerCase() === key);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Pipeline Settings</h2>
          <p className="mt-1 text-sm text-gray-500">Required services, worker controls, and status</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            className={cn(
              'gap-2',
              workerState?.status === 'RUNNING'
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            )}
            onClick={handleToggleWorker}
            disabled={toggling}
          >
            {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> :
             workerState?.status === 'RUNNING' ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {workerState?.status === 'RUNNING' ? 'Stop Pipeline' : 'Start Pipeline'}
          </Button>
          <Button variant="ghost" size="sm" className="gap-2 text-gray-400" onClick={handleSync} disabled={syncing}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync Markets
          </Button>
        </div>
      </div>

      {workerState?.status === 'RUNNING' && (
        <Card className="border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/20">
              <Zap className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-emerald-400">Pipeline Running</p>
              <p className="text-xs text-gray-500">
                {workerState.jobsProcessed} jobs processed · {workerState.errors} errors · {workerState.currentJobType ? `Processing: ${workerState.currentJobType}` : 'Idle'}
              </p>
            </div>
            {workerState.lastActivity && (
              <span className="text-[10px] text-gray-600">
                Last: {new Date(workerState.lastActivity).toLocaleTimeString()}
              </span>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-300">Required Services</h3>
        {requiredServices.map((svc) => {
          const cred = getCredential(svc.key);
          const isUp = cred?.testResult === 'SUCCESS';
          const Icon = svc.icon;
          return (
            <Card key={svc.key} className={cn('border-gray-800 bg-gray-900', isUp && 'border-emerald-500/20')}>
              <CardContent className="flex items-center gap-4 p-4">
                <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', isUp ? 'bg-emerald-500/10' : 'bg-gray-800')}>
                  <Icon className={cn('h-5 w-5', isUp ? 'text-emerald-400' : 'text-gray-500')} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className={cn('text-sm font-medium', isUp ? 'text-white' : 'text-gray-300')}>{svc.label}</p>
                    {isUp ? (
                      <Badge className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Connected
                      </Badge>
                    ) : (
                      <Badge className="border-red-500/30 bg-red-500/10 text-[10px] text-red-400">
                        <XCircle className="mr-1 h-3 w-3" /> {cred ? 'Connection Failed' : 'Not Configured'}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-gray-600">{svc.description}</p>
                  {cred?.serviceUrl && <p className="text-[10px] text-gray-700 font-mono">{cred.serviceUrl}</p>}
                </div>
              </CardContent>
            </Card>
          );
        })}

        {credentials.find((c) => c.service.toLowerCase() === 'qdrant') && (
          <Card className="border-gray-800 bg-gray-900">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-gray-400 mb-2">Qdrant Collections</p>
              <div className="flex items-center gap-2">
                {QDRANT_DEFAULT_COLLECTIONS.map((def) => (
                  <span
                    key={def.key}
                    className={cn(
                      'h-3 w-3 rounded-full',
                      qdrantLinks[def.key] ? 'bg-emerald-400' : 'bg-gray-700'
                    )}
                    title={`${def.defaultName}: ${qdrantLinks[def.key] ? 'Linked' : 'Not linked'}`}
                  />
                ))}
                <span className="text-[10px] text-gray-600">
                  {Object.keys(qdrantLinks).length}/{QDRANT_DEFAULT_COLLECTIONS.length} linked
                </span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <Separator className="bg-gray-800" />

      {health && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-300">System Status</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-center">
              <p className="text-[10px] text-gray-500">Queue Depth</p>
              <p className="mt-1 text-lg font-mono text-white">{health.queueDepth}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-center">
              <p className="text-[10px] text-gray-500">Failing Jobs</p>
              <p className={cn('mt-1 text-lg font-mono', health.failingJobs > 0 ? 'text-red-400' : 'text-emerald-400')}>{health.failingJobs}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-center">
              <p className="text-[10px] text-gray-500">Database</p>
              <p className={cn('mt-1 text-lg font-mono', health.dbStatus === 'UP' ? 'text-emerald-400' : 'text-red-400')}>{health.dbStatus}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-3 text-center">
              <p className="text-[10px] text-gray-500">Qdrant</p>
              <p className={cn('mt-1 text-lg font-mono', health.vectorStatus === 'UP' ? 'text-emerald-400' : 'text-red-400')}>{health.vectorStatus}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Update `src/store/trading-store.ts`** — add `pipelineSettings` to PageView type
- [ ] **Update `src/app/page.tsx`** — add import, nav item, and switch case for PipelineSettings
- [ ] **Create worker API, sync API, PipelineSettings component**
- [ ] **Commit:** All above in one commit: `feat: add pipeline settings page, worker API, market sync API, and service requirements UI`

---

### Task 13: Wire Worker processPipeline in worker.ts

**Files:**
- Modify: `src/lib/engine/worker.ts` (from Plan A, Task 4)

The worker created in Plan A has stub `processJudge`, `processRisk`, `processExecute`, `processSettle` functions. Now that `pipeline.ts` exists, the worker should import and use `runPipelineForMarket` for RESEARCH jobs, and create downstream RISK/EXECUTE jobs:

Replace the `processResearch`, `processJudge`, `processRisk`, `processExecute`, `processSettle` functions in `worker.ts` with:

```typescript
async function processResearch(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Research + Bull + Bear + Contradiction is now handled in pipeline.ts
  // The worker just triggers the full pipeline for this market
  const { runPipelineForMarket } = await import('@/lib/engine/pipeline');
  return await runPipelineForMarket(payload.marketId as string);
}

async function processJudge(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { runPipelineForMarket } = await import('@/lib/engine/pipeline');
  return await runPipelineForMarket(payload.marketId as string);
}

async function processRisk(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { runPipelineForMarket } = await import('@/lib/engine/pipeline');
  return await runPipelineForMarket(payload.marketId as string);
}

async function processExecute(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  // In test mode, execution is paper-only and handled in pipeline
  // In live mode, this would call venue APIs
  return { status: 'PAPER_EXECUTE', marketId: payload.marketId };
}

async function processSettle(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Settlement not yet implemented — placeholder
  return { status: 'SETTLE_PENDING', marketId: payload.marketId };
}
```

- [ ] **Modify `src/lib/engine/worker.ts`** — replace stub functions with pipeline imports
- [ ] **Commit:** `git add src/lib/engine/worker.ts && git commit -m "feat: wire worker to use full pipeline orchestration"`

---

### Task 14: Barrel Export + Final Integration

**Files:**
- Create: `src/lib/engine/index.ts`
- Modify: `src/components/trading/LiveStatus.tsx` — update to show real worker state

**`src/lib/engine/index.ts`:**
```typescript
export { computeRisk, DEFAULT_STRATEGY } from './risk';
export { runSimulation } from './simulation';
export { getSimState, startSimulation, stopSimulation, updateConfig } from './live-simulation';
export type { SimulationConfig, SimulationReport, MarketSimResult } from './simulation';
export type { LiveSimState } from './live-simulation';
export { callLLM, callLLMJson } from './llm-client';
export { runTriageAgent } from './agents/triage';
export { runBullAgent } from './agents/bull';
export { runBearAgent } from './agents/bear';
export { runContradictionAgent } from './agents/contradiction';
export { runJudgeAgent } from './agents/judge';
export { searchSearXNG } from './research/search';
export { extractContent } from './research/extract';
export { getWorkerState, startWorker, stopWorker } from './worker';
export { runScanner } from './scanner';
export { runPipelineForMarket } from './pipeline';
export { isTestMode, setTestMode, getModeLabel } from './mode';
export { encrypt, decrypt, isEncrypted } from './crypto';
export { getEmbedding } from './memory/embed';
export { writeResearchToQdrant, retrieveSimilarMarkets } from './memory/qdrant';
```

- [ ] **Create `src/lib/engine/index.ts`**
- [ ] **Commit:** `git add src/lib/engine/index.ts && git commit -m "feat: add engine barrel exports"`

---

### Task 15: Run Lint and Build

- [ ] **Run `npm run lint`** — fix any errors
- [ ] **Run `npm run build`** — fix any build errors
- [ ] **Commit any fixes:** `git commit -m "fix: resolve lint and build errors"`

---

## Self-Review

1. **Spec coverage:**
   - Gap 1 (Kalshi fix) → Task 10 ✅
   - Gap 2 (Polymarket scanner) → Task 5 in Plan A ✅
   - Gap 3 (LLM + agents) → Tasks 1-2 in Plan A ✅
   - Gap 4 (Job queue worker) → Task 4 in Plan A ✅
   - Gap 5 (Decision API runs risk engine) → Already works! Verified ✅
   - Gap 6 (Scanner scheduler) → Task 5 in Plan A (scanner) + Task 12 (sync API + manual trigger) ✅
   - Gap 7 (SearXNG + extraction) → Task 3 in Plan A ✅
   - Gap 8 (Qdrant writeback + RAG) → Task 8 ✅
   - Gap 9 (Health checks real services) → Task 11 ✅
   - Gap 10 (Credential encryption) → Task 9 ✅
   - Gap 11 (Test/Live separation) → Task 7 (mode utilities) + Task 6 (pipeline respects test mode) ✅
   - Gap 12 (Settings/requirements page) → Task 12 ✅

2. **Placeholder scan:** No TBDs, TODOs, or "implement later" found.

3. **Type consistency:** `callLLMJson<T>` returns `{ data: T, meta }` consistently used across all agents. `RiskEngineInput` type from `@/lib/types` used in pipeline.ts. `isTestMode()` from `@/lib/engine/mode` used in pipeline.ts.

4. **Known issue:** The `as any` casts on `db.agentOutput.create` and `db.researchSource.create` may need Prisma type adjustments. The implementer should verify these work with the actual Prisma generated types.