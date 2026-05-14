# 2026-04-19 Full Research and Pipeline Visibility Design

## Goal

Implement three related upgrades in the trading command center:

1. Make the Simulation Lab visibly show live pipeline execution instead of appearing idle.
2. Make `Research Depth = FULL` run all deep-research providers in parallel for filtered trades.
3. Expand provider control so the app can drive DeerFlow models, TradingAgents models/provider, and Agent-Reach integration from the app.

## Scope

This design covers:

- Simulation Lab live execution visibility
- Research orchestration for filtered trades
- DeerFlow integration and app-controlled model selection
- TradingAgents integration and app-controlled provider/model overrides
- Agent-Reach integration in both the app and `ta-service`
- Optional finance enrichment in `ta-service` using Alpha Vantage and Finnhub keys already present in env

This design does not cover:

- New market venues
- Light-mode UI
- Replacing the current overall pipeline architecture
- Making all scanned markets run full deep research

## Requirements

### Functional

- When the user starts the live pipeline, the GUI must show which stage is active and which market is being processed.
- The Simulation Lab must show a live activity feed and recent market history with timestamps, outcomes, skips, failures, and completions.
- `Research Depth = FULL` must run all of the following for filtered trades:
  - DeerFlow
  - TradingAgents
  - Agent-Reach
- TradingAgents must also be able to use Agent-Reach-derived social evidence internally where applicable.
- DeerFlow API model selection must be app-driven when the DeerFlow API supports model override.
- DeerFlow model options should come from a DeerFlow API models endpoint when available, otherwise from configured fallback options.
- TradingAgents must remain app-driven for:
  - `llm_provider`
  - `deep_think_llm`
  - `quick_think_llm`
  - `max_debate_rounds`
- Agent-Reach must be configurable from the app as a server-side research source.
- A single `FULL` research run for one filtered trade should target `10-15` minutes.

### Non-functional

- One research provider failing must not collapse the whole full-depth run.
- The user must be able to tell from the UI what is running, stuck, failed, or completed.
- MCP details for Agent-Reach must stay isolated behind a narrow adapter.
- Deep research should run only for filtered/high-priority trades, not every scanned market.

## Current Problems

### Simulation Lab visibility

- The backend reports coarse `currentAgent` values like `PIPELINE` and `RESOLUTION_CHECK`, while the UI expects more explicit named stages.
- The live activity panel uses `/api/jobs`, but live simulation does not emit `Job` rows for its internal work, so the panel looks empty.
- The main pipeline work happens inside an opaque `runPipelineForMarket()` flow, so the UI receives almost no stage-by-stage progress.

### Research orchestration

- TradingAgents `/analyze` is already sent `depth: 'full'`, but the rest of the app does not orchestrate `FULL` as a coordinated multi-provider fan-out.
- DeerFlow has separate local iteration and depth knobs, but there is no system-wide definition tying `Research Depth = FULL` to DeerFlow, TradingAgents, and Agent-Reach together.
- Agent-Reach is not yet integrated as an app-side provider or a `ta-service` enrichment source.

### Provider control

- TradingAgents service already supports dynamic request fields for provider and models, but the app only partially exploits that capability.
- DeerFlow currently supports a local model choice and an API fallback path, but model discovery and API-driven dropdown selection are not yet fully exposed in the UI.
- Alpha Vantage and Finnhub keys exist in env and Docker config, but the local `ta-service` does not consume them yet.

## Proposed Architecture

## 1. Live Pipeline Visibility

Add explicit live execution state to `src/lib/engine/live-simulation.ts`.

### New runtime state

- `currentStage`
- `currentStageStartedAt`
- `currentMarketId`
- `currentMarketTitle`
- `activityEvents[]`
- `marketProgress[]`
- `lastCompletedMarket`

### Stage model

Use explicit named stages that match the UI:

- `SCAN`
- `TRIAGE`
- `DEERFLOW`
- `TRADINGAGENTS`
- `AGENT_REACH`
- `SYNTHESIS`
- `JUDGE`
- `RISK`
- `DECISION`
- `RESOLUTION_CHECK`

The internal pipeline should emit these stages through lightweight callbacks or event helpers instead of the UI trying to infer them from coarse agent state.

