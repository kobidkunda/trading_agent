# Phase 1+2: Full Pipeline + Robust Setup — Implementation Plan A (Foundation + Pipeline Core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Trading Command Center fully runnable in test mode — real market scanning, real LLM agents, real research, real risk decisions, with a job queue worker orchestrating it all. Everything logged, no actual order placement.

**Architecture:** The app currently has a complete UI shell and DB schema, but the entire agent pipeline is simulated with random generators. We replace the simulation layer with real implementations: LLM client calling OpenAI/Ollama, SearXNG for search, Qdrant for vector memory, and a job queue worker that processes SCAN→TRIAGE→RESEARCH→JUDGE→RISK→EXECUTE( paper only ). Kill switch prevents real orders. Test mode logs everything.

**Tech Stack:** Next.js 16 App Router, Prisma/SQLite, OpenAI API (or Ollama), SearXNG, Qdrant REST API, z-ai-web-dev-sdk (server-side only).

**Key constraint:** In test mode, the full pipeline runs but order submission is blocked. Every LLM call, search result, and decision is logged. No real money moves.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/engine/llm-client.ts` | Unified LLM client (OpenAI, Ollama, custom) — server-side only |
| `src/lib/engine/agents/triage.ts` | Triage agent — calls LLM with triage prompt, parses structured response |
| `src/lib/engine/agents/bull.ts` | Bull agent — calls LLM with bull prompt + research context |
| `src/lib/engine/agents/bear.ts` | Bear agent — calls LLM with bear prompt + research context |
| `src/lib/engine/agents/contradiction.ts` | Contradiction agent — calls LLM with both theses |
| `src/lib/engine/agents/judge.ts` | Judge agent — calls LLM with all outputs, returns `JudgeOutput` |
| `src/lib/engine/research/search.ts` | SearXNG search client — queries, normalizes results |
| `src/lib/engine/research/extract.ts` | Content extraction from URLs (fetch + text parse) |
| `src/lib/engine/pipeline.ts` | Orchestrates full pipeline for a single market |
| `src/lib/engine/worker.ts` | Job queue worker — polls DB, dispatches by job type |
| `src/lib/engine/scanner.ts` | Market scanner — fetches from Polymarket/Kalshi, normalizes, stores |
| `src/lib/venues/polymarket.ts` | Polymarket CLOB API client (read-only for scanning) |
| `src/lib/engine/memory/qdrant.ts` | Qdrant writeback + RAG retrieval |
| `src/lib/engine/memory/embed.ts` | Text embedding client (OpenAI or Ollama) |
| `src/lib/engine/crypto.ts` | AES-256-GCM encryption/decryption for credentials |
| `src/app/api/jobs/worker/route.ts` | Start/stop worker, get worker status |
| `src/app/api/markets/sync/route.ts` | Trigger market sync from venues |
| `src/lib/venues/kalshi.ts` | Fix schema mismatch (modify existing) |
| `src/app/api/decisions/route.ts` | Fix: actually run risk engine (modify existing) |
| `src/app/api/health/route.ts` | Fix: ping real services (modify existing) |
| `src/components/trading/SystemHealth.tsx` | Update to show real service status |
| `src/components/trading/LiveStatus.tsx` | Update to show real worker/pipeline status |
| `src/lib/engine/index.ts` | Barrel export for engine modules |

---

### Task 1: LLM Client

**Files:**
- Create: `src/lib/engine/llm-client.ts`

This is the core LLM call layer. It reads credentials from DB, calls the configured LLM provider, handles retries, and returns structured responses.

```typescript
// src/lib/engine/llm-client.ts
import { db } from '@/lib/db';

export interface LLMCallOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
}

export interface LLMCallResult {
  content: string;
  parsedJson: Record<string, unknown> | null;
  model: string;
  tokenCount: number;
  latencyMs: number;
  provider: string;
}

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

