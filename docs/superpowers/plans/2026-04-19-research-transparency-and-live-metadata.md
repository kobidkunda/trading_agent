# Research Transparency and Live Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded StrategyHub provider/model fields with real metadata dropdowns and expose full stage-by-stage research transparency across Simulation Lab, Market Triage, and Research Ledger.

**Architecture:** Add a small metadata-discovery layer for TradingAgents and DeerFlow, then extend the existing research run / agent output / live simulation data paths with one normalized transparency shape that all three pages can render at different detail levels. Keep runtime config fields stable so the new UI and audit surfaces sit on top of existing execution behavior instead of rewriting the pipeline contract.

**Tech Stack:** Next.js App Router, React, TypeScript, Prisma/SQLite, existing trading engine and simulation state, existing shadcn/ui primitives.

---

## File Map

### Existing files to modify

- `src/components/trading/StrategyHub.tsx`
  Purpose: render live DeerFlow and TradingAgents metadata-backed dropdowns, stale values, and degraded fallback UI.
- `src/app/api/deerflow/models/route.ts`
  Purpose: keep DeerFlow metadata proxy normalized and useful for StrategyHub.
- `src/app/api/llm/models/route.ts`
  Purpose: existing fallback model source for provider/model discovery.
- `src/lib/engine/research/tradingagents-api.ts`
  Purpose: add TradingAgents metadata fetcher, keep analysis client separate.
- `src/lib/types/index.ts`
  Purpose: add normalized metadata and transparency types shared across UI and API layers.
- `src/app/api/research/route.ts`
  Purpose: return richer research run payloads suitable for Triage and Ledger detail rendering.
- `src/app/api/simulation/route.ts`
  Purpose: surface richer live transparency data in simulation responses.
- `src/components/trading/SimulationLab.tsx`
  Purpose: render service/model/timing/status/failure/source detail for live and recent stages.
- `src/components/trading/MarketTriage.tsx`
  Purpose: render complete selected-market research packet with stage outputs and source provenance.
- `src/components/trading/ResearchLedger.tsx`
  Purpose: render deep audit detail for provider outputs, debate outputs, synthesis, and decision reasoning.
- `src/lib/engine/live-simulation.ts`
  Purpose: extend live event payloads so the UI can show service/model/timing/failure context instead of only stage labels.
- `src/lib/engine/pipeline.ts`
  Purpose: persist richer stage/provider output metadata during runs.
- `src/lib/engine/research/synthesis.ts`
  Purpose: surface synthesis detail in a reusable shape for audit pages.

### New files to create

- `src/app/api/tradingagents/models/route.ts`
  Purpose: TradingAgents metadata endpoint with native-first and LLM fallback behavior.
- `src/lib/engine/research/transparency.ts`
  Purpose: helper functions to normalize stage output, source provenance, stale options, and page-ready transparency packets.
- `src/lib/engine/__tests__/tradingagents-models.test.ts`
  Purpose: metadata endpoint / fallback tests for TradingAgents models.
- `src/lib/engine/__tests__/transparency.test.ts`
  Purpose: normalization tests for stage/source transparency helpers.

## Task 1: Add shared metadata and transparency types

**Files:**
- Create: `src/lib/engine/research/transparency.ts`
- Modify: `src/lib/types/index.ts`
- Test: `src/lib/engine/__tests__/transparency.test.ts`

- [ ] **Step 1: Write the failing transparency helper test**

Create `src/lib/engine/__tests__/transparency.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  buildStageTransparencyRecord,
  withStaleOption,
} from '../research/transparency'

describe('transparency helpers', () => {
  it('marks a saved dropdown value as stale when metadata no longer includes it', () => {
    const options = withStaleOption(
      [{ id: 'paper_lite', label: 'paper_lite', stale: false }],
      'paper_proglm',
    )

    expect(options).toHaveLength(2)
    expect(options[0]).toEqual({ id: 'paper_proglm', label: 'paper_proglm', stale: true })
  })

  it('normalizes stage transparency records with timing and failure context', () => {
    const record = buildStageTransparencyRecord({
      stage: 'TRADINGAGENTS',
      serviceName: 'TradingAgents',
      provider: 'openai',
      model: 'paper_proglm',
      startedAt: '2026-04-19T04:00:00.000Z',
      endedAt: '2026-04-19T04:00:10.000Z',
      status: 'completed',
      rawOutput: 'line 1\nline 2',
      sources: [{ title: 'Example', url: 'https://example.com', snippet: 'evidence' }],
    })

    expect(record.durationMs).toBe(10000)
    expect(record.serviceName).toBe('TradingAgents')
    expect(record.sources).toHaveLength(1)
    expect(record.failureReason).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/engine/__tests__/transparency.test.ts`
