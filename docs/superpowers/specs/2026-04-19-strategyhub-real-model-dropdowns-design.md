# 2026-04-19 StrategyHub Real Model Dropdowns Design

## Goal

Replace hardcoded/manual StrategyHub model entry for DeerFlow and TradingAgents with real-data dropdowns backed by live service metadata wherever possible.

## Scope

This design covers:

- DeerFlow API model selection in StrategyHub
- TradingAgents provider selection in StrategyHub
- TradingAgents deep and quick model selection in StrategyHub
- Live metadata endpoints used by StrategyHub to populate those dropdowns
- Fallback behavior when live metadata is unavailable
- Stale saved-value handling for persisted settings

This design does not cover:

- Changes to research orchestration behavior
- Changes to ta-service analysis logic beyond metadata discovery if needed
- New provider execution behavior outside existing runtime settings
- Reworking unrelated StrategyHub sections

## Requirements

### Functional

- DeerFlow API model must be selected from a real-data dropdown, not a hardcoded list.
- TradingAgents provider must be selected from a real-data dropdown, not a free-text input in normal operation.
- TradingAgents deep model must be selected from a real-data dropdown.
- TradingAgents quick model must be selected from a real-data dropdown.
- TradingAgents dropdown data must come from:
  1. TradingAgents-specific metadata first
  2. `/api/llm/models` fallback second
- DeerFlow dropdown data must come from `/api/deerflow/models`.
- Saved values in `stageRouting` must remain visible even when current metadata no longer contains them.
- Manual text entry is allowed only as a recovery path when both primary and fallback metadata sources fail.

### Non-functional

- No hardcoded provider/model lists should be the primary UI source.
- UI should clearly label whether options came from native service metadata or fallback metadata.
- Metadata failures for one provider must not break the whole StrategyHub page.
- Existing saved settings must not be silently cleared or rewritten.

## Current State

### DeerFlow

- StrategyHub already fetches DeerFlow model data and can render a dropdown.
- It currently falls back to manual text input when the model list is unavailable.
- This is mostly aligned already, but needs to remain explicitly live-data-driven.

### TradingAgents

- StrategyHub currently uses hardcoded text inputs for:
  - `analystLlmProvider`
  - `analystDeepThinkLlm`
  - `analystQuickThinkLlm`
- There is no TradingAgents-specific metadata endpoint in the app.
- There is no real-data dropdown source for TradingAgents provider/model selection.

## Proposed Architecture

## 1. StrategyHub UI

Replace TradingAgents free-text controls with metadata-backed dropdowns.

### DeerFlow section

- Continue to fetch `/api/deerflow/models`.
- If models are returned:
  - render a dropdown
  - include a `Use service default` empty option
  - include stale-value handling when the saved model is not in the latest list
- If models are not returned:
  - render a warning state
  - allow manual override input only as recovery

### TradingAgents section

Replace free-text provider/model inputs with:

- provider dropdown
- deep model dropdown
- quick model dropdown

Each dropdown should:

- use real metadata when available
- preserve the saved selection when stale
- provide a clear/reset path back to default behavior
- display the metadata source label

## 2. TradingAgents Metadata Endpoint

Add a new endpoint:

- `GET /api/tradingagents/models`

### Response shape

```json
{
  "providers": [{ "id": "openai", "label": "openai" }],
  "models": [{ "id": "paper_lite", "label": "paper_lite" }],
  "source": "tradingagents" | "llm-fallback",
  "error": "optional error message"
}
```

### Resolution order

1. Query TradingAgents-native metadata if the service exposes it.
2. If TradingAgents metadata is unavailable, fallback to `/api/llm/models`.
3. Normalize both sources into one app response shape.

## 3. App-side TradingAgents Metadata Client

Add a focused metadata fetcher in the TradingAgents integration layer.

Responsibilities:

- resolve TradingAgents base URL and auth from existing credential/service config
- call one or more TradingAgents metadata endpoints if available
- normalize provider/model output into stable app shapes
- return failure cleanly so the API route can fallback to LLM models

This logic should stay isolated from the main analysis client.

## 4. Persistence and Stale Values

Persisted settings remain the same fields:

- `deerflowApiModel`
- `analystLlmProvider`
- `analystDeepThinkLlm`
- `analystQuickThinkLlm`

### Stale-value behavior

If a saved value is not present in the latest metadata response:

- keep showing it in the dropdown
- mark it as stale in UI
- do not silently clear it
- allow the user to keep, replace, or clear it

This preserves runtime continuity and prevents hidden configuration loss.

## Data Flow

1. StrategyHub loads.
2. It requests:
   - `/api/deerflow/models`
   - `/api/tradingagents/models`
3. DeerFlow endpoint returns API-backed model list or empty/error.
4. TradingAgents endpoint:
   - tries TradingAgents-native metadata
   - falls back to `/api/llm/models` if needed
   - returns normalized provider/model options plus source label
5. StrategyHub renders:
   - dropdowns from live metadata when available
   - fallback dropdowns from LLM metadata when TradingAgents-native metadata is unavailable
   - manual recovery inputs only when all metadata sources fail
6. User selections save back into `strategy_settings.stageRouting`.
7. Runtime consumers continue using the same persisted fields with no execution-path change required.

## Error Handling

### DeerFlow metadata fails

- show `DeerFlow API unavailable`
- keep saved selection visible if present
- allow manual override input only as recovery

### TradingAgents metadata fails but LLM fallback succeeds

- render dropdowns from `/api/llm/models`
- show source label `LLM Provider fallback`

### Both TradingAgents metadata and LLM fallback fail

- show disabled/empty dropdown warning state
- keep stale saved values visible if present
- allow manual override input as last resort

### Stale saved values

- show them explicitly
- mark them stale
- never silently clear them during load or save

## Testing

### Endpoint verification

- `/api/deerflow/models` returns normalized model ids from DeerFlow API
- `/api/tradingagents/models` returns TradingAgents-native metadata when available
- `/api/tradingagents/models` falls back to `/api/llm/models` when TradingAgents metadata is unavailable

### UI verification

- DeerFlow model renders as a dropdown sourced from live API data
- TradingAgents provider/deep/quick controls render as dropdowns sourced from live metadata
- stale saved values remain visible and marked stale
- source labels display correctly (`TradingAgents`, `LLM Provider fallback`, `DeerFlow API`)
- manual override input appears only in degraded/failure conditions

### Persistence verification

- save a selected provider/model set
- reload StrategyHub
- confirm persisted values are retained
- confirm runtime fields remain unchanged in `stageRouting`

## Key Decisions

- Use real metadata as the primary source for all DeerFlow and TradingAgents dropdowns.
- Use TradingAgents-native metadata first, then `/api/llm/models` fallback.
- Keep manual entry only as a recovery path, not the default UX.
- Preserve and surface stale saved values instead of clearing them.
- Keep runtime setting fields unchanged so this is primarily a metadata/UI improvement, not a runtime contract rewrite.
