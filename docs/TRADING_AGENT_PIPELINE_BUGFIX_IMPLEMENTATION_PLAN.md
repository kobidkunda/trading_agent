# Trading Agent Pipeline Bugfix Implementation Plan

## Goal

Fix the paper-mode trading pipeline so a valid market can move all the way through:

`SCAN -> CANDIDATE_SCORE -> TRIAGE -> RESEARCH -> JUDGE -> RISK -> PAPER_EXECUTE -> ORDER_TRACK -> PAPER_BET / PAPER_ORDER`

The fix must preserve safety: bad markets should still stop with a clear skip reason. The goal is not to force every scanned market to trade. The goal is to make valid BID decisions reach paper execution, and to make every stop explainable in the UI and DB.

## Current Symptom From UI

Observed dashboard state:

- Canonical Trades Ledger shows many rows stuck at `SCANNED`.
- `Decision` is `NONE`.
- `Attempt` is `NONE`.
- `Outcome` is pending.
- `Attempts` is `0`.
- Research Ledger says `No trading decisions yet`.
- Paper Bets says `No paper bets found`.
- Paper Orders says `No orders found`.
- Live Status shows every agent idle with no recent jobs.
- A+ Signals shows 73k+ records but average score around `29.8`, which is not A+.
- Orderbook dashboard returns HTTP 500.

This combination means the system is scanning, but the queued stage pipeline is not reliably progressing into decision and execution.

## High-Confidence Root Causes

### Root cause 1: queued pipeline does not match direct pipeline

`src/lib/engine/pipeline.ts` has a direct in-memory flow in `runPipelineForMarket()`:

1. `runTriageStage()` returns `triageOut`.
2. If `triageOut.worthResearch`, direct flow calls `runResearchStage()`.
3. It passes `researchOut.researchRunId`, `researchOut.researchContext`, and `researchOut.depth` directly to `runJudgeStage()`.
4. It passes `judgeOut` directly to `runRiskStage()`.
5. It passes `riskOut.gatedRiskResult` directly to `runExecuteStage()`.

But `src/lib/engine/worker.ts` runs each stage as a separate DB job. The worker must reconstruct the prior stage output from DB/payload. It currently loses or fails to find critical objects, so jobs stop without reaching paper orders.

### Root cause 2: Judge looks for completed research even though research is still RUNNING by design

In the original code, `runResearchStage()` creates a `ResearchRun` with `status: 'RUNNING'`. The original `lookupResearchRunForMarket()` in `worker.ts` only looked for `status: 'COMPLETED'`.

But `runJudgeStage()` later marks the research run `COMPLETED` after judge/agent outputs are written. So the queued Judge job receives `researchRunId` from the Research job, but then ignores it and searches only for already-completed runs. Result: `NO_RESEARCH_RUN`, then no Risk, no Execute, no Paper Bet.

### Root cause 3: TRIAGE job does not enqueue research

`candidate-job-enqueuer.ts` can enqueue only `TRIAGE_MARKET` for action `TRIAGE`. The original worker runs `runTriageStage()` and returns the result, but does not enqueue research when `worthResearch === true`.

Therefore score bands that enter TRIAGE but require the triage result to decide research can stop forever after TRIAGE/SCANNED.

### Root cause 4: queued execute calls `runExecuteStage()` without risk result

The direct pipeline calls:

`runExecuteStage(marketId, decisionId, riskOut.gatedRiskResult, riskOut.aPlusGatePassed, ...)`

The original queued worker calls:

`runExecuteStage(marketId, decisionId, undefined as any, false, ...)`

`runExecuteStage()` dereferences `gatedRiskResult.action`, `side`, `edge`, `maxSize`, etc. If the job reaches execution, this can crash or produce no executable order. The worker must reconstruct `gatedRiskResult` from the persisted `Decision` row.

### Root cause 5: paper mode is blocked by live/A+ governance gates

In `runRiskStage()`, a BID is forced to WATCH when the A+ gate fails, high disagreement exists, or live governance is not ready. This is correct for LIVE execution, but too strict for paper testing. Paper mode should be allowed to create paper bets for normal BID decisions even if they are not A+.

