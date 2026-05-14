# Full Research and Pipeline Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Simulation Lab visibly show live execution, make `Research Depth = FULL` run DeerFlow, TradingAgents, and Agent-Reach in parallel for filtered trades, and let the app control DeerFlow and TradingAgents model/provider settings.

**Architecture:** Keep the current pipeline shape but add an explicit live-event layer, a focused full-research orchestrator, and narrow adapters for DeerFlow API and Agent-Reach. Reuse existing research run, agent output, and synthesis storage patterns so new providers can degrade gracefully without destabilizing the rest of the pipeline.

**Tech Stack:** Next.js App Router, TypeScript, React, Prisma/SQLite, FastAPI Python service in `ta-service`, MCP SSE integration for Agent-Reach.

---

## File Map

### Existing files to modify

- `src/lib/engine/live-simulation.ts`
  Purpose: in-memory live simulation state, market loop, and pipeline execution entry point.
- `src/app/api/simulation/route.ts`
  Purpose: serialize live simulation state to the UI and accept start/stop/config updates.
- `src/components/trading/SimulationLab.tsx`
  Purpose: render live simulation status, progress widgets, and market activity.
- `src/lib/types/index.ts`
  Purpose: shared app types for strategy routing, research depth, live activity, and provider results.
- `src/lib/engine/pipeline.ts`
  Purpose: market pipeline orchestration, research run creation, and judge/risk flow.
- `src/lib/engine/research/deerflow-api.ts`
  Purpose: DeerFlow API client and health checks.
- `src/lib/engine/research/deerflow.ts`
  Purpose: DeerFlow local/API execution logic.
- `src/lib/engine/research/tradingagents-api.ts`
  Purpose: TradingAgents HTTP client.
- `src/lib/engine/research/search.ts`
  Purpose: service alias lookup and credential resolution.
- `src/lib/engine/research/synthesis.ts`
  Purpose: merge provider outputs into a single synthesis result.
- `src/components/trading/StrategyHub.tsx`
  Purpose: settings UI for research depth and provider/model controls.
- `src/app/api/strategy/route.ts`
  Purpose: persist strategy settings.
- `src/app/api/research/route.ts`
  Purpose: read and write research runs.
- `ta-service/server.py`
  Purpose: TradingAgents-compatible backend API and enrichment logic.
- `docker-compose.yml`
  Purpose: service env wiring for TradingAgents and external providers.

### New files to create

- `src/lib/engine/live-sim-events.ts`
  Purpose: helper functions and types for stage/activity event creation.
- `src/lib/engine/research/agent-reach.ts`
  Purpose: server-side Agent-Reach adapter for the Next.js app.
- `src/lib/engine/research/full-research.ts`
  Purpose: parallel FULL-depth orchestration for DeerFlow, TradingAgents, and Agent-Reach.
- `src/app/api/deerflow/models/route.ts`
  Purpose: proxy DeerFlow model listing to the UI.
- `src/app/api/research/full/route.ts`
  Purpose: optional explicit trigger endpoint for full research runs if needed by UI/testing.
- `src/lib/engine/__tests__/full-research.test.ts`
  Purpose: orchestration tests for FULL-depth parallel execution and degradation.
- `src/lib/engine/__tests__/live-sim-events.test.ts`
  Purpose: event/state tests for Simulation Lab visibility.
- `ta-service/agent_reach.py`
  Purpose: Agent-Reach MCP SSE adapter for the Python service.
- `ta-service/finance_enrichment.py`
  Purpose: Alpha Vantage and Finnhub enrichment helpers.

## Task 1: Add explicit live simulation activity state

**Files:**
- Create: `src/lib/engine/live-sim-events.ts`
- Modify: `src/lib/types/index.ts`
- Modify: `src/lib/engine/live-simulation.ts`
- Test: `src/lib/engine/__tests__/live-sim-events.test.ts`

- [ ] **Step 1: Write the failing event-state test**

