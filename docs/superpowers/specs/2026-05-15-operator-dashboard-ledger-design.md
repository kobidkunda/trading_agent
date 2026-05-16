# Operator Dashboard, Ledger, and Bet Detail Redesign

Date: 2026-05-15
Status: Draft for review
Owner: Codex

## Goal

Redesign the trading UI so an operator can immediately understand:

- which market is being played now
- where it is being played
- whether an attempt is simulated or real
- the current bet status
- the outcome and win/loss state
- why the same market appears multiple times
- the bull, bear, judge, and risk context behind each attempt

This redesign must work consistently in `DEMO`, `PAPER`, and `LIVE` modes. In `DEMO`, the system should behave as if bets are being placed and resolved, but execution remains simulated.

## Problem Summary

The current surfaces scatter critical state across `Simulation Lab`, `Live Status`, `Research Ledger`, and market pages. As a result:

- the top-level UI does not clearly show whether the system is actively playing a market
- bets and orders are difficult to interpret as a coherent history
- duplicate same-market rows are confusing because markets and attempts are not clearly separated
- the current UI does not make win/loss, current outcome, venue, or execution mode obvious
- bull/bear/judge data appears unstable or buried instead of being presented as a reliable operator-facing narrative
- refresh and mode transitions can make system state feel inconsistent

## Product Direction

Use a split dashboard with three layers:

1. top summary optimized for operator awareness
2. middle rail optimized for current live activity
3. bottom ledger optimized for historical truth and drill-down

This creates one primary screen that answers both "what is happening right now?" and "what has this system actually done?"

## Information Architecture

### 1. Operator Dashboard

`Simulation Lab` becomes the main operator dashboard instead of a narrow demo sandbox.

It contains:

- `Operator Summary`
- `Live Ops Rail`
- `Canonical Trades Ledger`

This page is the primary surface for all modes.

### 2. Live Status

`Live Status` remains in the product but changes purpose.

It should focus on:

- worker/job state
- service health
- queue depth
- retries/failures
- stage infrastructure and throughput

It should no longer be the primary place to understand a bet or trade outcome.

### 3. Bet / Market Detail

The market detail page becomes the audit surface for one market and its attempts.

It should show:

- full lifecycle timeline
- all bet attempts for the market
- bull/bear/judge/risk outputs
- fill/position/outcome state
- resolution and scoring details

## Core UX Model

### Market vs Attempt

The redesign defines two explicit layers:

- `Market`: the parent entity representing the prediction market itself
- `Attempt`: a child entity representing each simulated or actual bet/order attempt on that market

This distinction solves the duplicate-row problem.

The ledger default row is the market.
The expanded child rows are the attempts.

### Modes

The UI must present the same structure in all modes:

- `DEMO`: simulated attempts, simulated fills, simulated outcomes, but rendered exactly like real attempts
- `PAPER`: real market data, simulated execution attempts
- `LIVE`: real market data, real execution attempts, if enabled

The UI must always badge:

- mode
- venue
- execution type: simulated or real
- current lifecycle status

## Operator Summary

The top section is optimized for operator awareness, not raw infrastructure detail.

It should contain cards for:

- `Currently Playing`
- `Open Bets`
- `Pending Decisions`
- `Wins`
- `Losses`
- `Resolved Today`
- `Exposure`
- `Pipeline Alerts`

### Summary rules

These cards must be derived from one normalized trading view-model, not computed separately in different UI components.

The summary should use stable buckets:

- `queued`
- `watch`
- `placed`
- `partially_filled`
- `filled`
- `open`
- `won`
- `lost`
- `cancelled`
- `expired`

The summary should visually separate:

- active operational state
- trading state
- outcome state

## Live Ops Rail

The middle section answers: "What is the system doing now?"

It should bind to:

- one current focus market
- one current focus attempt when one exists

### Focus selection rules

Priority:

1. active bet/order attempt currently being processed or tracked
2. market currently in bull/bear/judge/risk pipeline
3. latest recently completed attempt

### Rail content

The rail should show:

- market title
- venue
- mode
- execution type
- current stage
- current lifecycle status
- started time
- last update time
- expected next action

Structured narrative cards should show:

- `Bull thesis`
- `Bear thesis`
- `Judge conclusion`
- `Risk decision`

These should use stable labels and bounded text regions, not floating freeform blobs.

### Rail behavior in DEMO

In `DEMO`, the rail should still show a proper simulated attempt as if the system has placed it.
The only difference is the execution badge should explicitly say `SIMULATED`.

## Canonical Trades Ledger

The bottom section is the source of truth for historical and current trade understanding.

### Ledger default shape

One parent row per market.

The parent row shows:

- market title
- venue
- market status
- latest decision
- latest attempt status
- latest outcome
- win/loss badge
- last activity timestamp
- attempt count

### Expanded child rows

Each expansion lists all attempts for that market.

Each child row shows:

- placed at date/time
- execution mode
- side
- price
- size
- fill status
- current attempt status
- outcome
- result: won, lost, pending, cancelled, expired

### Ledger behavior requirements