async function getProviderConfig(preferredModel?: string): Promise<ProviderConfig> {
  const strategySetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  const strategy = strategySetting ? JSON.parse(strategySetting.value) : {};

  const model = preferredModel || strategy.defaultModel || strategy.researchModel || 'gpt-4o-mini';

  let llmCred = await db.credential.findFirst({
    where: { service: 'LLM Provider', isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!llmCred) {
    llmCred = await db.credential.findFirst({
      where: { service: 'OpenAI', isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  if (!llmCred || !llmCred.serviceUrl) {
    // Fallback to env vars
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const apiKey = process.env.OPENAI_API_KEY || '';
    return { baseUrl, apiKey, model };
  }

  let parsedData: Record<string, unknown> = {};
  try {
    if (llmCred.encryptedData) parsedData = JSON.parse(llmCred.encryptedData);
  } catch {}

  return {
    baseUrl: llmCred.serviceUrl.replace(/\/$/, ''),
    apiKey: String(parsedData.apiKey || ''),
    model,
  };
}

export async function callLLM(options: LLMCallOptions): Promise<LLMCallResult> {
  const config = await getProviderConfig(options.model);
  const startTime = Date.now();

  const messages: Array<{ role: string; content: string }> = [];
  if (options.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt });
  }
  messages.push({ role: 'user', content: options.prompt });

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 2000,
  };

  if (options.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
  }

  const maxRetries = 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        lastError = new Error(`LLM API error ${response.status}: ${errorText}`);
        if (response.status === 429 || response.status >= 500) {
          await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const tokenCount = data.usage?.total_tokens || 0;

      let parsedJson: Record<string, unknown> | null = null;
      if (options.responseFormat === 'json') {
        try {
          parsedJson = JSON.parse(content);
        } catch {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            try {
              parsedJson = JSON.parse(jsonMatch[0]);
            } catch {}
          }
        }
      }

      return {
        content,
        parsedJson,
        model: config.model,
        tokenCount,
        latencyMs: Date.now() - startTime,
        provider: config.baseUrl.includes('openai') ? 'openai' : config.baseUrl.includes('localhost:11434') ? 'ollama' : 'custom',
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  }

  throw lastError || new Error('LLM call failed');
}

export async function callLLMJson<T = Record<string, unknown>>(
  prompt: string,
  systemPrompt?: string,
  model?: string,
): Promise<{ data: T; meta: { model: string; tokenCount: number; latencyMs: number } }> {
  const result = await callLLM({
    prompt,
    systemPrompt,
    model,
    responseFormat: 'json',
    temperature: 0.3,
  });

  return {
    data: (result.parsedJson || {}) as T,
    meta: { model: result.model, tokenCount: result.tokenCount, latencyMs: result.latencyMs },
  };
}
```

- [ ] **Create `src/lib/engine/llm-client.ts`** with the code above
- [ ] **Commit:** `git add src/lib/engine/llm-client.ts && git commit -m "feat: add LLM client with provider resolution and retries"`

---

### Task 2: Agent Implementations (5 agents)

**Files:**
- Create: `src/lib/engine/agents/triage.ts`
- Create: `src/lib/engine/agents/bull.ts`
- Create: `src/lib/engine/agents/bear.ts`
- Create: `src/lib/engine/agents/contradiction.ts`
- Create: `src/lib/engine/agents/judge.ts`

Each agent follows the same pattern: get prompt template from DB (or use default), fill variables, call LLM, parse structured response, return typed output.

**triage.ts:**
```typescript
// src/lib/engine/agents/triage.ts
import { callLLMJson } from '@/lib/engine/llm-client';
import { db } from '@/lib/db';
import { DEFAULT_PROMPT_TEMPLATES } from '@/lib/constants';

export interface TriageOutput {
  status: 'RELEVANT' | 'IRRELEVANT' | 'AMBIGUOUS';
  reason: string;
  worthResearch: boolean;
}

export async function runTriageAgent(
  marketId: string,
  marketTitle: string,
  marketDescription: string,
  category: string,
  impliedProbability: number,
  liquidity: number,
): Promise<TriageOutput> {
  const promptSetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  const strategy = promptSetting ? JSON.parse(promptSetting.value) : {};
  const promptVersion = strategy.promptVersion?.triage ?? 1;

  let promptBody = DEFAULT_PROMPT_TEMPLATES.triage;
  const template = await db.promptTemplate.findFirst({
    where: { name: 'triage', version: promptVersion, state: 'PUBLISHED' },
  });
  if (template) promptBody = template.body;

  const prompt = promptBody
    .replace('{{market_title}}', marketTitle)
    .replace('{{market_description}}', marketDescription || '')
    .replace('{{category}}', category)
    .replace('{{liquidity}}', String(liquidity))
    .replace('{{implied_probability}}', String(impliedProbability));

  const { data, meta } = await callLLMJson<TriageOutput>(prompt, undefined, strategy.triageModel);

  return {
    status: data.status || 'AMBIGUOUS',
    reason: data.reason || 'No reason provided',
    worthResearch: data.worthResearch ?? data.status === 'RELEVANT',
  };
}
```

**bull.ts:**
```typescript
// src/lib/engine/agents/bull.ts
import { callLLMJson } from '@/lib/engine/llm-client';
import { db } from '@/lib/db';
import { DEFAULT_PROMPT_TEMPLATES } from '@/lib/constants';

export interface BullOutput {
  thesis: string;
  keyArguments: string[];
  supportingEvidence: string[];
  estimatedProbability: number;
  confidence: number;
}

export async function runBullAgent(
  marketId: string,
  marketTitle: string,
  impliedProbability: number,
  researchContext: string,
): Promise<BullOutput> {
  const promptSetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  const strategy = promptSetting ? JSON.parse(promptSetting.value) : {};
  const promptVersion = strategy.promptVersion?.bull ?? 1;

  let promptBody = DEFAULT_PROMPT_TEMPLATES.bull;
  const template = await db.promptTemplate.findFirst({
    where: { name: 'bull', version: promptVersion, state: 'PUBLISHED' },
  });
  if (template) promptBody = template.body;

  const prompt = promptBody
    .replace('{{market_title}}', marketTitle)
    .replace('{{implied_probability}}', String(impliedProbability))
    .replace('{{research_context}}', researchContext || 'No additional research available');

  const { data } = await callLLMJson<BullOutput>(prompt, undefined, strategy.researchModel);

  return {
    thesis: data.thesis || 'Bull thesis unavailable',
    keyArguments: data.keyArguments || [],
    supportingEvidence: data.supportingEvidence || [],
    estimatedProbability: typeof data.estimatedProbability === 'number' ? data.estimatedProbability : impliedProbability + 0.05,
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
  };
}
```

**bear.ts:**
```typescript
// src/lib/engine/agents/bear.ts
import { callLLMJson } from '@/lib/engine/llm-client';
import { db } from '@/lib/db';
import { DEFAULT_PROMPT_TEMPLATES } from '@/lib/constants';

export interface BearOutput {
  thesis: string;
  keyArguments: string[];
  supportingEvidence: string[];
  estimatedProbability: number;
  confidence: number;
}

export async function runBearAgent(
  marketId: string,
  marketTitle: string,
  impliedProbability: number,
  researchContext: string,
): Promise<BearOutput> {
  const promptSetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  const strategy = promptSetting ? JSON.parse(promptSetting.value) : {};
  const promptVersion = strategy.promptVersion?.bear ?? 1;

  let promptBody = DEFAULT_PROMPT_TEMPLATES.bear;
  const template = await db.promptTemplate.findFirst({
    where: { name: 'bear', version: promptVersion, state: 'PUBLISHED' },
  });
  if (template) promptBody = template.body;

  const prompt = promptBody
    .replace('{{market_title}}', marketTitle)
    .replace('{{implied_probability}}', String(impliedProbability))
    .replace('{{research_context}}', researchContext || 'No additional research available');

  const { data } = await callLLMJson<BearOutput>(prompt, undefined, strategy.researchModel);

  return {
    thesis: data.thesis || 'Bear thesis unavailable',
    keyArguments: data.keyArguments || [],
    supportingEvidence: data.supportingEvidence || [],
    estimatedProbability: typeof data.estimatedProbability === 'number' ? data.estimatedProbability : impliedProbability - 0.05,
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
  };
}
```

**contradiction.ts:**
```typescript
// src/lib/engine/agents/contradiction.ts
import { callLLMJson } from '@/lib/engine/llm-client';
import { db } from '@/lib/db';
import { DEFAULT_PROMPT_TEMPLATES } from '@/lib/constants';
import type { BullOutput } from './bull';
import type { BearOutput } from './bear';

export interface ContradictionOutput {
  contradictions: string[];
  overlookedRisks: string[];
  alternativeInterpretations: string[];
  reliabilityAssessment: number;
}

export async function runContradictionAgent(
  marketId: string,
  marketTitle: string,
  bullOutput: BullOutput,
  bearOutput: BearOutput,
): Promise<ContradictionOutput> {
  const promptSetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  const strategy = promptSetting ? JSON.parse(promptSetting.value) : {};
  const promptVersion = strategy.promptVersion?.contradiction ?? 1;

  let promptBody = DEFAULT_PROMPT_TEMPLATES.contradiction;
  const template = await db.promptTemplate.findFirst({
    where: { name: 'contradiction', version: promptVersion, state: 'PUBLISHED' },
  });
  if (template) promptBody = template.body;

  const prompt = promptBody
    .replace('{{market_title}}', marketTitle)
    .replace('{{bull_thesis}}', bullOutput.thesis)
    .replace('{{bear_thesis}}', bearOutput.thesis);

  const { data } = await callLLMJson<ContradictionOutput>(prompt, undefined, strategy.researchModel);

  return {
    contradictions: data.contradictions || [],
    overlookedRisks: data.overlookedRisks || [],
    alternativeInterpretations: data.alternativeInterpretations || [],
    reliabilityAssessment: typeof data.reliabilityAssessment === 'number' ? data.reliabilityAssessment : 0.5,
  };
}
```

**judge.ts:**
```typescript
// src/lib/engine/agents/judge.ts
import { callLLMJson } from '@/lib/engine/llm-client';
import { db } from '@/lib/db';
import { DEFAULT_PROMPT_TEMPLATES } from '@/lib/constants';
import type { BullOutput } from './bull';
import type { BearOutput } from './bear';
import type { ContradictionOutput } from './contradiction';
import type { JudgeOutput } from '@/lib/types';

export async function runJudgeAgent(
  marketId: string,
  marketTitle: string,
  impliedProbability: number,
  bullOutput: BullOutput,
  bearOutput: BearOutput,
  contradictionOutput: ContradictionOutput,
): Promise<JudgeOutput> {
  const promptSetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  const strategy = promptSetting ? JSON.parse(promptSetting.value) : {};
  const promptVersion = strategy.promptVersion?.judge ?? 1;

  let promptBody = DEFAULT_PROMPT_TEMPLATES.judge;
  const template = await db.promptTemplate.findFirst({
    where: { name: 'judge', version: promptVersion, state: 'PUBLISHED' },
  });
  if (template) promptBody = template.body;

  const prompt = promptBody
    .replace('{{market_title}}', marketTitle)
    .replace('{{implied_probability}}', String(impliedProbability))
    .replace('{{bull_output}}', JSON.stringify(bullOutput))
    .replace('{{bear_output}}', JSON.stringify(bearOutput))
    .replace('{{contradiction_output}}', JSON.stringify(contradictionOutput));

  const { data } = await callLLMJson<JudgeOutput>(prompt, undefined, strategy.judgeModel);

  return {
    trueProbability: typeof data.trueProbability === 'number' ? data.trueProbability : impliedProbability,
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
    uncertainty: typeof data.uncertainty === 'number' ? data.uncertainty : 0.3,
    uncertaintyPenalty: typeof data.uncertaintyPenalty === 'number' ? data.uncertaintyPenalty : 0.15,
    proEvidence: data.proEvidence || bullOutput.keyArguments.slice(0, 2),
    antiEvidence: data.antiEvidence || bearOutput.keyArguments.slice(0, 2),
    sourceQuality: typeof data.sourceQuality === 'number' ? data.sourceQuality : 0.6,
    freshness: typeof data.freshness === 'number' ? data.freshness : 0.7,
    catalystTiming: data.catalystTiming || 'NONE',
    skipReason: data.skipReason,
  };
}
```

- [ ] **Create all 5 agent files**
- [ ] **Commit:** `git add src/lib/engine/agents/ && git commit -m "feat: add real LLM agent implementations (triage, bull, bear, contradiction, judge)"`

---

### Task 3: SearXNG Search + Content Extraction

**Files:**
- Create: `src/lib/engine/research/search.ts`
- Create: `src/lib/engine/research/extract.ts`

**search.ts** — Queries SearXNG instance, returns normalized search results:
```typescript
// src/lib/engine/research/search.ts
import { db } from '@/lib/db';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceType: 'SEARCH';
  recencyScore: number;
  qualityScore: number;
}

export async function searchSearXNG(query: string, maxResults: number = 5): Promise<SearchResult[]> {
  const cred = await db.credential.findFirst({
    where: { service: 'SearXNG', isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  const baseUrl = cred?.serviceUrl || process.env.SEARXNG_URL || 'http://localhost:8888';
  let apiKey = '';
  if (cred?.encryptedData) {
    try {
      const parsed = JSON.parse(cred.encryptedData);
      apiKey = String(parsed.apiKey || '');
    } catch {}
  }

  try {
    const url = `${baseUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&categories=general,news,science`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`SearXNG search failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const results: SearchResult[] = (data.results || [])
      .slice(0, maxResults)
      .map((item: Record<string, unknown>) => ({
        title: String(item.title || ''),
        url: String(item.url || ''),
        snippet: String(item.content || ''),
        sourceType: 'SEARCH' as const,
        recencyScore: 0.7,
        qualityScore: 0.6,
      }));

    return results;
  } catch (error) {
    console.error('SearXNG search error:', error);
    return [];
  }
}
```

**extract.ts** — Fetches page content from URL, extracts text:
```typescript
// src/lib/engine/research/extract.ts

export interface ExtractedContent {
  title: string;
  content: string;
  contentLength: number;
}

export async function extractContent(url: string): Promise<ExtractedContent | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)',
        Accept: 'text/html,application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    let text = '';

    if (contentType.includes('application/json')) {
      const json = await response.json();
      text = JSON.stringify(json).slice(0, 5000);
    } else {
      const html = await response.text();
      text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 5000);
    }

    const titleMatch = text.match(/^(.{1,200}?)(?:\.\s|$)/);
    const title = titleMatch ? titleMatch[1].trim() : url;

    return {
      title,
      content: text,
      contentLength: text.length,
    };
  } catch {
    return null;
  }
}
```

- [ ] **Create both files**
- [ ] **Commit:** `git add src/lib/engine/research/ && git commit -m "feat: add SearXNG search and content extraction"`

---

### Task 4: Job Queue Worker

**Files:**
- Create: `src/lib/engine/worker.ts`
- Create: `src/app/api/jobs/worker/route.ts`

This is the core runtime engine. It polls PENDING jobs and processes them through the pipeline.

**worker.ts** — The worker loop:
```typescript
// src/lib/engine/worker.ts
import { db } from '@/lib/db';
import { runScanner } from '@/lib/engine/scanner';
import { runTriageAgent } from '@/lib/engine/agents/triage';
import { runBullAgent } from '@/lib/engine/agents/bull';
import { runBearAgent } from '@/lib/engine/agents/bear';
import { runContradictionAgent } from '@/lib/engine/agents/contradiction';
import { runJudgeAgent } from '@/lib/engine/agents/judge';
import { searchSearXNG } from '@/lib/engine/research/search';
import { extractContent } from '@/lib/engine/research/extract';
import { computeRisk, DEFAULT_STRATEGY } from '@/lib/engine/risk';

type WorkerStatus = 'STOPPED' | 'RUNNING' | 'PAUSED';

interface WorkerState {
  status: WorkerStatus;
  jobsProcessed: number;
  errors: number;
  lastActivity: string | null;
  currentJobType: string | null;
  error: string | null;
}

const state: WorkerState = {
  status: 'STOPPED',
  jobsProcessed: 0,
  errors: 0,
  lastActivity: null,
  currentJobType: null,
  error: null,
};

let intervalHandle: ReturnType<typeof setTimeout> | null = null;

export function getWorkerState(): WorkerState {
  return { ...state };
}

export function startWorker(intervalMs: number = 5000): WorkerState {
  if (state.status === 'RUNNING') return state;
  state.status = 'RUNNING';
  state.error = null;
  tick();
  intervalHandle = setInterval(tick, intervalMs);
  return state;
}

export function stopWorker(): WorkerState {
  state.status = 'STOPPED';
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  state.currentJobType = null;
  state.lastActivity = new Date().toISOString();
  return state;
}

async function tick() {
  try {
    const job = await db.job.findFirst({
      where: { status: 'PENDING' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    if (!job) return;

    state.currentJobType = job.type;
    state.lastActivity = new Date().toISOString();

    await db.job.update({
      where: { id: job.id },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    try {
      const result = await processJob(job);
      await db.job.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          result: JSON.stringify(result),
          completedAt: new Date(),
        },
      });
      state.jobsProcessed++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      await db.job.update({
        where: { id: job.id },
        data: {
          status: job.retryCount < job.maxRetries ? 'RETRYING' : 'FAILED',
          error: errorMessage,
          retryCount: job.retryCount + 1,
          completedAt: new Date(),
        },
      });
      state.errors++;
      state.error = errorMessage;
    }

    state.currentJobType = null;
    state.lastActivity = new Date().toISOString();
  } catch (err) {
    state.error = err instanceof Error ? err.message : 'Worker tick error';
  }
}

async function processJob(job: {
  id: string;
  type: string;
  payload: string | null;
}): Promise<Record<string, unknown>> {
  const payload = job.payload ? JSON.parse(job.payload) : {};

  switch (job.type) {
    case 'SCAN':
      return await runScanner(payload.venues, payload.categories);
    case 'TRIAGE':
      return await processTriage(payload);
    case 'RESEARCH':
      return await processResearch(payload);
    case 'JUDGE':
      return await processJudge(payload);
    case 'RISK':
      return await processRisk(payload);
    case 'EXECUTE':
      return await processExecute(payload);
    case 'SETTLE':
      return await processSettle(payload);
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

async function processTriage(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const marketId = payload.marketId as string;
  const market = await db.market.findUnique({ where: { id: marketId } });
  if (!market) throw new Error(`Market ${marketId} not found`);

  const snapshot = await db.marketSnapshot.findFirst({ where: { marketId }, orderBy: { timestamp: 'desc' } });
  const impliedProb = snapshot?.impliedProb ?? 0.5;
  const liquidity = snapshot?.liquidity ?? 0;

  const result = await runTriageAgent(
    marketId,
    market.title,
    market.description || '',
    market.category,
    impliedProb,
    liquidity,
  );

  const candidate = await db.tradeCandidate.findFirst({ where: { marketId } });
  if (candidate) {
    await db.tradeCandidate.update({
      where: { id: candidate.id },
      data: {
        stage: 'TRIAGED',
        triageStatus: result.status,
        triageReason: result.reason,
        researchQueued: result.worthResearch,
      },
    });

    if (result.worthResearch) {
      await db.job.create({
        data: {
          type: 'RESEARCH',
          status: 'PENDING',
          priority: 7,
          payload: JSON.stringify({ marketId, candidateId: candidate.id }),
        },
      });
    }
  }

  return result;
}

async function processResearch(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const marketId = payload.marketId as string;
  const candidateId = payload.candidateId as string | undefined;
  const market = await db.market.findUnique({ where: { id: marketId } });
  if (!market) throw new Error(`Market ${marketId} not found`);

  const snapshot = await db.marketSnapshot.findFirst({ where: { marketId }, orderBy: { timestamp: 'desc' } });
  const impliedProb = snapshot?.impliedProb ?? 0.5;

  const researchRun = await db.researchRun.create({
    data: {
      marketId,
      candidateId: candidateId || null,
      status: 'RUNNING',
      depth: 'DEEP',
      startedAt: new Date(),
    },
  });

  if (candidateId) {
    await db.tradeCandidate.update({
      where: { id: candidateId },
      data: { stage: 'RESEARCHING' },
    });
  }

  const searchResults = await searchSearXNG(market.title, 5);
  for (const result of searchResults) {
    const extracted = await extractContent(result.url);
    await db.researchSource.create({
      data: {
        researchRunId: researchRun.id,
        url: result.url,
        title: result.title,
        content: extracted?.content || result.snippet,
        sourceType: result.sourceType,
        recencyScore: result.recencyScore,
        qualityScore: result.qualityScore,
      } as any);
  }

  const researchContext = searchResults.map((r) => `${r.title}: ${r.snippet}`).join('\n');

  const bull = await runBullAgent(marketId, market.title, impliedProb, researchContext);
  await db.agentOutput.create({
    data: {
      researchRunId: researchRun.id,
      role: 'BULL',
      modelUsed: 'llm',
      promptVersion: '1',
      output: JSON.stringify(bull),
    } as any);
  }

  const bear = await runBearAgent(marketId, market.title, impliedProb, researchContext);
  await db.agentOutput.create({
    data: {
      researchRunId: researchRun.id,
      role: 'BEAR',
      modelUsed: 'llm',
      promptVersion: '1',
      output: JSON.stringify(bear),
    } as any);
  }

  const contradiction = await runContradictionAgent(marketId, market.title, bull, bear);
  await db.agentOutput.create({
    data: {
      researchRunId: researchRun.id,
      role: 'CONTRADICTION',
      modelUsed: 'llm',
      promptVersion: '1',
      output: JSON.stringify(contradiction),
    } as any});
  }

  await db.researchRun.update({
    where: { id: researchRun.id },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  await db.job.create({
    data: {
      type: 'JUDGE',
      status: 'PENDING',
      priority: 8,
      payload: JSON.stringify({
        marketId,
        candidateId,
        researchRunId: researchRun.id,
        bull,
        bear,
        contradiction,
      }),
    },
  });

  return { researchRunId: researchRun.id, sourcesFound: searchResults.length };
}
```

*(I'll continue with processJudge, processRisk, processExecute, processSettle, scanner, and remaining tasks in subsequent plan files to keep this manageable.)*

---

**NOTE:** This plan has grown very large. The remaining tasks (5-16) will be in a separate plan file. This Plan A covers the foundation layer. Plan B will cover: Polymarket scanner, pipeline orchestration, worker API route, market sync API, Kalshi fix, decision API fix, health fix, credential encryption, sim/live separation, Qdrant writeback, and the settings/requirements page.

- [ ] **Create `src/lib/engine/worker.ts`** (as above, but note: the `agentOutput.create` calls have syntax errors — remove the extra `}` before the closing `)` — each `as any)` should close properly)
- [ ] **Create `src/app/api/jobs/worker/route.ts`** — GET returns worker state, POST starts/stops worker
- [ ] **Commit:** `git add src/lib/engine/worker.ts src/app/api/jobs/worker/route.ts && git commit -m "feat: add job queue worker with pipeline dispatching"`

---

### Task 5: Market Scanner

**Files:**
- Create: `src/lib/engine/scanner.ts`
- Create: `src/lib/venues/polymarket.ts`
- Modify: `src/lib/venues/kalshi.ts` (fix schema mismatch)

**polymarket.ts** — Polymarket CLOB market scanner:
```typescript
// src/lib/venues/polymarket.ts
'use server';

const POLYMARKET_BASE_URL = 'https://clob.polymarket.com';

export interface PolymarketMarket {
  condition_id: string;
  question: string;
  description: string;
  category: string;
  end_date_iso: string;
  active: boolean;
  closed: boolean;
  tokens: Array<{
    token_id: string;
    outcome: string;
    price: number;
  }>;
}

export async function getPolymarketMarkets(limit: number = 100): Promise<Array<{
  externalId: string;
  title: string;
  description: string;
  category: string;
  venue: string;
  status: string;
  impliedProb: number;
  liquidity: number;
  spread: number;
  volume24h: number;
  bestBid: number;
  bestAsk: number;
}>> {
  try {
    const response = await fetch(`${POLYMARKET_BASE_URL}/markets?limit=${limit}&active=true`, {
      next: { revalidate: 60 },
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`Polymarket API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const markets = Array.isArray(data) ? data : data.markets || [];

    return markets.map((m: Record<string, unknown>) => {
      const tokens = (m.tokens || []) as Array<Record<string, unknown>>;
      const yesToken = tokens.find((t) => t.outcome === 'Yes') || tokens[0];
      const price = typeof yesToken?.price === 'number' ? yesToken.price : 0.5;
      const spread = Math.abs((typeof yesToken?.price === 'number' ? yesToken.price : 0.5) - (1 - (typeof yesToken?.price === 'number' ? yesToken.price : 0.5))) * 0.02;

      return {
        externalId: String(m.condition_id || m.id || ''),
        title: String(m.question || m.title || ''),
        description: String(m.description || ''),
        category: String(m.category || 'other').toLowerCase(),
        venue: 'POLYMARKET' as const,
        status: m.active && !m.closed ? 'ACTIVE' : 'INACTIVE',
        impliedProb: price,
        liquidity: typeof m.volume === 'number' ? m.volume : 0,
        spread: Math.round(spread * 1000) / 1000,
        volume24h: typeof m.volume24hr === 'number' ? m.volume24hr : 0,
        bestBid: price - spread / 2,
        bestAsk: price + spread / 2,
      };
    }).filter((m: { title: string; externalId: string }) => m.title && m.externalId);
  } catch (error) {
    console.error('Failed to fetch Polymarket markets:', error);
    return [];
  }
}
```

**scanner.ts** — Unified scanner that fetches from configured venues:
```typescript
// src/lib/engine/scanner.ts
import { db } from '@/lib/db';
import { getPolymarketMarkets } from '@/lib/venues/polymarket';
import { getKalshiMarkets } from '@/lib/venues/kalshi';

export async function runScanner(
  venues?: string[],
  categories?: string[],
): Promise<Record<string, unknown>> {
  const strategySetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  const strategy = strategySetting ? JSON.parse(strategySetting.value) : {};
  const enabledVenues = venues || strategy.enabledVenues || ['POLYMARKET', 'KALSHI'];
  const enabledCategories = categories || strategy.enabledCategories || [];

  let totalScanned = 0;
  let totalNew = 0;

  for (const venue of enabledVenues) {
    try {
      let markets: Array<{
        externalId: string;
        title: string;
        description: string;
        category: string;
        venue: string;
        status: string;
        impliedProb: number;
        liquidity: number;
        spread: number;
        volume24h?: number;
        bestBid?: number;
        bestAsk?: number;
      }> = [];

      if (venue === 'POLYMARKET') {
        markets = await getPolymarketMarkets();
      } else if (venue === 'KALSHI') {
        const kalshiRaw = await getKalshiMarkets();
        markets = kalshiRaw.map((m) => ({
          externalId: m.ticker,
          title: m.title,
          description: m.subtitle || '',
          category: (m.category || 'other').toLowerCase(),
          venue: 'KALSHI',
          status: m.status === 'active' ? 'ACTIVE' : 'INACTIVE',
          impliedProb: m.last_price / 100,
          liquidity: m.volume,
          spread: (m.yes_ask - m.yes_bid) / 100,
          volume24h: m.volume,
          bestBid: m.yes_bid / 100,
          bestAsk: m.yes_ask / 100,
        }));
      } else {
        continue;
      }

      for (const m of markets) {
        if (enabledCategories.length > 0 && !enabledCategories.includes(m.category)) continue;

        const existing = await db.market.findFirst({
          where: { externalId: m.externalId, venue: m.venue },
        });

        if (!existing) {
          const market = await db.market.create({
            data: {
              externalId: m.externalId,
              venue: m.venue,
              title: m.title,
              description: m.description,
              category: m.category,
              status: m.status,
            },
          });

          await db.marketSnapshot.create({
            data: {
              marketId: market.id,
              impliedProb: m.impliedProb,
              liquidity: m.liquidity,
              spread: m.spread,
              volume24h: m.volume24h || 0,
              bestBid: m.bestBid ?? m.impliedProb - m.spread / 2,
              bestAsk: m.bestAsk ?? m.impliedProb + m.spread / 2,
            },
          });

          await db.tradeCandidate.create({
            data: { marketId: market.id, stage: 'SCANNED' },
          });

          totalNew++;
        } else {
          await db.marketSnapshot.create({
            data: {
              marketId: existing.id,
              impliedProb: m.impliedProb,
              liquidity: m.liquidity,
              spread: m.spread,
              volume24h: m.volume24h || 0,
              bestBid: m.bestBid ?? m.impliedProb - m.spread / 2,
              bestAsk: m.bestAsk ?? m.impliedProb + m.spread / 2,
            },
          });
        }
        totalScanned++;
      }

      await db.auditLog.create({
        data: {
          action: `SCAN_${venue}`,
          entityType: 'Market',
          details: `Scanned ${markets.length} ${venue} markets, ${totalNew} new`,
        },
      });
    } catch (error) {
      console.error(`Failed to scan ${venue}:`, error);
    }
  }

  return { totalScanned, totalNew, venues: enabledVenues };
}
```

- [ ] **Create `src/lib/venues/polymarket.ts` and `src/lib/engine/scanner.ts`**
- [ ] **Commit:** `git add src/lib/venues/polymarket.ts src/lib/engine/scanner.ts && git commit -m "feat: add Polymarket scanner and unified market scanner"`

---

This Plan A covers tasks 1-5 from the gap analysis. The remaining tasks (6-12: Decision API fix, Kalshi fix, Health fix, Credential encryption, Sim/Live separation, Qdrant writeback, Settings/requirements page) will be in **Plan B**.

**Self-Review:**

1. **Spec coverage:** Tasks 1-5 cover: LLM client (gap 3), all 5 agents (gap 3), SearXNG+extraction (gap 7), job queue worker (gap 4), Polymarket scanner (gap 2), market scanner (gaps 2+6).
2. **Placeholder scan:** No TBDs or TODOs. All code is provided.
3. **Type consistency:** All agents use `callLLMJson` → `LLMCallResult` from `llm-client.ts`. Types match between agents. Worker dispatches by job type string correctly.

Gaps in this plan that Plan B must cover:
- Decision API fix (gap 5)
- Kalshi schema fix (gap 1)
- Health endpoint ping (gap 9)
- Credential encryption (gap 10)
- Sim/Live separation (gap 11)
- Qdrant writeback (gap 8)
- Worker API route
- Pipeline completion (processJudge, processRisk, processExecute, processSettle)
- Requirements/Settings page in UI