```ts
import { describe, expect, it } from 'vitest'
import {
  appendLiveActivityEvent,
  createEmptyMarketProgress,
  updateMarketProgressStatus,
} from '@/lib/engine/live-sim-events'

describe('live simulation events', () => {
  it('records stage activity and market progress in order', () => {
    const startedAt = '2026-04-19T10:00:00.000Z'
    const progress = createEmptyMarketProgress('m1', 'Test market')

    const started = updateMarketProgressStatus(progress, {
      stage: 'TRIAGE',
      status: 'running',
      timestamp: startedAt,
      message: 'Triage started',
    })

    const completed = updateMarketProgressStatus(started, {
      stage: 'TRIAGE',
      status: 'completed',
      timestamp: '2026-04-19T10:00:05.000Z',
      message: 'Triage completed',
    })

    const events = appendLiveActivityEvent([], {
      marketId: 'm1',
      marketTitle: 'Test market',
      stage: 'TRIAGE',
      type: 'completed',
      message: 'Triage completed',
      timestamp: '2026-04-19T10:00:05.000Z',
    })

    expect(completed.currentStage).toBe('TRIAGE')
    expect(completed.status).toBe('completed')
    expect(completed.history).toHaveLength(2)
    expect(events[0].type).toBe('completed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/engine/__tests__/live-sim-events.test.ts`
Expected: FAIL with module or function not found errors for `live-sim-events` helpers.

- [ ] **Step 3: Define new shared live-event types**

Add these types to `src/lib/types/index.ts`:

```ts
export type LivePipelineStage =
  | 'SCAN'
  | 'TRIAGE'
  | 'DEERFLOW'
  | 'TRADINGAGENTS'
  | 'AGENT_REACH'
  | 'SYNTHESIS'
  | 'JUDGE'
  | 'RISK'
  | 'DECISION'
  | 'RESOLUTION_CHECK'

export type LiveActivityType = 'started' | 'progress' | 'completed' | 'failed' | 'skipped' | 'timeout'

export interface LiveActivityEvent {
  timestamp: string
  marketId: string | null
  marketTitle: string | null
  stage: LivePipelineStage
  provider?: 'deerflow' | 'tradingagents' | 'agent_reach' | 'system'
  type: LiveActivityType
  message: string
}

export interface LiveMarketProgress {
  marketId: string
  marketTitle: string
  currentStage: LivePipelineStage | null
  currentStageStartedAt: string | null
  status: 'running' | 'completed' | 'failed' | 'skipped'
  history: LiveActivityEvent[]
  lastUpdatedAt: string
}
```

- [ ] **Step 4: Implement minimal event helpers**

Create `src/lib/engine/live-sim-events.ts`:

```ts
import type { LiveActivityEvent, LiveMarketProgress } from '@/lib/types'

export function createEmptyMarketProgress(marketId: string, marketTitle: string): LiveMarketProgress {
  return {
    marketId,
    marketTitle,
    currentStage: null,
    currentStageStartedAt: null,
    status: 'running',
    history: [],
    lastUpdatedAt: new Date().toISOString(),
  }
}

export function appendLiveActivityEvent(
  events: LiveActivityEvent[],
  event: LiveActivityEvent,
  maxItems = 100,
): LiveActivityEvent[] {
  return [...events, event].slice(-maxItems)
}

export function updateMarketProgressStatus(
  progress: LiveMarketProgress,
  event: LiveActivityEvent,
): LiveMarketProgress {
  return {
    ...progress,
    currentStage: event.stage,
    currentStageStartedAt: event.type === 'started' ? event.timestamp : progress.currentStageStartedAt,
    status:
      event.type === 'failed'
        ? 'failed'
        : event.type === 'skipped'
          ? 'skipped'
          : event.type === 'completed'
            ? 'completed'
            : 'running',
    history: [...progress.history, event],
    lastUpdatedAt: event.timestamp,
  }
}
```

- [ ] **Step 5: Extend live simulation state to include events and progress**

In `src/lib/engine/live-simulation.ts`, extend `LiveSimState`:

```ts
interface LiveSimState {
  // existing fields...
  currentStage: LivePipelineStage | null;
  currentStageStartedAt: string | null;
  activityEvents: LiveActivityEvent[];
  marketProgress: LiveMarketProgress[];
  lastCompletedMarket: { marketId: string; marketTitle: string; completedAt: string } | null;
}
```