Paper mode should still respect hard blocks: oracle `BLOCK`, high disagreement, no size, wide spread, low liquidity, bad risk result. But it should not require A+ or live governance readiness.

### Root cause 6: scanner imports stale/archived/non-tradable markets

The UI shows old political markets and archived Polymarket titles such as `archWill ... 2024`. These pollute candidates, score low, and overwhelm dashboards.

Scanner/adapters need to mark them `CLOSED` or skip them if:

- Polymarket title starts with `arch` or `archWill`.
- Market end date is in the past.
- Market is inactive or closed.
- Kalshi close time is in the past even if status field says active.

### Root cause 7: A+ endpoint ignores `aplus=true`

`APlusSignalsDashboard` calls:

`/api/trading/candidates?aplus=true`

But the original API route does not read `aplus`, so it returns low-score candidates. The UI labels score `30.8` as A+, which is misleading.

### Root cause 8: Orderbook API list response does not match UI shape

`OrderbookDashboard` expects rows with market context: `marketTitle`, `venue`, `lastUpdated`, etc. The original `/api/orderbook` list mode returns raw `orderbookSnapshot` rows without including `market`. Depending on Prisma/runtime behavior and sorting/search params, this can produce HTTP 500 and blank dashboard.

## Non-Goals

Do not weaken the strategy so every market trades. Markets with score `28-31`, low orderbook quality, old dates, stale archive titles, or missing liquidity should remain rejected.

Do not enable real/live execution. Keep live execution disabled unless explicit safety settings and live credentials are configured.

Do not remove risk engine, oracle checks, correlation exposure, or orderbook quality gates.

Do not bypass LLM/research outputs by forcing fake probabilities into production logic. Tests may use mocks, but app logic must remain truthful.

## Implementation Plan

## Phase 1: Make the queued worker a true state machine

### Files

- `src/lib/engine/worker.ts`
- `src/lib/engine/pipeline.ts`
- `src/lib/engine/pipeline-decision-helpers.ts`
- `src/lib/types/index.ts`

### TODO 1.1: Add explicit DB artifact lookup helpers in worker

In `worker.ts`, create helpers that can reconstruct prior stage outputs.

Required helpers:

1. `lookupResearchRunForMarket(marketId, researchRunId?)`
   - If `researchRunId` is passed, fetch that exact run where `id === researchRunId`, `marketId === marketId`, and `status !== 'FAILED'`.
   - If no `researchRunId`, fetch latest `COMPLETED` run.
   - Load related `ResearchSource[]` and `AgentOutput[]`.
   - Build `researchContext` from sources and agent outputs.
   - Return `{ researchRunId, researchContext, depth }`.

2. `lookupJudgeParams(marketId)`
   - First inspect latest `Decision` where `judgeProbability != null`.
   - Fallback to `AgentOutput` roles:
     - `JUDGE`
     - `DEBATE_ARBITER`
     - `CAUSAL_AGGREGATOR`
     - `MIROFISH_PREDICT`
     - `ENSEMBLE`
   - Parse `finalProbability` or `judgeProbability`.
   - Return probability, confidence, uncertainty, ensemble uncertainty boost, model disagreement, disagreement level.

3. `lookupDecisionForMarket(marketId, decisionId?)`
   - If `decisionId` is supplied, fetch exact decision for that market.
   - Otherwise fetch latest decision.
   - Reconstruct `gatedRiskResult` from `Decision` fields:
     - `action`
     - `side`
     - `maxSize`
     - `adjustedSize` fallback to `maxSize`
     - `urgency`
     - `reasonCode`
     - `reason`
     - `edge`
     - `fees`
     - `slippage`
   - Return judge probability/confidence/uncertainty also.

Acceptance:

- A Judge job with `payload.researchRunId` must not return `NO_RESEARCH_RUN` while the referenced run is non-failed and has sources/output.
- A Paper Execute job with only `{ marketId, decisionId }` must be able to call `runExecuteStage()` with a valid reconstructed `gatedRiskResult`.

### TODO 1.2: Make TRIAGE chain to research