- duplicate same-market entries must collapse into one market parent row
- attempts must remain individually inspectable
- rows must support sorting and filtering by mode, venue, status, outcome, and date range
- dates/times must be precise and human-readable
- the current active attempt must be visually obvious

## Bet / Market Detail Page

The detail page is the drill-down for operator review and audit.

It should include:

- market header
- outcome header
- status badges
- venue and mode
- attempt summary
- full timeline
- research and decision panels

### Timeline

Ordered milestones:

- scanned
- triaged
- bull analysis
- bear analysis
- judge
- risk
- simulated/placed
- fill updates
- resolution
- final score

Each timeline entry should include:

- timestamp
- stage
- status
- summary text
- links or references when available

### Decision panels

The page must show the final stable forms of:

- bull thesis
- bear thesis
- judge output
- risk output
- order/attempt record
- resolution record

The operator should not need to infer these from scattered logs.

## Data and View-Model Design

### Normalized Trading View-Model

Add one shared normalized trading data layer that merges:

- markets
- market snapshots
- decisions
- orders
- positions
- paper bets
- latest live activity state
- latest pipeline stage metadata

This view-model should produce one canonical shape for UI consumption.

### Ledger Builder

Add one helper that groups normalized data into:

- market parent rows
- child attempt rows

The grouping key should be the canonical market identity, not raw repeated event rows.

### Live Focus Selector

Add one helper that chooses the current focus market/attempt for the live rail.

### Outcome Formatter

Add one helper that standardizes:

- pending
- won
- lost
- cancelled
- expired
- watch-only

This formatter must render consistently across DEMO, PAPER, and LIVE.

## Visual Design Direction

The current UI is hard to read because it treats important and unimportant data with similar visual weight.

The redesign should emphasize:

- stronger hierarchy
- clearer grouping
- more deliberate spacing
- stronger status color semantics
- stable card rhythms
- readable tables with expandable structure

### Visual principles

- make active state unmistakable
- make simulated vs real unmistakable
- make win/loss unmistakable
- make duplicated same-market attempts understandable through grouping
- prefer concise operator language over generic dashboard labels

### Styling direction

Stay within the existing dark product language, but increase clarity through:

- cleaner card framing
- improved row density
- stronger typography scale between title, value, label, and metadata
- consistent status chips
- richer timeline and rail composition

## Responsiveness

The redesign must work on desktop and mobile.

### Desktop

- split dashboard with clear top, middle, bottom zones
- expandable market ledger with strong scanability
- detail pages with side-by-side narrative panels when space allows

### Mobile

- operator summary stacks cleanly
- live rail becomes a vertical focus card stack
- market ledger remains usable with compact rows and expandable detail
- key status fields remain visible without horizontal confusion

## Error Handling and Empty States

### Required empty states

- no active pipeline
- no attempts for a market
- no resolved outcomes yet
- no bull/bear/judge content available yet
- services degraded but last known trade state still visible

### Required error states

- simulation running with provider/stage failures
- real execution unavailable
- stale activity state after refresh
- missing outcome/resolution data

Error messaging should explain what is missing without making the operator lose the rest of the context.

## Compatibility and Migration

The redesign should be phased without breaking the SPA structure.

### Phase 1

Build the normalized trading view-model and grouped ledger helpers.

### Phase 2

Replace `Simulation Lab` with the new operator dashboard.

### Phase 3

Improve the market/bet detail page with full timeline and structured research output.

### Phase 4

Refocus `Live Status` onto operational infrastructure and queue observability.

### Phase 5

Polish styling, spacing, hierarchy, badges, and mobile behavior.

## Expected File Changes

Primary files:

- `src/components/trading/SimulationLab.tsx`
- `src/components/trading/LiveStatus.tsx`
- `src/components/trading/ResearchLedger.tsx`
- `src/app/market/[id]/page.tsx`
- `src/app/page.tsx`

New shared helpers likely under `src/lib/engine/`:

- normalized trading view-model
- grouped ledger builder
- live focus selector
- outcome/status formatter

## Testing Strategy

### Unit tests

- grouping logic for market parent rows and child attempts
- live focus selection logic
- outcome formatting across modes and statuses
- summary card bucket calculations

### UI behavior tests

- DEMO mode shows simulated attempts as placed-like attempts
- PAPER/LIVE modes render real/simulated execution correctly
- same-market duplicates collapse into one parent row
- expanded child rows reveal all attempts
- refresh preserves dashboard status truth from backend state

### Manual validation

- operator can identify current active bet in under 5 seconds
- operator can identify venue, outcome, and win/loss without opening logs
- operator can explain why one market has multiple attempts from the ledger alone

## Non-Goals

This redesign does not introduce new trading logic, strategy logic, or execution algorithms.

It is focused on:

- information clarity
- operator usability
- data trustworthiness in presentation
- consistency across modes

## Open Implementation Note

There is a currently observed runtime issue in the demo flow related to Prisma fields used by simulated market creation. That issue is separate from this redesign spec and should be resolved during implementation where it affects dashboard truthfulness.