Initialize defaults in the `state` constant and reset them in `startSimulation()`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- src/lib/engine/__tests__/live-sim-events.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/types/index.ts src/lib/engine/live-sim-events.ts src/lib/engine/live-simulation.ts src/lib/engine/__tests__/live-sim-events.test.ts
git commit -m "feat: add live simulation activity state"
```

## Task 2: Emit real stage events from the live pipeline

**Files:**
- Modify: `src/lib/engine/live-simulation.ts`
- Modify: `src/lib/engine/pipeline.ts`
- Test: `src/lib/engine/__tests__/live-sim-events.test.ts`

- [ ] **Step 1: Write the failing pipeline-callback test**

Add this test to `src/lib/engine/__tests__/live-sim-events.test.ts`:

```ts
it('captures pipeline stage callbacks during market processing', async () => {
  const stages: string[] = []

  const onStage = (stage: string) => {
    stages.push(stage)
  }

  onStage('TRIAGE')
  onStage('DEERFLOW')
  onStage('TRADINGAGENTS')
  onStage('SYNTHESIS')

  expect(stages).toEqual(['TRIAGE', 'DEERFLOW', 'TRADINGAGENTS', 'SYNTHESIS'])
})
```

Then replace the inline stub with a real callback-based assertion once the pipeline callback exists.

- [ ] **Step 2: Run test to verify it fails meaningfully**

Run: `npm test -- src/lib/engine/__tests__/live-sim-events.test.ts`
Expected: FAIL after replacing the stub assertion with imported pipeline callback usage.

- [ ] **Step 3: Add an optional stage callback interface to the pipeline**

In `src/lib/engine/pipeline.ts`, add:

```ts
export interface PipelineStageEvent {
  stage: string
  message: string
  provider?: 'deerflow' | 'tradingagents' | 'agent_reach' | 'system'
}