In the `TRIAGE_MARKET` / `TRIAGE` case in `worker.ts`:

- Run `runTriageStage(marketId)`.
- If result has `worthResearch === true`, enqueue `STANDARD_RESEARCH` unless an active research job already exists for the same market.
- Payload must include:
  - `marketId`
  - `candidateId`
  - `trigger: 'triage_chain'`
  - `triageStatus`

Use a dedupe key such as:

`<venue>:<marketId>:STANDARD_RESEARCH:triage_chain`

Acceptance:

- A market queued only as `TRIAGE_MARKET` can progress into `STANDARD_RESEARCH` without manual intervention.
- It should not create duplicate research jobs on every worker tick.

### TODO 1.3: Pass stage artifacts through queued jobs

When `RESEARCH` completes:

- Enqueue `JUDGE_MARKET` with:
  - `marketId`
  - `researchRunId`
  - `candidateId`
  - `depth`

When `JUDGE` completes:

- Enqueue `RISK_CHECK` with:
  - `marketId`
  - `researchRunId`
  - `judgeProbability`
  - `judgeConfidence`
  - `judgeUncertainty`
  - `ensembleUncertaintyBoost`
  - `modelDisagreement`
  - `disagreementLevel`

When `RISK` completes with `riskAction === 'BID'`:

- Enqueue `PAPER_EXECUTE` with:
  - `marketId`
  - `decisionId`
  - `judgeProbability`
  - `judgeConfidence`
  - `judgeUncertainty`

When `PAPER_EXECUTE` creates an order:

- Ensure `runExecuteStage()` creates `ORDER_TRACK`.
- Ensure `paperBet` is created.

Acceptance:

- For a good mocked market, the final DB state must include one `Decision`, one `Order`, one `PaperBet`, and one `ORDER_TRACK` job.

### TODO 1.4: Fix retry/failure cleanup

In `processNextQueuedJobOnce()` catch block:

- If job type is `RESEARCH_MARKET`, `QUICK_RESEARCH`, `STANDARD_RESEARCH`, or `DEEP_RESEARCH`, mark any `RUNNING` research runs for that market as `FAILED` and set `completedAt`.
- Always release candidate locks on retryable failures.
- Set candidate `lastError` to a concise reason.
- Do not leave candidates in `RESEARCHING` with no active job.

Acceptance:

- A failed research job does not leave an infinite `RUNNING` ResearchRun.
- A failed queued stage unlocks the candidate and lets it retry or cool down.

## Phase 2: Fix ResearchRun status semantics

### Files

- `src/lib/engine/pipeline.ts`
- `src/lib/engine/worker.ts`

### TODO 2.1: Decide and document the status lifecycle

Recommended lifecycle:

- `runResearchStage()` creates `ResearchRun(status='RUNNING')`.
- At the end of `runResearchStage()`, mark it `COMPLETED` if all research collection/synthesis is done.
- `runJudgeStage()` should append judge outputs to the same ResearchRun, but should not be the first place that makes research visible to the queued worker.

Alternative acceptable lifecycle:

- Keep `ResearchRun` as `RUNNING` until Judge finishes.
- But then `worker.lookupResearchRunForMarket(marketId, researchRunId)` must accept non-failed RUNNING run when explicit ID is provided.

Preferred implementation: mark research complete at the end of `runResearchStage()` and let Judge update it idempotently.

### TODO 2.2: Add `finishResearchRun()` helper inside `runResearchStage()`

Create a local helper:

- `finishResearchRun('COMPLETED')`
- `finishResearchRun('FAILED', failureReason)`

Use it in all early-return paths and normal completion path:

- DeerFlow unavailable fallback path.
- Firecrawl fallback path.
- Normal QUICK/STANDARD/FULL path.
- Any catch/failure path.

Acceptance:

- Every `ResearchRun` created by `runResearchStage()` must end as `COMPLETED` or `FAILED`.
- No `RUNNING` rows older than active job runtime should remain.

### TODO 2.3: Update candidate research metadata

At successful end of `runResearchStage()`:

- Candidate stage should be `RESEARCHING` or `RESEARCHED` depending on existing UI contract.
- Set `lastResearchAt = new Date()`.
- Clear processing lock if the stage is finished and no next job needs it.

Recommended stage names:

- Keep existing DB-compatible strings:
  - `SCANNED`
  - `TRIAGED`
  - `RESEARCHING`
  - `JUDGED`
  - `DECIDED`
  - `EXECUTED`
  - `WATCHING`
  - `EXECUTION_FAILED`

Do not introduce new stage names unless all dashboards and tests are updated.

## Phase 3: Fix paper-mode execution gating

### Files

- `src/lib/engine/pipeline.ts`
- `src/lib/engine/trading-settings.ts`
- `src/lib/engine/live-governance.ts`
- `src/lib/engine/a-plus/signal-gate.ts`

### TODO 3.1: Separate paper gate from live gate

In `runRiskStage()`:

- Load `tradingConfig.mode` from context.
- Define:

`requiresAPlusForExecution = tradingConfig.mode === 'LIVE' || governance.liveEnabled`

Then only force `BID -> WATCH` for A+ failure when `requiresAPlusForExecution` is true.

Still force `BID -> WATCH/SKIP` for:

- `oracleRiskLevel === 'BLOCK'`
- `disagreementLevel === 'HIGH'`
- No live governance readiness when mode is LIVE
- Manual review required for LIVE

Paper mode should allow standard BID paper orders when deterministic risk says BID.

Acceptance:

- In PAPER mode, a deterministic BID with standard non-A+ quality creates a paper order.
- In LIVE mode, the same non-A+ BID becomes WATCH unless live safety gates are satisfied.

### TODO 3.2: Persist paper-vs-live metadata accurately

When creating `Decision`:

- Set `mode` to normalized trading mode.
- Set `dataSource` from `getModeState(mode)`.
- Set `executionMode` to `SIMULATED` for PAPER/DEMO and `REAL` only for LIVE.
- Set `dryRun` true unless LIVE execution is explicitly enabled.

Acceptance:

- Paper decisions should not look like live decisions.
- Live execution remains blocked unless explicit config enables it.

## Phase 4: Fix execution reconstruction and paper orders

### Files

- `src/lib/engine/worker.ts`
- `src/lib/engine/pipeline.ts`
- `src/lib/engine/paper-execution.ts`
- `src/lib/engine/paper-bets.ts`
- `src/lib/engine/order-tracker.ts`

### TODO 4.1: Never call `runExecuteStage()` with undefined risk result

In worker `PAPER_EXECUTE` case:

- Fetch decision using `lookupDecisionForMarket(marketId, decisionId)`.
- If missing, return structured skipped result:
  - `status: 'NO_DECISION'`
  - `marketId`
  - `decisionId`
  - `skipped: true`
- If present, call:

`runExecuteStage(marketId, decisionId, decision.gatedRiskResult, false, judgeProb, judgeConf, judgeUnc)`

Acceptance:

- No `Cannot read properties of undefined (reading 'action')` execution failures.
- A persisted BID decision can be executed even if worker restarts before `PAPER_EXECUTE` runs.

### TODO 4.2: Return actual order ID clearly

In `runExecuteStage()`, current code sets:

`orderId = venueOrderId`

This is confusing because the DB order row has `order.id` while `venueOrderId` is simulated external ID.

Recommended change:

- `orderId = order.id`
- `venueOrderId = venueOrderId`

Update affected tests/components if they expect `venueOrderId` in `orderId`.

Acceptance:

- API and UI can open exact order row by DB ID.
- Venue/sim ID remains visible separately.

### TODO 4.3: Create PaperBet only after Order creation succeeds

Keep paper bet creation after `createOrderCompat()`.

Ensure `createPaperBet()` receives:

- `marketId`
- `decisionId`
- `orderId: order.id`
- `predictionType: 'BID'`
- `setupType: 'A_PLUS_BET' | 'STANDARD_BET'`
- `aPlusStatus: 'PASSED' | 'FAILED' | 'HEURISTIC'`
- `executionStatus: 'SUBMITTED'`
- `predictedProb`
- `predictedSide`
- `impliedProb`
- `edge`
- `confidence`
- `stake`
- `entryPrice`