Expected: FAIL with module not found for `../research/transparency`.

- [ ] **Step 3: Add shared metadata and transparency types**

Add these to `src/lib/types/index.ts`:

```ts
export interface MetadataOption {
  id: string;
  label: string;
  stale?: boolean;
}

export interface TradingAgentsMetadataResponse {
  providers: MetadataOption[];
  models: MetadataOption[];
  source: 'tradingagents' | 'llm-fallback';
  error?: string;
}

export type TransparencyStageStatus = 'running' | 'completed' | 'failed' | 'skipped' | 'timeout';

export interface TransparencySourceRef {
  title: string;
  url: string;
  domain: string | null;
  snippet: string | null;
  provider: string | null;
  reasonIncluded?: string | null;
}

export interface TransparencyStageRecord {
  stage: string;
  serviceName: string;
  provider: string | null;
  model: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  status: TransparencyStageStatus;
  failureReason: string | null;
  summary: string | null;
  rawOutput: string | null;
  sources: TransparencySourceRef[];
  references: TransparencySourceRef[];
}
```

- [ ] **Step 4: Implement minimal transparency helpers**

Create `src/lib/engine/research/transparency.ts`:

```ts
import type { MetadataOption, TransparencySourceRef, TransparencyStageRecord } from '@/lib/types'

function getDomain(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

export function withStaleOption(options: MetadataOption[], savedValue?: string | null): MetadataOption[] {
  if (!savedValue) return options
  if (options.some((option) => option.id === savedValue)) return options
  return [{ id: savedValue, label: savedValue, stale: true }, ...options]
}

export function normalizeSourceRef(source: {
  title?: string | null
  url?: string | null
  snippet?: string | null
  provider?: string | null
  reasonIncluded?: string | null
}): TransparencySourceRef {
  return {
    title: source.title || source.url || 'Untitled source',
    url: source.url || '',
    domain: getDomain(source.url),
    snippet: source.snippet || null,
    provider: source.provider || null,
    reasonIncluded: source.reasonIncluded || null,
  }
}

export function buildStageTransparencyRecord(input: {
  stage: string
  serviceName: string
  provider?: string | null
  model?: string | null
  startedAt?: string | null
  endedAt?: string | null
  status: TransparencyStageRecord['status']
  failureReason?: string | null
  summary?: string | null
  rawOutput?: string | null
  sources?: Array<{ title?: string | null; url?: string | null; snippet?: string | null; provider?: string | null; reasonIncluded?: string | null }>
  references?: Array<{ title?: string | null; url?: string | null; snippet?: string | null; provider?: string | null; reasonIncluded?: string | null }>
}): TransparencyStageRecord {
  const started = input.startedAt ? Date.parse(input.startedAt) : NaN
  const ended = input.endedAt ? Date.parse(input.endedAt) : NaN

  return {
    stage: input.stage,
    serviceName: input.serviceName,
    provider: input.provider || null,
    model: input.model || null,
    startedAt: input.startedAt || null,
    endedAt: input.endedAt || null,
    durationMs: Number.isFinite(started) && Number.isFinite(ended) ? ended - started : null,
    status: input.status,
    failureReason: input.failureReason || null,
    summary: input.summary || null,
    rawOutput: input.rawOutput || null,
    sources: (input.sources || []).map(normalizeSourceRef),
    references: (input.references || []).map(normalizeSourceRef),
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/engine/__tests__/transparency.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/types/index.ts src/lib/engine/research/transparency.ts src/lib/engine/__tests__/transparency.test.ts
git commit -m "feat: add shared research transparency types"
```

## Task 2: Add TradingAgents metadata endpoint with live fallback

**Files:**
- Create: `src/app/api/tradingagents/models/route.ts`
- Modify: `src/lib/engine/research/tradingagents-api.ts`
- Modify: `src/app/api/llm/models/route.ts`
- Test: `src/lib/engine/__tests__/tradingagents-models.test.ts`

- [ ] **Step 1: Write the failing TradingAgents metadata test**