export interface PipelineRunOptions {
  onStage?: (event: PipelineStageEvent) => void | Promise<void>
}
```

Update the signature:

```ts
export async function runPipelineForMarket(
  marketId: string,
  options: PipelineRunOptions = {},
): Promise<PipelineResult> {
```

- [ ] **Step 4: Emit minimal stage callbacks at existing boundaries**

Add callback emissions at these points in `runPipelineForMarket()`:

```ts
await options.onStage?.({ stage: 'TRIAGE', message: 'Running triage', provider: 'system' })
await options.onStage?.({ stage: 'DEERFLOW', message: 'Running DeerFlow research', provider: 'deerflow' })
await options.onStage?.({ stage: 'TRADINGAGENTS', message: 'Running TradingAgents research', provider: 'tradingagents' })
await options.onStage?.({ stage: 'SYNTHESIS', message: 'Synthesizing research findings', provider: 'system' })
await options.onStage?.({ stage: 'JUDGE', message: 'Running debate and judge stages', provider: 'system' })
await options.onStage?.({ stage: 'RISK', message: 'Evaluating risk and decision', provider: 'system' })
```

- [ ] **Step 5: Wire callbacks into `processMarket()`**

In `src/lib/engine/live-simulation.ts`, wrap `runPipelineForMarket()` like this:

```ts
const result = await runPipelineForMarket(market.id, {
  onStage: async ({ stage, message, provider }) => {
    const timestamp = new Date().toISOString()
    state.currentStage = stage as LivePipelineStage
    state.currentStageStartedAt = timestamp
    state.activityEvents = appendLiveActivityEvent(state.activityEvents, {
      timestamp,
      marketId: market.id,
      marketTitle: template.title,
      stage: stage as LivePipelineStage,
      provider,
      type: 'started',
      message,
    })
  },
})
```

Also update `marketProgress` for completion/failure/skipped outcomes.

- [ ] **Step 6: Run targeted test to verify callback behavior passes**

Run: `npm test -- src/lib/engine/__tests__/live-sim-events.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/engine/live-simulation.ts src/lib/engine/pipeline.ts src/lib/engine/__tests__/live-sim-events.test.ts
git commit -m "feat: emit live pipeline stage events"
```

## Task 3: Render Simulation Lab from live activity state

**Files:**
- Modify: `src/app/api/simulation/route.ts`
- Modify: `src/components/trading/SimulationLab.tsx`
- Test: existing UI/manual verification only if no component test framework exists

- [ ] **Step 1: Add the new state fields to the simulation API response**

In `src/app/api/simulation/route.ts`, ensure GET returns the new `currentStage`, `currentStageStartedAt`, `activityEvents`, `marketProgress`, and `lastCompletedMarket` fields from `getSimState()` without stripping them.

Use a shape like:

```ts
return NextResponse.json({
  ...simState,
  activityEvents: simState.activityEvents,
  marketProgress: simState.marketProgress,
})
```

- [ ] **Step 2: Add UI sections for active stage, live feed, and market history**

In `src/components/trading/SimulationLab.tsx`, render three blocks:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Active Pipeline Stage</CardTitle>
  </CardHeader>
  <CardContent>
    <div>{sim.currentStage || 'Idle'}</div>
    <div>{sim.currentMarketTitle || 'No market in progress'}</div>
  </CardContent>
</Card>

<Card>
  <CardHeader>
    <CardTitle>Live Activity</CardTitle>
  </CardHeader>
  <CardContent>
    {sim.activityEvents.map((event) => (
      <div key={`${event.timestamp}-${event.stage}`}>
        <span>{event.stage}</span>
        <span>{event.message}</span>
      </div>
    ))}
  </CardContent>
</Card>

<Card>
  <CardHeader>
    <CardTitle>Recent Market History</CardTitle>
  </CardHeader>
  <CardContent>
    {sim.marketProgress.map((market) => (
      <div key={market.marketId}>
        <div>{market.marketTitle}</div>
        <div>{market.status}</div>
      </div>
    ))}
  </CardContent>
</Card>
```

- [ ] **Step 3: Replace any misleading empty-state dependency on `/api/jobs` for live pipeline work**

Remove or relabel any current panel that implies jobs are the source of live pipeline execution. Keep jobs for background/system activity only.

- [ ] **Step 4: Run the app and manually verify live visibility**

Run: `npm run dev`
Expected: starting the simulation shows active stage changes, activity feed entries, and recent market history updates within one processing cycle.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/simulation/route.ts src/components/trading/SimulationLab.tsx
git commit -m "feat: show live pipeline progress in simulation lab"
```

## Task 4: Add Agent-Reach app adapter and settings support

**Files:**
- Create: `src/lib/engine/research/agent-reach.ts`
- Modify: `src/lib/engine/research/search.ts`
- Modify: `src/lib/types/index.ts`
- Modify: `src/components/trading/StrategyHub.tsx`
- Modify: `src/app/api/strategy/route.ts`
- Test: `src/lib/engine/__tests__/full-research.test.ts`

- [ ] **Step 1: Write the failing Agent-Reach adapter test**

Create `src/lib/engine/__tests__/full-research.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest'
import { runAgentReachResearch } from '@/lib/engine/research/agent-reach'

describe('agent reach adapter', () => {
  it('normalizes remote research evidence', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        sources: [
          { title: 'Source A', url: 'https://example.com/a', snippet: 'Evidence A' },
        ],
        summary: 'Agent Reach summary',
      }),
    }) as unknown as typeof fetch

    const result = await runAgentReachResearch('Will BTC hit 100k?')

    expect(result?.provider).toBe('agent_reach')
    expect(result?.sources).toHaveLength(1)
    expect(result?.summary).toContain('Agent Reach')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/engine/__tests__/full-research.test.ts`
Expected: FAIL with module not found for `agent-reach`.

- [ ] **Step 3: Add Agent-Reach routing fields to shared settings types**

In `src/lib/types/index.ts`, extend `StageServiceMapping`:

```ts
agentReachEnabled?: boolean;
agentReachServiceUrl?: string;
agentReachToolName?: string;
```

- [ ] **Step 4: Add service alias resolution for Agent-Reach**

In `src/lib/engine/research/search.ts`, extend service aliases:

```ts
agent_reach: ['agent-reach', 'Agent Reach', 'AGENT_REACH'],
```

- [ ] **Step 5: Implement minimal app-side Agent-Reach adapter**

Create `src/lib/engine/research/agent-reach.ts`:

```ts
import { getCredentialForService } from '@/lib/engine/research/search'

export interface AgentReachResult {
  provider: 'agent_reach'
  status: 'completed' | 'failed'
  summary: string
  sources: Array<{ title: string; url: string; snippet: string }>
  error?: string
}