### UI updates

Update `src/components/trading/SimulationLab.tsx` to render:

- active stage strip from `currentStage`
- live activity feed from `activityEvents`
- recent market history from `marketProgress`
- explicit failed, skipped, running, and completed states

The UI must not rely on `/api/jobs` alone for live simulation activity.

## 2. Research Depth Semantics

`Research Depth = FULL` means:

- run DeerFlow as one deep research branch
- run TradingAgents as one deep research branch
- run Agent-Reach as one deep research branch
- also allow TradingAgents to pull Agent-Reach-derived social/discussion evidence internally where applicable
- merge outputs into one final synthesis payload for judge and research surfaces

`FULL` only applies to filtered trades that pass triage/risk escalation thresholds.

## 3. Full Research Orchestrator

Add a server-side orchestrator responsible for full-depth fan-out/fan-in for filtered trades.

### Responsibilities

- decide whether a market escalates to `FULL`
- launch DeerFlow, TradingAgents, and Agent-Reach in parallel
- track start, progress, completion, failure, and timeout per provider
- preserve partial results when one or more providers fail
- merge normalized results into one synthesis payload
- emit activity events for Simulation Lab visibility

### Runtime budget

For one filtered trade under `FULL`:

- target completion: `10-15 minutes`
- soft warning: over `15 minutes`
- partial-complete cutoff: around `18-20 minutes`

A provider timeout should produce degraded but usable final output if other providers succeeded.

## 4. DeerFlow Integration

### Model control

The app should support DeerFlow API model selection from `StrategyHub`.

#### Preferred behavior

- fetch model list from DeerFlow API if a models endpoint exists
- show those models in a dropdown
- store selected DeerFlow API model in strategy settings or stage routing
- pass selected model on DeerFlow API requests

#### Fallback behavior

If DeerFlow API does not expose model discovery:

- show a configured fallback list in the dropdown
- still send the selected model when request-time override is supported
- if DeerFlow API does not support request-time model override, surface that limitation and use server default

### Execution behavior

For `FULL`, DeerFlow should use deeper settings-derived effort:

- `deerflowSearchIterations`
- `deerflowQuestionsPerIteration`
- `deerflowMaxDepth`

Remote DeerFlow API remains preferred when available. Local iterative DeerFlow remains the fallback.

## 5. TradingAgents Integration

TradingAgents remains one of the main deep-research branches.

### App-driven controls

The app should send and control:

- `llm_provider`
- `deep_think_llm`
- `quick_think_llm`
- `max_debate_rounds`
- full-depth mode

### Agent-Reach internal enrichment

Inside `ta-service`, TradingAgents social/research stages should be able to consume:

- existing SearXNG-based X/Twitter results
- existing Reddit/public fallback results
- Agent-Reach-derived social/discussion evidence when available

This should happen behind an internal adapter layer so the rest of TradingAgents logic uses normalized evidence rather than raw MCP responses.

## 6. Agent-Reach Integration

Agent-Reach is integrated in two places.

### App-side provider

The app gets a new configurable research provider entry for Agent-Reach.

Expected configuration:

- service alias: `agent-reach`
- base URL / SSE endpoint: `http://192.168.88.96:6656/sse`

The app will use a server-side adapter to call Agent-Reach tools and normalize output into common research-source structures.

### `ta-service` enrichment adapter

Add a Python adapter module in `ta-service` for Agent-Reach.

Responsibilities:

- connect to MCP SSE endpoint
- inspect and call supported research/social tools
- normalize results into the TradingAgents evidence format
- fail gracefully when MCP tools are unreachable or incomplete

Agent-Reach protocol details must stay isolated in this adapter.

## 7. Finance Enrichment

Since `ALPHA_VANTAGE_API_KEY` and `FINNHUB_API_KEY` are already configured, `ta-service` should grow optional finance enrichment adapters.

### Usage

Use them only when relevant to a market or tradable proxy, for example:

- equities and ETFs
- crypto assets with proxy signals
- macro/politics markets where public company or market proxies improve evidence quality

### Constraints

- optional, not mandatory
- should not block completion if vendor APIs fail
- should enrich `FULL` research, not replace the core research branches

## Data Model Changes

### Strategy settings / routing