Create `src/lib/engine/__tests__/tradingagents-models.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('../research/tradingagents-api', () => ({
  fetchTradingAgentsMetadata: vi.fn(),
}))

vi.mock('@/app/api/llm/models/route', () => ({
  GET: vi.fn(),
}))

describe('tradingagents models route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns native TradingAgents metadata when available', async () => {
    const { fetchTradingAgentsMetadata } = await import('../research/tradingagents-api')
    const { GET } = await import('@/app/api/tradingagents/models/route')

    vi.mocked(fetchTradingAgentsMetadata).mockResolvedValue({
      providers: [{ id: 'openai', label: 'openai' }],
      models: [{ id: 'paper_lite', label: 'paper_lite' }],
      source: 'tradingagents',
    })

    const response = await GET()
    const data = await response.json()

    expect(data.source).toBe('tradingagents')
    expect(data.models[0].id).toBe('paper_lite')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/engine/__tests__/tradingagents-models.test.ts`
Expected: FAIL with route or metadata fetcher missing.

- [ ] **Step 3: Add TradingAgents metadata fetcher**

In `src/lib/engine/research/tradingagents-api.ts`, add:

```ts
import type { MetadataOption, TradingAgentsMetadataResponse } from '@/lib/types'

function normalizeMetadataOptions(items: Array<{ id?: string; name?: string; label?: string; model?: string }>): MetadataOption[] {
  return items
    .map((item) => {
      const value = item.id || item.name || item.label || item.model || ''
      return value ? { id: value, label: value } : null
    })
    .filter((item): item is MetadataOption => Boolean(item))
}

export async function fetchTradingAgentsMetadata(): Promise<TradingAgentsMetadataResponse | null> {
  const cred = await getCredentialForService('tradingagents')
  const baseUrl = cred?.baseUrl || process.env.TRADINGAGENTS_URL || 'http://localhost:8100'
  const headers: Record<string, string> = {}

  if (cred?.apiKey) {
    headers.Authorization = `Bearer ${cred.apiKey}`
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers,
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) return null

    const data = await response.json()
    return {
      providers: normalizeMetadataOptions(data.providers || []),
      models: normalizeMetadataOptions(data.models || data.data || []),
      source: 'tradingagents',
    }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Add metadata route with `/api/llm/models` fallback**

Create `src/app/api/tradingagents/models/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { fetchTradingAgentsMetadata } from '@/lib/engine/research/tradingagents-api'
import type { MetadataOption } from '@/lib/types'

async function fetchLlmFallback(): Promise<{ providers: MetadataOption[]; models: MetadataOption[]; source: 'llm-fallback'; error?: string }> {
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const response = await fetch(`${origin}/api/llm/models`, {
    signal: AbortSignal.timeout(10000),
    cache: 'no-store',
  })

  if (!response.ok) {
    return { providers: [], models: [], source: 'llm-fallback', error: `HTTP ${response.status}` }
  }

  const data = await response.json()
  const models = Array.isArray(data.models)
    ? data.models.map((model: { id: string; name?: string }) => ({ id: model.id, label: model.name || model.id }))
    : []

  return {
    providers: data.provider ? [{ id: data.provider, label: data.provider }] : [],
    models,
    source: 'llm-fallback',
    ...(data.error ? { error: data.error } : {}),
  }
}