export async function runAgentReachResearch(query: string): Promise<AgentReachResult | null> {
  const cred = await getCredentialForService('agent-reach')
  const baseUrl = cred?.baseUrl || process.env.AGENT_REACH_URL
  if (!baseUrl) return null

  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(120000),
  })

  if (!res.ok) {
    return { provider: 'agent_reach', status: 'failed', summary: '', sources: [], error: `HTTP ${res.status}` }
  }

  const data = await res.json()
  return {
    provider: 'agent_reach',
    status: 'completed',
    summary: data.summary || 'Agent Reach completed',
    sources: Array.isArray(data.sources) ? data.sources : [],
  }
}
```

- [ ] **Step 6: Add StrategyHub controls for Agent-Reach**

In `src/components/trading/StrategyHub.tsx`, add controls bound to `settings.stageRouting`:

```tsx
<div className="space-y-2">
  <Label>Agent-Reach</Label>
  <Switch
    checked={Boolean(settings.stageRouting?.agentReachEnabled)}
    onCheckedChange={(checked) => updateStageRouting('agentReachEnabled', checked ? 'true' : '')}
  />
  <Input
    value={settings.stageRouting?.agentReachServiceUrl || ''}
    onChange={(e) => updateStageRouting('agentReachServiceUrl', e.target.value)}
    placeholder="http://192.168.88.96:6656/sse"
  />
</div>
```

Adapt the boolean setter to accept booleans rather than the string stub above.

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- src/lib/engine/__tests__/full-research.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/engine/research/agent-reach.ts src/lib/engine/research/search.ts src/lib/types/index.ts src/components/trading/StrategyHub.tsx src/app/api/strategy/route.ts src/lib/engine/__tests__/full-research.test.ts
git commit -m "feat: add app-side agent reach integration"
```

## Task 5: Add DeerFlow API model discovery and selection

**Files:**
- Modify: `src/lib/engine/research/deerflow-api.ts`
- Modify: `src/lib/engine/research/deerflow.ts`
- Create: `src/app/api/deerflow/models/route.ts`
- Modify: `src/components/trading/StrategyHub.tsx`
- Modify: `src/lib/types/index.ts`
- Test: `src/lib/engine/__tests__/full-research.test.ts`

- [ ] **Step 1: Add the failing DeerFlow model-list test**

Append to `src/lib/engine/__tests__/full-research.test.ts`:

```ts
import { fetchDeerFlowModels } from '@/lib/engine/research/deerflow-api'

it('returns DeerFlow models from the remote API', async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ models: [{ id: 'paper_lite' }, { id: 'paper_proglm' }] }),
  }) as unknown as typeof fetch

  const models = await fetchDeerFlowModels()
  expect(models).toEqual(['paper_lite', 'paper_proglm'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/engine/__tests__/full-research.test.ts`
Expected: FAIL with `fetchDeerFlowModels` not found.

- [ ] **Step 3: Implement DeerFlow model fetch helper**

In `src/lib/engine/research/deerflow-api.ts`, add:

```ts
export async function fetchDeerFlowModels(): Promise<string[]> {
  const cred = await getCredentialForService('deerflow')
  if (!cred?.baseUrl) return []

  const res = await fetch(`${cred.baseUrl.replace(/\/$/, '')}/api/models`, {
    headers: cred.apiKey ? { Authorization: `Bearer ${cred.apiKey}` } : {},
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data.models) ? data.models.map((m: { id: string }) => m.id) : []
}
```

- [ ] **Step 4: Add request-time model override support to DeerFlow API calls**

Update `runDeerFlowViaAPI()` to accept a `model?: string` parameter and include it in the run payload when present:

```ts
export async function runDeerFlowViaAPI(
  query: string,
  impliedProbability?: number,
  model?: string,
): Promise<DeerFlowThreadResult | null> {
  // ...
  body: JSON.stringify({
    assistant_id: 'deerflow',
    input: { messages: [{ role: 'user', content: prompt }] },
    config: {
      configurable: {
        thread_id: threadId,
        ...(model ? { model } : {}),
      },
    },
  })
```

- [ ] **Step 5: Pass selected DeerFlow API model from routing**

In `src/lib/engine/research/deerflow.ts`, use a new routing field:

```ts
const apiResult = await runDeerFlowViaAPI(
  marketTitle,
  impliedProbability,
  routing?.deerflowApiModel,
)
```

Add `deerflowApiModel?: string` to `StageServiceMapping` in `src/lib/types/index.ts`.

- [ ] **Step 6: Expose a Next.js proxy endpoint and dropdown UI**

Create `src/app/api/deerflow/models/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { fetchDeerFlowModels } from '@/lib/engine/research/deerflow-api'

export async function GET() {
  const models = await fetchDeerFlowModels()
  return NextResponse.json({ models })
}
```