Acceptance:

- Paper Bets dashboard shows new rows after valid BID.
- Paper Orders dashboard shows corresponding order row.

## Phase 5: Clean market scanning and active-market filtering

### Files

- `src/lib/venues/polymarket.ts`
- `src/lib/venues/kalshi.ts`
- `src/lib/engine/scanner.ts`
- `src/lib/engine/scanner-upsert.ts`
- `src/lib/engine/market-loop.ts`

### TODO 5.1: Filter Polymarket archived/past markets

In `polymarket.ts`:

- Add helper `parseMarketEndTime(market)` reading:
  - `end_date_iso`
  - `endDate`
- Add helper `isFutureOrUndated(isoDate)`.
- Add helper `isArchivedTitle(title)` matching:
  - `^arch\s*`
  - `^archwill`
- Mark market ACTIVE only if:
  - `m.active === true`
  - `m.closed !== true`
  - resolution/end time is future or absent
  - title is not archived

Return `status: 'CLOSED'` instead of `INACTIVE` for non-tradable markets so downstream `isClosed` logic works consistently.

Acceptance:

- `archWill Donald Trump win the 2024...` no longer appears as active candidate.
- Past ended markets are not considered for new research jobs.

### TODO 5.2: Filter Kalshi past-close markets

In `scanner.ts` Kalshi mapping:

- Parse `m.close_time`.
- `isTradableActive = m.status === 'active' && closeTime > now`.
- If active but close time is past, mark `CLOSED`.

Acceptance:

- A Kalshi market with close_time before now is not treated as active.

### TODO 5.3: Add market-loop active filter hardening

In `market-loop.ts`, fetch only:

- `isActive: true`
- `isClosed: false`
- `isResolved: false`
- `resolutionTime: null OR resolutionTime > now`

For markets with unknown resolution time, still allow but apply lower resolution clarity score.

Acceptance:

- Past markets cannot create new research or execution jobs.

## Phase 6: Fix A+ Signals endpoint and UI truthfulness

### Files

- `src/app/api/trading/candidates/route.ts`
- `src/components/trading/APlusSignalsDashboard.tsx`
- `src/lib/engine/candidate-criteria.ts`

### TODO 6.1: Implement `aplus=true` in candidates API

In API route:

- Read `const aplusOnly = searchParams.get('aplus') === 'true'`.
- If true, set `minScore = Math.max(requestedMinScore ?? 90, 90)`.
- Keep regular `minScore` behavior for non-A+ calls.
- Return `riskFlags` by parsing `rejectedCriteria`.

Acceptance:

- `/api/trading/candidates?aplus=true` never returns candidates below 90.
- A+ dashboard average should not be around 29.

### TODO 6.2: Fix pagination count after mode filtering

Current route counts before mode filtering. This can make total misleading.

Options:

- Simple: count by DB `where`, then document that mode filtering is post-fetch.
- Better: include mode visibility constraints in DB `where` before count.

Recommended:

- Push mode filters into query when possible.
- If not possible, fetch enough rows and compute accurate visible total separately.

Acceptance:

- A+ total count matches visible A+ candidates.

## Phase 7: Fix Orderbook API HTTP 500 and response shape

### Files

- `src/app/api/orderbook/route.ts`
- `src/components/trading/OrderbookDashboard.tsx`

### TODO 7.1: Include market context in orderbook list response

When no `marketId` is passed:

- Support `search` over market title/category/venue.
- Support sort fields:
  - `capturedAt`
  - `spread`
  - `bidDepth`
  - `askDepth`
  - `depthImbalance`
  - `fillProbability`
- Include market relation:
  - `market.id`
  - `market.title`
  - `market.venue`
  - `market.category`

Map rows to UI shape:

- `id`
- `marketId`
- `marketTitle`
- `venue`
- `category`
- `bestBid`
- `bestAsk`
- `spread`
- `bidDepth`
- `askDepth`
- `depthImbalance`
- `largeBidWall`
- `largeAskWall`
- `thinBookDanger`
- `thinBookWarning`
- `priceImpact`
- `fillProbability`
- `capturedAt`
- `lastUpdated`

