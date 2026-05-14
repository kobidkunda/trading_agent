# 2026-04-19 Research Transparency and Live Metadata Design

## Goal

Implement two connected improvements across the trading command center:

1. Replace hardcoded/manual DeerFlow and TradingAgents model/provider entry in StrategyHub with real-data dropdowns backed by live metadata.
2. Make Simulation Lab, Market Triage, and Research Ledger expose full per-stage research transparency, including service names, exact outputs, timings, failures, debate reasoning, and source provenance.

## Scope

This design covers:

- DeerFlow API model dropdown in StrategyHub
- TradingAgents provider/deep/quick model dropdowns in StrategyHub
- Metadata endpoints needed to power those dropdowns
- Simulation Lab live stage transparency
- Market Triage detailed research packet rendering
- Research Ledger deep audit rendering
- Contradiction, Judge, and debate-result transparency
- Shared normalized data shape for per-stage outputs across pages

This design does not cover:

- New provider execution logic beyond metadata lookup
- New trading venues
- Replacing the current pipeline architecture
- Unrelated StrategyHub sections

## Requirements

### Functional

- DeerFlow API model must be selected from a real-data dropdown in StrategyHub.
- TradingAgents provider must be selected from a real-data dropdown in StrategyHub.
- TradingAgents deep model must be selected from a real-data dropdown in StrategyHub.
- TradingAgents quick model must be selected from a real-data dropdown in StrategyHub.
- TradingAgents dropdown data must come from:
  1. TradingAgents-native metadata first
  2. `/api/llm/models` fallback second
- DeerFlow dropdown data must come from `/api/deerflow/models`.
- Saved StrategyHub values must remain visible when current metadata no longer contains them.
- Simulation Lab must show detailed per-stage live execution information.
- Market Triage must show a complete selected-market research packet instead of partial/incomplete detail.
- Research Ledger must show the deepest audit view for provider outputs, debate results, and final reasoning.
- Contradiction output must be visible.
- Judge output must be visible.
- Model-based debate results must be visible.
- Every important stage should expose:
  - service name
  - provider/model used
  - started time
  - ended time
  - duration
  - status
  - raw output text
  - failure reason
  - source references/links/snippets when available

### Non-functional

- No hardcoded provider/model lists should be the primary source in StrategyHub.
- Metadata failure for one service must not break the whole page.
- Existing saved settings must not be silently cleared.
- Degraded pipeline runs must remain visible instead of hiding failed branches.
- All pages should render from one consistent underlying truth, not page-specific partial interpretations.

## Current Problems

### StrategyHub

- DeerFlow is partially live-data-driven already, but still falls back to manual text entry when metadata is missing.
- TradingAgents provider/deep/quick settings still use hardcoded/manual text inputs.
- There is no TradingAgents metadata endpoint in the app.

### Simulation Lab

- The page now shows active stage and activity, but not the full detail needed for per-stage auditability.
- It does not yet expose the exact output text, service names, failure reasons, and source references at the granularity requested.

### Market Triage

- Selected market detail is incomplete and can show weak or confusing sources without enough provenance/context.
- It does not yet show full service-by-service outputs and stage-by-stage reasoning.

### Research Ledger

- It does not yet consistently expose the full raw provider outputs, debate reasoning, and timing/status metadata across all stages.

## Proposed Architecture

## 1. StrategyHub Live Metadata Dropdowns

### DeerFlow

- Continue using `/api/deerflow/models`.
- Render a dropdown when live DeerFlow models are available.
- Include a `Use service default` empty option.
- If metadata is unavailable:
  - show warning state
  - keep saved value visible if present
  - allow manual override only as recovery

### TradingAgents

Replace free-text controls for:

- `analystLlmProvider`
- `analystDeepThinkLlm`
- `analystQuickThinkLlm`

with real-data dropdowns.

### TradingAgents metadata source order

1. Query TradingAgents-native metadata
2. Fallback to `/api/llm/models`
3. Normalize into one stable response shape for StrategyHub

### Stale saved values

If a saved selection is missing from the latest metadata list:

- keep it visible
- mark it stale
- do not silently clear it
- allow replace or clear

## 2. TradingAgents Metadata Endpoint

Add:

- `GET /api/tradingagents/models`

Response shape:

```json
{
  "providers": [{ "id": "openai", "label": "openai" }],
  "models": [{ "id": "paper_lite", "label": "paper_lite" }],
  "source": "tradingagents" | "llm-fallback",
  "error": "optional error message"
}
```

This endpoint should hide service-specific quirks and normalize provider/model options for the UI.

## 3. Shared Transparency Model

Introduce or extend a normalized per-stage execution record shape used by Simulation Lab, Market Triage, and Research Ledger.

Each stage record should contain:

- `stage`
- `serviceName`
- `provider`
- `model`
- `startedAt`
- `endedAt`
- `durationMs`
- `status`
- `failureReason`
- `summary`
- `rawOutput`
- `sources[]`
- `references[]`

Each source/reference should contain:

- `title`
- `url`
- `domain`
- `snippet`
- `provider`
- `reasonIncluded` when derivable

### Debate transparency records

Add explicit records for:

- Bull
- Bear
- Contradiction
- Judge
- final debate/judge result summary

Each should expose:

- service/provider/model used
- raw output
- timing
- status
- failure reason if any

## 4. Simulation Lab Transparency

Simulation Lab remains the live operational surface.

It should show:

- current stage
- current market
- service name
- provider/model used
- started time
- ended time when complete
- duration/elapsed time
- status
- failure reason if failed
- compact response preview
- available source links

It should also expose recent stage records for completed/failed/skipped stages, not just stage names.

## 5. Market Triage Detailed Packet

Selected market detail should become a complete research packet.

It should include:

- all research sources with titles, domains, URLs, and snippets
- provider/service that found each source
- exact stage history for the market
- service-by-service outputs
- timing per stage
- skipped/failed reasons
- contradiction output
- judge reasoning
- debate result summaries

The goal is to eliminate the current feeling that Market Triage is incomplete.

## 6. Research Ledger Deep Audit View

Research Ledger becomes the deepest audit surface.

It should render:

- DeerFlow raw output
- TradingAgents raw output
- Agent-Reach raw output
- Bull raw output
- Bear raw output
- Contradiction raw output
- Judge raw output
- synthesis output
- final decision reasoning
- source provenance
- failure reasons
- stage timing/status metadata

This page is the source of truth for the most detailed post-run analysis.

## Data Flow

1. StrategyHub loads and requests:
   - `/api/deerflow/models`
   - `/api/tradingagents/models`
2. StrategyHub renders real dropdowns from live metadata.
3. Selected values persist into `strategy_settings.stageRouting`.
4. Market enters the pipeline.
5. Pipeline creates/updates per-stage execution records for:
   - Scan
   - Triage
   - DeerFlow
   - TradingAgents
   - Agent-Reach
   - Synthesis
   - Bull
   - Bear
   - Contradiction
   - Judge
   - Risk
   - Decision
   - Resolution
6. Provider branches write:
   - service name
   - provider/model
   - timing
   - raw output
   - references/sources
   - failure reason when relevant
7. Debate and judge stages write their own records.
8. Simulation Lab reads live execution records for current/recent activity.
9. Market Triage reads persisted market-level records for selected market detail.
10. Research Ledger reads the same normalized records and renders the deepest audit view.

## Error Handling

### DeerFlow metadata fails

- show `DeerFlow API unavailable`
- keep saved selection visible if present
- allow manual override only as recovery

### TradingAgents metadata fails but LLM fallback succeeds

- render dropdowns from `/api/llm/models`
- label as `LLM Provider fallback`

### Both TradingAgents metadata and LLM fallback fail

- show warning state
- keep stale saved values visible
- allow manual recovery inputs

### Stage failure

- store exact failure reason
- store service/provider/model
- store duration and status
- show failure across all pages

### Weak/bad sources

- keep visible rather than silently discard from UI
- show provider that found them
- show domain and snippet
- allow user to judge quality explicitly

### Degraded run

- successful and failed branches remain visible
- nothing important disappears because one branch failed

## Testing

### Metadata endpoints

- `/api/deerflow/models` returns normalized live DeerFlow model ids
- `/api/tradingagents/models` returns TradingAgents-native metadata when available
- `/api/tradingagents/models` falls back to `/api/llm/models` when TradingAgents metadata is unavailable

### StrategyHub UI

- DeerFlow dropdown uses live data
- TradingAgents provider/deep/quick dropdowns use live data
- stale saved values remain visible
- manual recovery input appears only on metadata failure

### Simulation Lab

- current stage records show service names, timings, statuses, and previews
- recent activity includes failures, skips, and durations correctly

### Market Triage

- selected market shows complete research packet
- all references and provider outputs are visible
- contradiction/judge/debate results are visible

### Research Ledger

- full audit view shows raw provider outputs, debate outputs, synthesis, and final decision reasoning
- timing/status/failure metadata render consistently

### Persistence verification

- save provider/model selections in StrategyHub
- reload page and confirm they persist
- confirm pipeline/runtime still reads the same `stageRouting` fields

## Key Decisions

- Use live metadata as the primary source for DeerFlow and TradingAgents dropdowns.
- Use TradingAgents-native metadata first, then `/api/llm/models` fallback.
- Keep manual entry only as a recovery path.
- Preserve stale saved values instead of clearing them.
- Use one normalized transparency model across Simulation Lab, Market Triage, and Research Ledger.
- Expose contradiction, judge, and debate outputs explicitly rather than collapsing them into hidden summaries.