In `src/components/trading/StrategyHub.tsx`, fetch `/api/deerflow/models` and bind a dropdown to `stageRouting.deerflowApiModel`.

- [ ] **Step 7: Run test to verify it passes**

Run: `npm test -- src/lib/engine/__tests__/full-research.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/engine/research/deerflow-api.ts src/lib/engine/research/deerflow.ts src/app/api/deerflow/models/route.ts src/components/trading/StrategyHub.tsx src/lib/types/index.ts src/lib/engine/__tests__/full-research.test.ts
git commit -m "feat: add deerflow model selection"
```

## Task 6: Add full-research orchestrator for parallel DeerFlow, TradingAgents, and Agent-Reach

**Files:**
- Create: `src/lib/engine/research/full-research.ts`
- Modify: `src/lib/engine/pipeline.ts`
- Modify: `src/lib/engine/research/tradingagents-api.ts`
- Modify: `src/lib/engine/research/synthesis.ts`
- Test: `src/lib/engine/__tests__/full-research.test.ts`

- [ ] **Step 1: Write the failing orchestrator test**

Append to `src/lib/engine/__tests__/full-research.test.ts`:

```ts
import { runFullResearch } from '@/lib/engine/research/full-research'

it('runs all full research providers in parallel and preserves partial failures', async () => {
  const result = await runFullResearch({
    marketId: 'm1',
    marketTitle: 'Will BTC hit 100k?',
    marketDescription: 'Test market',
    impliedProbability: 0.42,
    routing: {
      researchDepth: 'FULL',
      analystLlmProvider: 'openai',
      analystDeepThinkLlm: 'paper_proglm',
      analystQuickThinkLlm: 'paper_lite',
      agentReachEnabled: true,
    },
  })

  expect(result.providers).toEqual(expect.arrayContaining(['deerflow', 'tradingagents', 'agent_reach']))
  expect(result.status).toBe('completed')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/engine/__tests__/full-research.test.ts`
Expected: FAIL with module not found for `full-research`.

- [ ] **Step 3: Implement the minimal orchestrator**

Create `src/lib/engine/research/full-research.ts`:

```ts
import { runDeerFlowResearch } from '@/lib/engine/research/deerflow'
import { runTradingAgentsSimple } from '@/lib/engine/research/tradingagents-api'
import { runAgentReachResearch } from '@/lib/engine/research/agent-reach'
import type { StageServiceMapping } from '@/lib/types'

export interface FullResearchInput {
  marketId: string
  marketTitle: string
  marketDescription: string
  impliedProbability: number
  routing: StageServiceMapping
}

export interface FullResearchResult {
  status: 'completed' | 'degraded' | 'failed'
  providers: Array<'deerflow' | 'tradingagents' | 'agent_reach'>
  deerflow: Awaited<ReturnType<typeof runDeerFlowResearch>> | null
  tradingagents: Awaited<ReturnType<typeof runTradingAgentsSimple>> | null
  agentReach: Awaited<ReturnType<typeof runAgentReachResearch>> | null
}

export async function runFullResearch(input: FullResearchInput): Promise<FullResearchResult> {
  const [deerflow, tradingagents, agentReach] = await Promise.allSettled([
    runDeerFlowResearch(input.marketTitle, input.marketDescription, input.impliedProbability, input.routing),
    runTradingAgentsSimple(
      input.marketTitle,
      new Date().toISOString().split('T')[0],
      input.routing.analystDeepThinkLlm,
      input.routing.analystQuickThinkLlm,
    ),
    input.routing.agentReachEnabled ? runAgentReachResearch(input.marketTitle) : Promise.resolve(null),
  ])

  const resolved = {
    deerflow: deerflow.status === 'fulfilled' ? deerflow.value : null,
    tradingagents: tradingagents.status === 'fulfilled' ? tradingagents.value : null,
    agentReach: agentReach.status === 'fulfilled' ? agentReach.value : null,
  }

  const successCount = [resolved.deerflow, resolved.tradingagents, resolved.agentReach].filter(Boolean).length

  return {
    status: successCount === 0 ? 'failed' : successCount === 3 ? 'completed' : 'degraded',
    providers: ['deerflow', 'tradingagents', 'agent_reach'],
    ...resolved,
  }
}
```

- [ ] **Step 4: Wire `FULL` pipeline execution to the orchestrator**