Acceptance:

- Orderbook dashboard loads without HTTP 500.
- Search by title works.
- Sorting works.

### TODO 7.2: Return useful error details during development

In catch blocks:

- Log with `console.error('[Orderbook API] ...', error)`.
- JSON response should include:
  - `error`
  - `details` if `error instanceof Error`

Acceptance:

- Debugging no longer shows only `HTTP 500` with no cause.

## Phase 8: Improve observability / live status

### Files

- `src/lib/engine/worker.ts`
- `src/lib/engine/worker-checkpoint.ts`
- `src/lib/engine/live-sim-events.ts`
- `src/lib/engine/pipeline-observability-view-model.ts`
- `src/components/trading/LiveStatus.tsx`
- `src/components/trading/ResearchQueueDashboard.tsx`

### TODO 8.1: Persist transitions for every queued stage

Every worker stage should log transitions:

- `SCANNED -> TRIAGED`
- `TRIAGED -> RESEARCHING`
- `RESEARCHING -> JUDGED`
- `JUDGED -> DECIDED`
- `DECIDED -> EXECUTED`
- `EXECUTED -> ORDER_TRACK`
- failure transitions with reason

Acceptance:

- Live Status shows recent job activity.
- Research Queue shows pending/running/completed jobs.

### TODO 8.2: Surface skip reasons clearly

When a stage returns skipped:

- Store reason into `TradeCandidate.skipReason` or job result.
- UI should distinguish:
  - low score
  - no research run
  - no judge params
  - risk SKIP
  - risk WATCH
  - paper execution no size
  - order expired

Acceptance:

- User can know whether a market did not trade because of code bug, score gate, LLM issue, or risk engine decision.

## Phase 9: Add deterministic tests so this never breaks again

### Files to add/update

- `src/lib/engine/__tests__/worker-pipeline-chain.test.ts`
- `src/lib/engine/__tests__/paper-execution.test.ts`
- `src/lib/engine/__tests__/pipeline-paper-mode-gates.test.ts`
- `src/lib/engine/__tests__/candidates-route.test.ts`
- `src/lib/engine/__tests__/orderbook-route.test.ts`
- `src/lib/engine/__tests__/scanner-active-filter.test.ts`

### TODO 9.1: Worker chain test

Mock DB and stage functions, then prove:

1. `TRIAGE_MARKET` with `worthResearch: true` creates `STANDARD_RESEARCH`.
2. `STANDARD_RESEARCH` with `researchRunId` creates `JUDGE_MARKET` with that ID.
3. `JUDGE_MARKET` creates `RISK_CHECK` with judge values.
4. `RISK_CHECK` with `riskAction: BID` creates `PAPER_EXECUTE` with `decisionId`.
5. `PAPER_EXECUTE` calls `runExecuteStage()` with non-null reconstructed `gatedRiskResult`.

Acceptance:

- Test fails if any stage stops without enqueuing the next job.

### TODO 9.2: Research run status test

Test that `runResearchStage()` always marks a created research run as `COMPLETED` or `FAILED`.

Acceptance:

- No successful research path leaves `RUNNING`.

### TODO 9.3: Paper mode gate test

Create mocked risk input where:

- deterministic risk result is `BID`
- A+ gate fails
- mode is `PAPER`

Expected:

- final decision action remains `BID`
- execution job is allowed

Then repeat in LIVE mode:

Expected:

- decision becomes `WATCH` unless A+ and live governance pass

### TODO 9.4: Candidates A+ API test

Call candidates route with `aplus=true`.

Seed/mock candidates:

- score 30
- score 89.9
- score 90
- score 95

Expected:

- only score 90 and 95 returned
- `riskFlags` array exists

### TODO 9.5: Scanner active filter test

Mock Polymarket adapter data:

- active future market => ACTIVE
- closed market => CLOSED
- archived title => CLOSED
- past end date => CLOSED

Mock Kalshi data:

- active future close_time => ACTIVE
- active past close_time => CLOSED

Expected:

- only future active markets can proceed to candidates.

### TODO 9.6: Orderbook route test

Seed/mock orderbook snapshots and market relation.

Expected:

- `/api/orderbook` returns rows with `marketTitle`, `venue`, `lastUpdated`.
- search filters by title.
- sorting by spread works.
- no HTTP 500.

## Phase 10: Manual verification checklist

After code changes:

1. Install/generate:

```bash
npm install
npx prisma generate
npm run typecheck
bun test src/lib/engine/__tests__/worker-pipeline-chain.test.ts
bun test src/lib/engine/__tests__/pipeline-paper-mode-gates.test.ts
bun test src/lib/engine/__tests__/candidates-route.test.ts
bun test src/lib/engine/__tests__/orderbook-route.test.ts
```

2. Restart app and worker.

3. Clear stuck research runs:

```bash
curl -X PUT http://localhost:6500/api/research \
  -H "Content-Type: application/json" \
  -d '{"action":"fix_stuck"}'
```

4. Optional cleanup for old archive candidates:

- Mark markets with title beginning `arch` as closed.
- Mark candidates tied to closed/resolved/past markets as `WATCHING` or terminal skipped.

5. Start fresh market scan.

6. Confirm dashboard sequence:

- Market Triage shows candidates with real skip reasons.
- Research Queue shows jobs when they run.
- Research Ledger gets decisions after judge/risk.
- Paper Bets gets rows for valid BID decisions.
- Paper Orders gets submitted orders.
- Live Status shows non-zero activity for Scanner/Triage/Research/Judge/Risk/Execute.

## Expected Final Behavior

Low-quality markets:

- Stay rejected or WATCHING.
- Show reason like `BELOW_CANDIDATE_THRESHOLD` or `ORDERBOOK_QUALITY`.
- Do not create paper orders.

Valid standard paper trades:

- Can create `Decision(action='BID')`.
- Can create `PaperBet` with `setupType='STANDARD_BET'`.
- Can create simulated `Order` with `executionMode='SIMULATED'`.
- Can create `ORDER_TRACK` job.

A+ live-quality trades:

- Must satisfy score >= 90 and A+ gates.
- Still remain paper/simulated unless live mode and live safety config are explicitly enabled.

## Coding Agent Prompt

Use this prompt for the coding agent:

```text
You are working inside the trading_agent-main repository. Fix the market pipeline so paper-mode valid trades progress from scan to paper execution. Do not weaken safety gates; low-score markets must still be skipped with clear reasons.

Primary files to inspect and modify:
- src/lib/engine/worker.ts
- src/lib/engine/pipeline.ts
- src/lib/engine/scanner.ts
- src/lib/venues/polymarket.ts
- src/lib/venues/kalshi.ts
- src/app/api/trading/candidates/route.ts
- src/app/api/orderbook/route.ts
- src/lib/engine/__tests__/*

Required behavior:
1. Queued worker flow must match direct runPipelineForMarket semantics.
2. TRIAGE_MARKET with worthResearch=true must enqueue STANDARD_RESEARCH.
3. RESEARCH must enqueue JUDGE_MARKET with researchRunId.
4. JUDGE_MARKET must use payload.researchRunId and accept a non-failed run, not only latest COMPLETED by market.
5. RISK_CHECK must use judge params from payload when available.
6. PAPER_EXECUTE must reconstruct gatedRiskResult from Decision and never pass undefined into runExecuteStage.
7. PAPER mode must allow standard BID paper orders even when A+ gate fails. LIVE mode must still require A+ and governance safety.
8. ResearchRun rows must not stay RUNNING after successful or failed research.
9. Scanner/adapters must not keep archived, closed, resolved, or past-date markets active.
10. /api/trading/candidates?aplus=true must return only score >= 90 and include riskFlags.
11. /api/orderbook list mode must include market context and support search/sort without HTTP 500.
12. Add tests proving the queued chain reaches PAPER_EXECUTE and creates order/paper bet for a valid mocked BID.

Run typecheck and relevant bun tests. Do not enable live execution. Do not make all markets trade. Preserve skip reasons and UI transparency.
```