export async function GET() {
  const native = await fetchTradingAgentsMetadata()
  if (native && (native.providers.length > 0 || native.models.length > 0)) {
    return NextResponse.json(native)
  }

  const fallback = await fetchLlmFallback()
  return NextResponse.json(fallback)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/engine/__tests__/tradingagents-models.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/tradingagents/models/route.ts src/lib/engine/research/tradingagents-api.ts src/app/api/llm/models/route.ts src/lib/engine/__tests__/tradingagents-models.test.ts
git commit -m "feat: add tradingagents model metadata endpoint"
```

## Task 3: Replace StrategyHub hardcoded TradingAgents fields with live dropdowns

**Files:**
- Modify: `src/components/trading/StrategyHub.tsx`
- Modify: `src/lib/types/index.ts`
- Test: targeted lint/manual verification only if no UI test harness exists

- [ ] **Step 1: Add dropdown state for TradingAgents metadata**

In `src/components/trading/StrategyHub.tsx`, add state:

```ts
const [tradingAgentsProviders, setTradingAgentsProviders] = useState<MetadataOption[]>([])
const [tradingAgentsModels, setTradingAgentsModels] = useState<MetadataOption[]>([])
const [tradingAgentsSource, setTradingAgentsSource] = useState<'tradingagents' | 'llm-fallback' | null>(null)
const [tradingAgentsError, setTradingAgentsError] = useState<string | null>(null)
const [tradingAgentsLoading, setTradingAgentsLoading] = useState(false)
```

- [ ] **Step 2: Add metadata fetch effect**

In `StrategyHub.tsx`, add:

```ts
const fetchTradingAgentsModels = async () => {
  setTradingAgentsLoading(true)
  try {
    const res = await fetch('/api/tradingagents/models')
    const data = await res.json()

    const providerOptions = withStaleOption(
      Array.isArray(data.providers) ? data.providers : [],
      settings.stageRouting?.analystLlmProvider,
    )
    const modelOptions = withStaleOption(
      Array.isArray(data.models) ? data.models : [],
      settings.stageRouting?.analystDeepThinkLlm,
    )

    setTradingAgentsProviders(providerOptions)
    setTradingAgentsModels(withStaleOption(modelOptions, settings.stageRouting?.analystQuickThinkLlm))
    setTradingAgentsSource(data.source || null)
    setTradingAgentsError(data.error || null)
  } catch (error) {
    setTradingAgentsProviders([])
    setTradingAgentsModels([])
    setTradingAgentsSource(null)
    setTradingAgentsError(error instanceof Error ? error.message : 'Failed to fetch TradingAgents metadata')
  } finally {
    setTradingAgentsLoading(false)
  }
}
```

Call it alongside the existing DeerFlow model fetch.

- [ ] **Step 3: Replace TradingAgents free-text inputs with dropdowns**

Replace the current TradingAgents `Input` fields with `Select` components:

```tsx
<Select
  value={settings.stageRouting?.analystLlmProvider || ''}
  onValueChange={(value) => updateStageRouting('analystLlmProvider', value)}
>
  <SelectTrigger className="h-8 border-gray-700 bg-gray-800 text-xs text-white">
    <SelectValue placeholder="Use TradingAgents default provider" />
  </SelectTrigger>
  <SelectContent className="border-gray-700 bg-gray-900 max-h-64">
    {tradingAgentsProviders.map((option) => (
      <SelectItem key={option.id} value={option.id} className="text-xs font-mono">
        {option.label}{option.stale ? ' (stale)' : ''}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

Do the same for deep and quick models using `tradingAgentsModels`.

- [ ] **Step 4: Add source/failure labels and manual recovery fallback**

Under the TradingAgents dropdowns, render:

```tsx
<p className="text-[10px] text-gray-600">
  {tradingAgentsSource === 'tradingagents'
    ? 'Options loaded from TradingAgents'
    : tradingAgentsSource === 'llm-fallback'
      ? 'Options loaded from LLM Provider fallback'
      : 'Metadata unavailable'}
</p>
{tradingAgentsError && (
  <p className="text-[10px] text-amber-400">{tradingAgentsError}</p>
)}
```

Only render manual `Input` recovery controls when both provider and model option arrays are empty.

- [ ] **Step 5: Ensure DeerFlow stays dropdown-first with stale/clear support**

Keep the existing DeerFlow dropdown path, but use `withStaleOption()` before rendering the options so a saved stale value stays visible in the list.

- [ ] **Step 6: Run targeted lint verification**

Run: `npx eslint "src/components/trading/StrategyHub.tsx"`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/components/trading/StrategyHub.tsx src/lib/types/index.ts
git commit -m "feat: use live metadata dropdowns in strategy hub"
```

## Task 4: Persist and expose richer transparency data from simulation and pipeline state

**Files:**
- Modify: `src/lib/engine/live-simulation.ts`
- Modify: `src/app/api/simulation/route.ts`
- Modify: `src/lib/engine/pipeline.ts`
- Modify: `src/lib/types/index.ts`
- Test: `src/lib/engine/__tests__/live-sim-events.test.ts`

- [ ] **Step 1: Extend the failing live-sim test with service/model/failure fields**

Append to `src/lib/engine/__tests__/live-sim-events.test.ts`:

```ts
it('preserves service, model, and failure context on stage events', () => {
  const event = buildStageTransparencyRecord({
    stage: 'DEERFLOW',
    serviceName: 'DeerFlow Research',
    provider: 'openai',
    model: 'paper_proglm',
    status: 'failed',
    failureReason: 'timeout',
  })

  expect(event.serviceName).toBe('DeerFlow Research')
  expect(event.model).toBe('paper_proglm')
  expect(event.failureReason).toBe('timeout')
})
```

- [ ] **Step 2: Run targeted test to verify it fails**

Run: `npx vitest run src/lib/engine/__tests__/live-sim-events.test.ts`
Expected: FAIL until the new fields are wired into live state.

- [ ] **Step 3: Extend live simulation event payloads**

In `src/lib/types/index.ts`, extend `LiveActivityEvent`:

```ts
serviceName?: string;
model?: string | null;
failureReason?: string | null;
summary?: string | null;
references?: TransparencySourceRef[];
```

- [ ] **Step 4: Update live simulation event emission**

In `src/lib/engine/live-simulation.ts`, when recording stage events, include service/model context if known:

```ts
state.activityEvents = appendLiveActivityEvent(state.activityEvents, {
  timestamp,
  marketId: market.id,
  marketTitle: template.title,
  stage,
  provider,
  serviceName: provider === 'deerflow' ? 'DeerFlow Research' : provider === 'tradingagents' ? 'TradingAgents' : provider === 'agent_reach' ? 'Agent-Reach' : 'System',
  model: provider === 'deerflow' ? routing.deerflowApiModel || routing.deerflowModel || settings.defaultModel || null : null,
  type: 'started',
  message,
})
```

Also include `failureReason` on failed events and preserve `references` when the stage has source links.

- [ ] **Step 5: Extend simulation API response shape**

Ensure `src/app/api/simulation/route.ts` returns the richer `activityEvents` structure without stripping new fields.

- [ ] **Step 6: Run targeted test to verify it passes**

Run: `npx vitest run src/lib/engine/__tests__/live-sim-events.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/engine/live-simulation.ts src/app/api/simulation/route.ts src/lib/types/index.ts src/lib/engine/__tests__/live-sim-events.test.ts
git commit -m "feat: enrich live simulation transparency data"
```

## Task 5: Expose richer research run transparency in the research API

**Files:**
- Modify: `src/app/api/research/route.ts`
- Modify: `src/lib/engine/pipeline.ts`
- Modify: `src/lib/engine/research/synthesis.ts`
- Test: `src/lib/engine/__tests__/transparency.test.ts`

- [ ] **Step 1: Add failing normalization test for research transparency packet**

Append to `src/lib/engine/__tests__/transparency.test.ts`:

```ts
it('builds page-ready transparency records from research sources and agent outputs', () => {
  const record = buildStageTransparencyRecord({
    stage: 'JUDGE',
    serviceName: 'Judge',
    model: 'paper_lite',
    status: 'completed',
    rawOutput: 'Final probability: 0.62',
    sources: [{ title: 'ethereum.org', url: 'https://ethereum.org/roadmap/pectra/', snippet: 'Pectra roadmap' }],
  })

  expect(record.stage).toBe('JUDGE')
  expect(record.references[0]?.domain).toBe('ethereum.org')
})
```

- [ ] **Step 2: Run test to verify current behavior is insufficient**

Run: `npx vitest run src/lib/engine/__tests__/transparency.test.ts`
Expected: FAIL until source/reference shape is finalized for page rendering.

- [ ] **Step 3: Persist richer provider metadata in pipeline writes**

When writing `agentOutputs` in `src/lib/engine/pipeline.ts`, make sure the stored `output` JSON/string includes service/model/provider timing where available. For example:

```ts
output: JSON.stringify({
  stage: 'TRADINGAGENTS',
  serviceName: 'TradingAgents',
  provider: routing.analystLlmProvider || null,
  model: routing.analystDeepThinkLlm || null,
  summary: tradingAgentsSource?.summary || null,
  raw: tradingAgentsSource?.rawOutput || null,
  references: tradingAgentsSource?.sources || [],
})
```

Do the same for DeerFlow, Agent-Reach, Synthesis, Contradiction, and Judge where those outputs are created.

- [ ] **Step 4: Return research runs in a page-friendly shape**

In `src/app/api/research/route.ts`, map `researchRuns` before returning them:

```ts
const normalized = researchRuns.map((run) => ({
  ...run,
  transparency: {
    stages: run.agentOutputs.map((output) => {
      const parsed = safeParse(output.output)
      return buildStageTransparencyRecord({
        stage: parsed?.stage || output.role,
        serviceName: parsed?.serviceName || output.role,
        provider: parsed?.provider || null,
        model: output.modelUsed || parsed?.model || null,
        startedAt: null,
        endedAt: output.createdAt,
        status: 'completed',
        rawOutput: typeof parsed?.raw === 'string' ? parsed.raw : output.output,
        summary: typeof parsed?.summary === 'string' ? parsed.summary : null,
        references: parsed?.references || [],
      })
    }),
  },
}))
```

Return `normalized` instead of the raw Prisma object only.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/engine/__tests__/transparency.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/app/api/research/route.ts src/lib/engine/pipeline.ts src/lib/engine/research/synthesis.ts src/lib/engine/__tests__/transparency.test.ts
git commit -m "feat: expose rich research transparency records"
```

## Task 6: Render detailed live transparency in Simulation Lab

**Files:**
- Modify: `src/components/trading/SimulationLab.tsx`
- Test: targeted lint/manual verification only if no component harness exists

- [ ] **Step 1: Add live-stage detail cards to SimulationLab**

Below the existing active stage summary, render a detail block for the current stage:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Current Stage Detail</CardTitle>
  </CardHeader>
  <CardContent>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <p className="text-[11px] text-gray-500">Service</p>
        <p className="text-sm text-white">{activeEvent?.serviceName || 'System'}</p>
      </div>
      <div>
        <p className="text-[11px] text-gray-500">Model</p>
        <p className="text-sm text-white">{activeEvent?.model || '—'}</p>
      </div>
      <div>
        <p className="text-[11px] text-gray-500">Status</p>
        <p className="text-sm text-white">{activeEvent?.type || 'running'}</p>
      </div>
      <div>
        <p className="text-[11px] text-gray-500">Failure</p>
        <p className="text-sm text-red-400">{activeEvent?.failureReason || '—'}</p>
      </div>
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 2: Expand live activity rows with service/timing/failure context**

In the `activityEvents.map(...)` rendering path, add:

```tsx
<div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-500">
  <span>{event.serviceName || 'System'}</span>
  {event.model && <span>{event.model}</span>}
  {event.failureReason && <span className="text-red-400">{event.failureReason}</span>}
</div>
```

- [ ] **Step 3: Add compact source link rendering when available**

If `event.references?.length` is truthy, show up to 3 links under the event row.

- [ ] **Step 4: Run targeted lint verification**

Run: `npx eslint "src/components/trading/SimulationLab.tsx"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/trading/SimulationLab.tsx
git commit -m "feat: show detailed live stage transparency"
```

## Task 7: Make Market Triage selected-market detail complete

**Files:**
- Modify: `src/components/trading/MarketTriage.tsx`
- Test: targeted lint/manual verification only if no component harness exists

- [ ] **Step 1: Replace inline market detail source list with provenance-aware rendering**

In `InlineMarketDetail`, replace the simple source list with cards showing:

```tsx
<div className="rounded-lg border border-gray-800 bg-gray-800/30 p-3">
  <div className="flex items-center justify-between gap-2">
    <a href={source.url} target="_blank" rel="noreferrer" className="text-sm text-cyan-400 underline-offset-2 hover:underline">
      {source.title || source.url}
    </a>
    <Badge className="text-[10px] border-gray-700 bg-gray-800 text-gray-300">
      {new URL(source.url).hostname}
    </Badge>
  </div>
  <p className="mt-2 text-xs text-gray-500">{source.content}</p>
</div>
```

- [ ] **Step 2: Add per-stage transparency section above raw agent outputs**

Render a `Stage Transparency` section using `latestResearch.transparency?.stages` if present, with service/model/status/failure/timing fields.

- [ ] **Step 3: Add contradiction/judge/debate emphasis**

When rendering agent outputs, visually highlight `CONTRADICTION` and `JUDGE` roles and show parsed structured output if JSON is available.

- [ ] **Step 4: Run targeted lint verification**

Run: `npx eslint "src/components/trading/MarketTriage.tsx"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/trading/MarketTriage.tsx
git commit -m "feat: complete market triage research packet"
```

## Task 8: Turn Research Ledger into the deep audit surface

**Files:**
- Modify: `src/components/trading/ResearchLedger.tsx`
- Test: targeted lint/manual verification only if no component harness exists

- [ ] **Step 1: Add research transparency loading per decision**

In the expanded decision row flow, load the associated research run and consume `transparency.stages` from `/api/research?marketId=...`.

- [ ] **Step 2: Render provider-stage audit sections**

Under the expanded decision detail, render sections for:

```tsx
{transparencyStages.map((stage) => (
  <div key={`${stage.stage}-${stage.endedAt || stage.startedAt}`} className="rounded-lg border border-gray-800 bg-gray-800/30 p-3">
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-medium text-white">{stage.stage}</p>
      <Badge className="text-[10px] border-gray-700 bg-gray-800 text-gray-300">{stage.status}</Badge>
    </div>
    <p className="mt-1 text-xs text-gray-500">{stage.serviceName} {stage.model ? `• ${stage.model}` : ''}</p>
    {stage.failureReason && <p className="mt-2 text-xs text-red-400">{stage.failureReason}</p>}
    {stage.rawOutput && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-gray-300">{stage.rawOutput}</pre>}
  </div>
))}
```

- [ ] **Step 3: Add explicit debate/judge grouping**

Group `BULL`, `BEAR`, `CONTRADICTION`, and `JUDGE` stages under a `Debate and Judge` heading so the model-based reasoning path is easy to follow.

- [ ] **Step 4: Add source provenance rendering with domain/snippet/provider**

Render source lists under each stage or in a final `Sources` section using title, URL, domain, snippet, and provider.

- [ ] **Step 5: Run targeted lint verification**

Run: `npx eslint "src/components/trading/ResearchLedger.tsx"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/trading/ResearchLedger.tsx
git commit -m "feat: add deep audit detail to research ledger"
```

## Task 9: Final verification and integration cleanup

**Files:**
- Modify: only files that verification proves need minimal fixes
- Test: integrated verification commands below

- [ ] **Step 1: Run integrated targeted tests**

Run: `npx vitest run src/lib/engine/__tests__/live-sim-events.test.ts src/lib/engine/__tests__/full-research.test.ts src/lib/engine/__tests__/transparency.test.ts src/lib/engine/__tests__/tradingagents-models.test.ts`
Expected: PASS

- [ ] **Step 2: Run scoped lint on changed UI/API files**

Run: `npx eslint "src/components/trading/StrategyHub.tsx" "src/components/trading/SimulationLab.tsx" "src/components/trading/MarketTriage.tsx" "src/components/trading/ResearchLedger.tsx" "src/app/api/deerflow/models/route.ts" "src/app/api/tradingagents/models/route.ts" "src/app/api/research/route.ts" "src/app/api/simulation/route.ts"`
Expected: PASS

- [ ] **Step 3: Fix only concrete integration issues revealed by verification**

If any command fails, apply the smallest correction needed in the affected file(s), then rerun the failed command.

- [ ] **Step 4: Manual verification checklist**

Check in the running app:
- StrategyHub shows DeerFlow dropdown from `/api/deerflow/models`
- StrategyHub shows TradingAgents provider/deep/quick dropdowns from `/api/tradingagents/models` or clear fallback labels
- SimulationLab shows service/model/failure detail for current/recent stages
- MarketTriage selected market shows full packet with provenance and contradiction/judge visibility
- ResearchLedger shows deep audit detail for provider outputs and debate reasoning

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "test: verify research transparency and live metadata flow"
```

## Self-Review

- Spec coverage check:
  - StrategyHub live dropdowns: Tasks 2 and 3
  - TradingAgents metadata endpoint: Task 2
  - shared transparency model: Task 1
  - Simulation Lab detail: Task 6
  - Market Triage completeness: Task 7
  - Research Ledger deep audit: Task 8
  - contradiction/judge/debate visibility: Tasks 5, 7, 8
  - persistence/stale values: Tasks 1 and 3
- Placeholder scan: no TBD/TODO or implicit “implement later” steps remain.
- Type consistency check:
  - `MetadataOption`, `TradingAgentsMetadataResponse`, `TransparencyStageRecord`, and `TransparencySourceRef` are defined once in Task 1 and reused consistently.
  - `buildStageTransparencyRecord()` and `withStaleOption()` are the shared helper names used consistently in later tasks.