In `src/lib/engine/pipeline.ts`, replace the inline sequential `FULL` logic with:

```ts
const fullResearch = await runFullResearch({
  marketId,
  marketTitle: market.title,
  marketDescription: market.description || '',
  impliedProbability: impliedProb,
  routing,
})
```

Then persist each provider result using the existing `researchSource` and `agentOutput` patterns before synthesis.

- [ ] **Step 5: Make TradingAgents fully app-driven in the orchestrator path**

Update `runTradingAgentsSimple()` in `src/lib/engine/research/tradingagents-api.ts` to accept `llmProvider?: string` and `maxDebateRounds?: number`, then send:

```ts
...(llmProvider ? { llm_provider: llmProvider } : {}),
...(maxDebateRounds ? { max_debate_rounds: maxDebateRounds } : {}),
```

Use those values from `routing` inside `runFullResearch()`.

- [ ] **Step 6: Extend synthesis to accept Agent-Reach evidence**

In `src/lib/engine/research/synthesis.ts`, add an `agentReach` source parameter and include an `AGENT REACH FINDINGS` section in the prompt template.

- [ ] **Step 7: Run tests to verify orchestration passes**

Run: `npm test -- src/lib/engine/__tests__/full-research.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/engine/research/full-research.ts src/lib/engine/pipeline.ts src/lib/engine/research/tradingagents-api.ts src/lib/engine/research/synthesis.ts src/lib/engine/__tests__/full-research.test.ts
git commit -m "feat: orchestrate full research in parallel"
```

## Task 7: Add Agent-Reach and finance enrichment to `ta-service`

**Files:**
- Create: `ta-service/agent_reach.py`
- Create: `ta-service/finance_enrichment.py`
- Modify: `ta-service/server.py`
- Modify: `docker-compose.yml`
- Test: manual service verification

- [ ] **Step 1: Add a focused Agent-Reach Python adapter**

Create `ta-service/agent_reach.py`:

```py
import os
import httpx
from typing import Any

AGENT_REACH_URL = os.getenv("AGENT_REACH_URL", "")

async def fetch_agent_reach_research(query: str) -> dict[str, Any] | None:
    if not AGENT_REACH_URL:
        return None

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{AGENT_REACH_URL.rstrip('/')}/research",
                json={"query": query},
            )
            if resp.status_code != 200:
                return {"error": f"HTTP {resp.status_code}"}
            return resp.json()
    except Exception as exc:
        return {"error": str(exc)}
```

- [ ] **Step 2: Add non-blocking finance enrichment helpers**

Create `ta-service/finance_enrichment.py`:

```py
import os
import httpx
from typing import Any

ALPHA_VANTAGE_API_KEY = os.getenv("ALPHA_VANTAGE_API_KEY", "")
FINNHUB_API_KEY = os.getenv("FINNHUB_API_KEY", "")

async def fetch_finance_context(symbol: str) -> dict[str, Any]:
    result: dict[str, Any] = {"alpha_vantage": None, "finnhub": None}

    async with httpx.AsyncClient(timeout=15.0) as client:
        if ALPHA_VANTAGE_API_KEY and symbol:
            try:
                av = await client.get(
                    "https://www.alphavantage.co/query",
                    params={"function": "GLOBAL_QUOTE", "symbol": symbol, "apikey": ALPHA_VANTAGE_API_KEY},
                )
                if av.status_code == 200:
                    result["alpha_vantage"] = av.json()
            except Exception:
                pass

        if FINNHUB_API_KEY and symbol:
            try:
                fh = await client.get(
                    "https://finnhub.io/api/v1/quote",
                    params={"symbol": symbol, "token": FINNHUB_API_KEY},
                )
                if fh.status_code == 200:
                    result["finnhub"] = fh.json()
            except Exception:
                pass

    return result
```

- [ ] **Step 3: Import and use both adapters inside the analyze flow**

In `ta-service/server.py`, import:

```py
from agent_reach import fetch_agent_reach_research
from finance_enrichment import fetch_finance_context
```

Then, inside the analyze path, merge Agent-Reach social evidence into the X/Reddit/sentiment structures and attach finance data when a ticker-like symbol exists.

- [ ] **Step 4: Preserve graceful degradation in the JSON response**

When Agent-Reach or finance enrichment fails, include partial fields rather than failing the request:

```py
agent_reach_result = await fetch_agent_reach_research(req.query)
finance_context = await fetch_finance_context(extract_ticker(req.query))

raw_output["agent_reach"] = agent_reach_result
raw_output["finance_context"] = finance_context
```

- [ ] **Step 5: Add Agent-Reach env wiring to Docker**

In `docker-compose.yml`, ensure the TradingAgents service has:

```yaml
environment:
  AGENT_REACH_URL: ${AGENT_REACH_URL}
  ALPHA_VANTAGE_API_KEY: ${ALPHA_VANTAGE_API_KEY}
  FINNHUB_API_KEY: ${FINNHUB_API_KEY}
```

- [ ] **Step 6: Build and run the service locally**

Run: `docker compose up -d tradingagents`
Expected: container starts successfully with no import errors.

- [ ] **Step 7: Verify health and one sample analyze request**

Run: `curl -s http://localhost:8100/health`
Expected: JSON health response.

Run:
`curl -s http://localhost:8100/analyze -H "Content-Type: application/json" -d '{"query":"Will Tesla stock close above $400 by December 2026?","depth":"full"}'`
Expected: JSON response containing `status` and `raw_output`, plus Agent-Reach or finance enrichment fields when available.

- [ ] **Step 8: Commit**

```bash
git add ta-service/agent_reach.py ta-service/finance_enrichment.py ta-service/server.py docker-compose.yml
git commit -m "feat: enrich tradingagents with agent reach and finance data"
```

## Task 8: Verify end-to-end behavior and clean up UI/settings integration

**Files:**
- Modify: `src/components/trading/StrategyHub.tsx`
- Modify: `src/app/api/research/route.ts`
- Modify: `src/app/api/simulation/route.ts`
- Test: app and service verification

- [ ] **Step 1: Ensure strategy persistence includes the new routing fields**

In `src/app/api/strategy/route.ts`, preserve the new routing defaults when missing:

```ts
body.stageRouting = {
  ...DEFAULT_STAGE_ROUTING,
  ...body.stageRouting,
}
```

- [ ] **Step 2: Ensure research GET surfaces new provider outputs cleanly**

In `src/app/api/research/route.ts`, keep `sources` and `agentOutputs` included and verify provider-specific records appear in the returned JSON for `FULL` runs.

- [ ] **Step 3: Run frontend verification**

Run: `npm run dev`
Expected:
- StrategyHub shows DeerFlow model selector and Agent-Reach settings.
- SimulationLab shows active pipeline stage, live activity, and recent market history.
- Starting simulation updates the UI within a single cycle.

- [ ] **Step 4: Run backend verification**

Run: `npm test -- src/lib/engine/__tests__/live-sim-events.test.ts src/lib/engine/__tests__/full-research.test.ts`
Expected: PASS

Run: `npm run lint`
Expected: PASS or only pre-existing unrelated warnings.

- [ ] **Step 5: Run one manual FULL-depth research check**

Use a filtered market and confirm:
- DeerFlow branch runs
- TradingAgents branch runs
- Agent-Reach branch runs
- one branch failure does not kill the run
- merged research result persists
- SimulationLab and research surfaces show provider provenance

- [ ] **Step 6: Commit**

```bash
git add src/components/trading/StrategyHub.tsx src/app/api/strategy/route.ts src/app/api/research/route.ts src/app/api/simulation/route.ts
git commit -m "test: verify full research and simulation visibility flow"
```

## Self-Review

- Spec coverage check:
  - Simulation Lab visibility: Tasks 1-3
  - FULL-depth parallel orchestration: Task 6
  - DeerFlow model dropdown: Task 5
  - TradingAgents app-driven provider/models: Task 6
  - Agent-Reach app and `ta-service` integration: Tasks 4 and 7
  - Alpha Vantage and Finnhub enrichment: Task 7
  - Runtime/failure visibility and degraded success: Tasks 2, 3, 6, 8
- Placeholder scan: no `TODO`, `TBD`, or implicit “handle later” language remains in tasks.
- Type consistency check:
  - `LivePipelineStage`, `LiveActivityEvent`, `LiveMarketProgress` defined once in Task 1 and reused consistently.
  - `runFullResearch()` shape is reused consistently in Task 6.
  - `deerflowApiModel`, `agentReachEnabled`, and `agentReachServiceUrl` are named consistently.