Extend settings and/or stage routing with fields for:

- `researchDepth`
- `deerflowApiModel`
- `agentReachEnabled`
- `agentReachServiceUrl` or service-based credential resolution
- `fullResearchTargetMinutes` only if runtime tuning needs to be user-visible
- existing TradingAgents controls remain in stage routing:
  - `analystLlmProvider`
  - `analystDeepThinkLlm`
  - `analystQuickThinkLlm`
  - `analystMaxDebateRounds`

### Research results

Normalized provider result should include:

- `provider`
- `status`
- `startedAt`
- `completedAt`
- `durationMs`
- `sources[]`
- `summary`
- `keyFindings[]`
- `contradictions[]`
- `errors[]`

### Simulation activity events

Each event should include:

- `timestamp`
- `marketId`
- `marketTitle`
- `stage`
- `provider` if applicable
- `type` such as `started`, `progress`, `completed`, `failed`, `skipped`, `timeout`
- `message`

## Data Flow

For one filtered trade with `Research Depth = FULL`:

1. Market passes scan and triage.
2. Escalation logic marks it eligible for `FULL`.
3. Orchestrator emits a `FULL research started` activity event.
4. Orchestrator launches in parallel:
   - DeerFlow
   - TradingAgents
   - Agent-Reach
5. Each branch emits progress events.
6. TradingAgents internally enriches social evidence with Agent-Reach data when available.
7. DeerFlow runs remote API with app-selected model if available, otherwise local fallback.
8. Agent-Reach returns normalized evidence from its available MCP tools.
9. Orchestrator waits up to runtime budget.
10. Successful and partial results are merged into a synthesis payload.
11. Judge and downstream risk stages consume the merged synthesis payload.
12. Simulation Lab shows the final market status and the full activity trail.

## Failure Handling

### Research branches

- If DeerFlow fails, keep TradingAgents and Agent-Reach results.
- If TradingAgents fails, keep DeerFlow and Agent-Reach results.
- If Agent-Reach fails, keep DeerFlow and TradingAgents results.
- If only one branch succeeds, return degraded success with provenance.
- If all branches fail, mark the trade research failed and surface actionable error detail.

### UI behavior

The UI should show exactly:

- which provider is running
- which provider succeeded
- which provider failed
- which provider timed out
- which evidence was used in the final synthesis

## Testing and Verification

### Simulation visibility

- starting live pipeline updates active stage promptly
- activity feed populates without relying on jobs table
- per-market history shows success, skip, failure, and timestamps

### Research orchestration

- `FULL` launches all three branches in parallel
- partial failures still produce merged degraded results
- timeout budget is enforced
- merged synthesis includes provider provenance

### DeerFlow

- model dropdown loads from DeerFlow API when available
- fallback list works when model discovery is unavailable
- selected model is passed correctly when supported

### TradingAgents

- provider/model/debate overrides are passed from app settings
- Agent-Reach enrichment path does not break existing Reddit/SearXNG behavior

### Agent-Reach

- app-side credential/config resolution works
- MCP transport failures are handled gracefully
- normalized outputs are persisted and rendered correctly

### Finance enrichment

- Alpha Vantage and Finnhub are used only when relevant
- vendor failures do not fail the full run

## Implementation Plan

1. Add explicit live simulation event/state model and wire Simulation Lab to it.
2. Add normalized full-research orchestrator for filtered trades.
3. Add app-side Agent-Reach credential/config support and adapter.
4. Extend `ta-service` with Agent-Reach enrichment adapter.
5. Extend `ta-service` with optional Alpha Vantage and Finnhub enrichment.
6. Expose DeerFlow API model discovery and selection in app settings.
7. Ensure TradingAgents request plumbing sends app-driven provider/model/debate settings consistently.
8. Add verification for visibility, full parallel execution, provider failures, and timeout behavior.

## Key Decisions

- `FULL` means all deep providers run, not just one.
- Full-depth research is for filtered trades only.
- Target runtime for one filtered trade under `FULL` is `10-15 minutes`.
- Agent-Reach is both a standalone branch and a TradingAgents enrichment source.
- MCP protocol details stay inside adapters, not business logic.
- UI must expose real execution state rather than infer it indirectly.
