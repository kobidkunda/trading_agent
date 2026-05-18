I inspected the newly uploaded `trading_agent-main.zip` deeply against our full project plan.

Main answer first:

# Why same trades keep getting pulled from Polymarket / Kalshi

It is **not mainly because Polymarket/Kalshi are sending “bad data.”** It is mostly because your app currently keeps re-scanning the same first pages, refreshes the same markets, then re-ranks/re-queues those same markets again.

## Exact root causes

### 1. Scanner starts from the first page again and again

Files:

```txt
src/lib/engine/scanner.ts
src/lib/venues/polymarket.ts
src/lib/venues/kalshi.ts
```

Current logic:

```txt
scanMode = INCREMENTAL_SCAN by default
cursorStart = null unless scanMode === RESUME_FROM_CURSOR
```

So in normal mode, every scan starts from the beginning:

```txt
Polymarket page 1 → page 2 → page 3...
Kalshi page 1 → page 2 → page 3...
```

These pages are usually stable/top active markets, so you repeatedly get the same BTC, politics, sports, macro, crypto markets.

### TODO

```txt
[ ] Make RESUME_FROM_CURSOR actually used for incremental scans.
[ ] Store and reuse VenueCursor per venue.
[ ] Add scan mode behavior clearly:
    FULL_SCAN = start from page 1 and scan all configured pages.
    INCREMENTAL_SCAN = continue from saved cursor or fetch only changed/new markets.
    RESUME_FROM_CURSOR = resume exactly from last cursor.
[ ] Add dashboard column: scanMode, cursorStart, cursorEnd, hasMore.
[ ] Add alert if same page set is scanned repeatedly without discovering new markets.
```

---

### 2. Every scan refreshes the same market, making it look “new”

File:

```txt
src/lib/engine/scanner-upsert.ts
```

When a market already exists, the app updates:

```txt
lastSeenAt
lastSnapshotAt
latestPrice
latestSpread
latestLiquidity
updatedAt
```

Then the UI/API sorts markets by:

```txt
updatedAt desc
lastSeenAt desc
```

So the same markets come back to the top every scan.

### Why this matters

The UI looks like it is “pulling the same trades again,” because the same market rows are being refreshed and displayed first.

### TODO

```txt
[ ] Add separate filters:
    New markets
    Changed markets
    Reprocessed markets
    Watched markets
    Already decided
    Already executed

[ ] Do not show refreshed markets as “new opportunities.”
[ ] Add lastDecisionAt and lastResearchAt to candidate table/UI.
[ ] Show “refreshed only” vs “new candidate” clearly.
```

---

### 3. Candidate cooldown is not being set after decision/execution

Files:

```txt
src/lib/engine/market-loop.ts
src/lib/engine/pipeline.ts
src/lib/engine/candidate-dedupe.ts
```

The dedupe system supports:

```txt
cooldownUntil
nextEligibleAt
lockExpiresAt
```

But the pipeline mostly sets stages like:

```txt
DECIDED
WATCHING
EXECUTED
```

without consistently setting:

```txt
nextEligibleAt
cooldownUntil
```

So the next scan can process the same market again.

### TODO

```txt
[ ] After WATCH decision, set nextEligibleAt = now + watchCooldown.
[ ] After DECIDED decision, set nextEligibleAt = now + decisionCooldown.
[ ] After EXECUTED paper order, set cooldownUntil = now + executionCooldown.
[ ] After FAILED research, set nextEligibleAt using retry/backoff.
[ ] Only bypass cooldown if price changed by configured threshold.
[ ] Add reason: COOLDOWN_ACTIVE.
```

Suggested defaults:

```txt
WATCH cooldown: 1–6 hours
DECIDED cooldown: 6–24 hours
EXECUTED cooldown: until price moves 3–5% or manual reset
FAILED research cooldown: exponential backoff
```

---

### 4. Completed jobs do not stop future re-processing

File:

```txt
src/lib/engine/candidate-job-enqueuer.ts
```

Current job dedupe checks only active jobs:

```txt
PENDING
RUNNING
RETRYING
```

Once a job is completed, the next scan can create another job for the same market again.

### TODO

```txt
[ ] Add candidate-level processing history.
[ ] Do not enqueue same stage again unless nextEligibleAt passed.
[ ] Add job dedupKey:
    venue:marketId:stage:cooldownBucket

[ ] Add unique active job rule.
[ ] Add completed-stage cooldown rule.
[ ] Add “force re-research” manual override.
```

---

### 5. Market-level dedupe exists, but processing-level dedupe is weak

Good news: schema has:

```txt
@@unique([venue, externalId])
@@unique([marketId]) on TradeCandidate
```

So duplicate market rows are mostly controlled.

But repeated **decisions / watchlist / paper orders / research jobs** can still happen for the same market.

### TODO

```txt
[ ] Add one active Watchlist entry per market unless old one is closed.
[ ] Add one active paper order per market/side unless old one is terminal.
[ ] Do not create repeated Decision rows unless a reprocess trigger exists.
[ ] Add DecisionRun or CandidateRun history if repeated analysis is needed.
[ ] Add reprocessReason:
    PRICE_MOVED
    LIQUIDITY_CHANGED
    SPREAD_IMPROVED
    NEW_WALLET_SIGNAL
    NEW_RELATED_MARKET_SIGNAL
    MANUAL_FORCE
    COOLDOWN_EXPIRED
```

---

### 6. `/api/markets` shows refreshed markets, not only fresh opportunities

File:

```txt
src/app/api/markets/route.ts
```

Current query:

```txt
orderBy updatedAt desc
```

Since every scan updates the same markets, the API returns them again.

### TODO

```txt
[ ] Add query params:
    onlyNew=true
    onlyChanged=true
    excludeCooldown=true
    excludeExecuted=true
    excludeRecentlyResearched=true
    minCandidateScore=90

[ ] Default dashboard should show A+ candidates, not just recently updated markets.
[ ] Add “Last seen” and “Last decision” badges.
```

---

# Direct answer

You are seeing the same trades because:

```txt
1. Scanner usually starts from first pages again.
2. First pages from Polymarket/Kalshi are stable.
3. Existing markets get lastSeenAt/updatedAt refreshed.
4. UI sorts by updatedAt/lastSeenAt.
5. Candidate cooldown is not consistently set.
6. Completed jobs do not block reprocessing.
7. The app refreshes the same markets but treats them like candidates again.
```

So the fix is not just “dedupe market rows.”
The fix is:

```txt
dedupe processing, cooldown decisions, and separate refreshed markets from new opportunities.
```

---

# Current implementation status

## Already implemented well

These are present in the latest codebase:

```txt
✅ DEMO / PAPER / LIVE mode separation
✅ DataSource MOCK / REAL
✅ ExecutionMode SIMULATED / REAL
✅ Market uniqueness by venue + externalId
✅ ScanRun / VenueCursor / MarketSnapshot
✅ Market latestPrice/latestSpread/latestLiquidity
✅ Candidate scoring
✅ Candidate threshold now used in market-loop
✅ A+ signal gate exists
✅ Real Polymarket orderbook fetch exists
✅ OrderbookSnapshot exists
✅ Paper order lifecycle exists
✅ Fill rows exist
✅ Wallet source abstraction exists
✅ Wallet scoring modules exist
✅ Related-market scanner exists
✅ Oracle mismatch checker exists
✅ Correlation risk modules exist
✅ Ensemble model registry exists
✅ Brier/calibration engine exists
✅ Live readiness checks exist
✅ Middleware permission system exists
✅ CI/test scripts exist
```

This is much better than the earlier repo.

---

# Remaining P0 gaps

## P0.1 — Incremental scanning is not truly incremental

Even though cursor support exists, default flow often starts from page 1.

### Files

```txt
src/lib/engine/scanner.ts
src/lib/venues/polymarket.ts
src/lib/venues/kalshi.ts
```

### TODO

```txt
[ ] Make INCREMENTAL_SCAN reuse saved cursor.
[ ] Add “scan newest only” mode if venue supports ordering.
[ ] Add “scan all pages but process only changed markets” mode.
[ ] Store marketsFetchedNew vs marketsFetchedExisting.
[ ] Add scan entropy metric: percentage of markets repeated from previous scan.
[ ] Warn if repeated market rate > 80%.
```

---

## P0.2 — Reprocessed markets are not blocked hard enough

### Files

```txt
src/lib/engine/market-loop.ts
src/lib/engine/candidate-dedupe.ts
src/lib/engine/pipeline.ts
```

Current dedupe mostly blocks:

```txt
RESEARCHING with active lock
cooldownUntil / nextEligibleAt if set
```

But cooldowns are not consistently set.

### TODO

```txt
[ ] Add final stage cooldowns.
[ ] Add hard skip for EXECUTED unless price moved by threshold.
[ ] Add hard skip for DECIDED unless new signal exists.
[ ] Add hard skip for WATCHING until recheckAt.
[ ] Persist lastDecisionAt on candidate.
[ ] Persist lastResearchAt on candidate.
[ ] Persist lastExecutedAt on candidate.
```

---

## P0.3 — Market loop and scanner-upsert both can create candidate work

### Files

```txt
src/lib/engine/scanner-upsert.ts
src/lib/engine/market-loop.ts
```

`runMarketLoopOnce()` calls scanner with:

```txt
suppressCandidateJobEnqueue: true
```

Good.

But other code paths can call `runScanner()` directly without suppression, and `scanner-upsert.ts` can enqueue candidate jobs. Then market-loop can later enqueue again after completed jobs.

### TODO

```txt
[ ] Make only one module responsible for candidate job enqueueing.
[ ] Prefer: scanner-upsert only stores market/snapshot.
[ ] Market-loop owns scoring + job enqueueing.
[ ] Or: scanner-upsert owns initial enqueue, market-loop only retries stale work.
[ ] Do not allow both to enqueue for same market/stage.
[ ] Add database dedupKey for jobs.
```

---

## P0.4 — Stage-specific jobs still run full pipeline

### File

```txt
src/lib/engine/worker.ts
```

Currently these jobs all call:

```txt
runPipelineForMarket()
```

for:

```txt
TRIAGE_MARKET
QUICK_RESEARCH
STANDARD_RESEARCH
DEEP_RESEARCH
JUDGE_MARKET
RISK_CHECK
```

So a `TRIAGE_MARKET` can run more than triage, and a `RISK_CHECK` can rerun research.

### TODO

```txt
[ ] Split pipeline into stage functions:
    runTriageStage
    runQuickResearchStage
    runStandardResearchStage
    runDeepResearchStage
    runJudgeStage
    runRiskStage
    runAPlusGateStage
    runPaperExecuteStage

[ ] Worker should call only requested stage.
[ ] Store stage outputs separately.
[ ] Retry only failed stage.
[ ] Add stage-specific checkpointing.
[ ] Add stage dashboard.
```

---

## P0.5 — PaperBet is created before fill

### File

```txt
src/lib/engine/pipeline.ts
```

Current flow:

```txt
create order
create PaperBet with executionStatus SUBMITTED
create ORDER_TRACK job
```

This is better than instant fill, but the statistics can still be dangerous unless all metrics filter only filled bets.

### Risk

Unfilled or expired submitted bets may pollute:

```txt
win rate
ROI
Brier
A+ sample count
```

### TODO

```txt
[ ] Ensure A+ performance counts only FILLED or PARTIAL with non-zero fill.
[ ] Exclude SUBMITTED / FAILED / EXPIRED from ROI/Brier.
[ ] Add PaperBet executionStatus filter everywhere.
[ ] If order expires, mark PaperBet EXPIRED and never count it.
[ ] For partial fill, stake must equal filled size, not intended size.
[ ] Add executionAdjustedStake field if needed.
```

---

## P0.6 — A+ gate still depends on inferred orderbook source

### File

```txt
src/lib/engine/pipeline.ts
```

A+ gate uses:

```txt
spreadSource: latestOrderbook ? REAL_ORDERBOOK : ESTIMATED
```

But existence of an `OrderbookSnapshot` does not always prove that the current spread was real and fresh.

### TODO

```txt
[ ] Store spreadSource on OrderbookSnapshot.
[ ] Store orderbookSource = CLOB / KALSHI_BOOK / ESTIMATED.
[ ] Store orderbookAgeSeconds.
[ ] A+ gate must require:
    spreadSource = REAL_ORDERBOOK
    orderbookAgeSeconds <= max threshold
    bestBid/bestAsk present
    fillProbability present
```

---

## P0.7 — Edge scoring can reward negative edge without explicit side

### File

```txt
src/lib/engine/candidate-scoring.ts
```

Current:

```txt
edgeScore = abs(adjustedEdge)
```

This can be okay only if the system explicitly treats negative edge as a possible NO-side opportunity.

But the score explanation does not clearly show:

```txt
edge side = YES or NO
```

### TODO

```txt
[ ] Store edgeDirection:
    YES_EDGE
    NO_EDGE
    NO_EDGE_UNKNOWN

[ ] Show edge side in candidate UI.
[ ] A+ gate should receive side-aware adjusted edge.
[ ] Do not reward negative edge unless NO side is executable.
[ ] Add tests for YES and NO edge scoring.
```

---

# P1 gaps — intelligence modules exist but not fully wired

## P1.1 — Wallet source connector is still not live

### Files

```txt
src/lib/engine/wallet-source.ts
src/lib/engine/wallet-ingestion.ts
src/lib/engine/wallet-signal.ts
```

There is a good abstraction:

```txt
WalletSourceAdapter
```

But real Polymarket wallet ingestion is still not implemented.

### TODO

```txt
[ ] Add real Polymarket wallet source adapter.
[ ] Fetch wallet trades.
[ ] Fetch wallet positions.
[ ] Fetch realized PnL.
[ ] Fetch open PnL.
[ ] Map externalMarketId to Market.id.
[ ] Add wallet source cursor.
[ ] Add wallet ingestion job.
[ ] Add wallet ingestion dashboard.
```

---

## P1.2 — Wallet signals are not part of initial scanner-upsert score

### File

```txt
src/lib/engine/scanner-upsert.ts
```

Initial score uses:

```txt
liquidity
spread
volume
freshness
```

It does not use wallet signals there.

Market-loop later may include existing candidate wallet score, but real-time wallet signal is not consistently calculated during candidate creation.

### TODO

```txt
[ ] Compute wallet signal after market upsert.
[ ] Store walletSignalScore on TradeCandidate.
[ ] Trigger deep research if trusted wallet cluster appears.
[ ] Show wallet signal source and confidence.
```

---

## P1.3 — Wallet uniqueness should include venue

### Schema

Current:

```txt
Wallet.address @unique
venue String
```

If the same address-like string appears on different venues, it collides.

### TODO

```txt
[ ] Change unique rule to @@unique([venue, address]).
[ ] Add migration.
[ ] Update wallet ingestion queries.
[ ] Update wallet ranking queries.
```

---

## P1.4 — Related-market scanner still has relationship naming mismatch

### File

```txt
src/lib/engine/related-market.ts
src/lib/types/index.ts
```

Types define:

```txt
VENUE_DUPLICATE
```

Related-market code uses:

```txt
DUPLICATE
```

### TODO

```txt
[ ] Standardize to VENUE_DUPLICATE or SAME_OUTCOME.
[ ] Migrate existing related-market rows if needed.
[ ] Add tests for all relationship types.
```

---

## P1.5 — Directional related-market logic can be risky

For relationships like:

```txt
A_IMPLIES_B
B_IMPLIES_A
NESTED_THRESHOLD
```

order matters.

### TODO

```txt
[ ] Store sourceMarketId and targetMarketId for directional relationships.
[ ] Do not sort pair IDs for directional relationships.
[ ] Test:
    BTC > 120K implies BTC > 100K
    not the reverse.
```

---

## P1.6 — Related-market scanner still compares limited universe

### File

```txt
src/lib/engine/related-market.ts
```

It still limits comparison set.

### TODO

```txt
[ ] Compare against all active markets in same entity/category cluster.
[ ] Add entity index.
[ ] Add market relation scan job.
[ ] Add relation scan run records.
[ ] Add “related-market signal stale” indicator.
```

---

## P1.7 — Oracle check exists but is not automatically guaranteed before A+

### Files

```txt
src/lib/engine/oracle-mismatch.ts
src/lib/engine/pipeline.ts
```

Pipeline blocks A+ if oracle check is missing, which is good. But the scan/candidate flow should automatically create the OracleCheck before the candidate reaches A+ evaluation.

### TODO

```txt
[ ] Run oracle check automatically for score >= threshold.
[ ] Store OracleCheck before deep research or A+ gate.
[ ] Add oracleCheck job type.
[ ] Add manual review workflow for HIGH/BLOCK risk.
[ ] Add UI: oracle source, criteria, ambiguity, manual review status.
```

---

## P1.8 — Bias correction is still heuristic, not truly trained

### File

```txt
src/lib/engine/bias-correction.ts
```

It has Wang transform and category defaults, but no persisted trained model table.

### TODO

```txt
[ ] Add BiasModelVersion table.
[ ] Train bias model from resolved markets.
[ ] Store category sample count.
[ ] Store probability-bucket calibration.
[ ] Store active version.
[ ] Mark correction as HEURISTIC until sample sufficient.
[ ] Do not allow heuristic-only bias correction to justify A+.
```

---

## P1.9 — Model registry exists but ensemble is not fully governed by it

### Files

```txt
src/lib/engine/model-registry.ts
src/lib/engine/ensemble-probability.ts
```

`ModelRegistryRecord` exists, but ensemble still often uses recent `EnsemblePrediction` weights.

### TODO

```txt
[ ] Use ModelRegistry.getWeights(category) in ensemble.
[ ] Store each model output with model version.
[ ] Update registry after outcomes.
[ ] Disable weak models automatically after sufficient sample size.
[ ] Show active model weights in UI.
```

---

## P1.10 — TradingAgents native graph is still underused

### Files

```txt
src/lib/engine/research/tradingagents-api.ts
ta-service/server.py
```

The TypeScript pipeline mainly uses:

```txt
runTradingAgentsSimple()
/analyze/all
```

This is useful, but not the full native TradingAgents graph.

### TODO

```txt
[ ] Add native TradingAgents endpoint in ta-service.
[ ] Use TradingAgentsGraph.propagate() for financial/ticker-like markets.
[ ] Route BTC/ETH/stock/macro markets to native TradingAgents.
[ ] Keep /analyze/all for cheap quick analysis.
[ ] Store analyst reports:
    fundamentals
    sentiment
    news
    technical
    bull researcher
    bear researcher
    trader
    risk manager
    portfolio manager

[ ] Feed TradingAgents result into ensemble, not direct execution.
```

---

# P2 gaps — safety / deployment

## P2.1 — Auth still relies on development bypass patterns

### Files

```txt
middleware.ts
src/lib/engine/auth.ts
```

Good: middleware exists.

But in local development, it accepts:

```txt
x-role
```

This is okay only for local dev, but dangerous if exposed accidentally.

### TODO

```txt
[ ] Add real login/session auth before public deployment.
[ ] Allow x-role only when LOCAL_DEV_AUTH_BYPASS=true.
[ ] Ensure production rejects x-role spoofing.
[ ] Add userId to audit logs.
[ ] Protect credentials/mode/live routes.
```

---

## P2.2 — Secrets exist in archive

I saw files like:

```txt
.env
creds-current.yml
```

I did not inspect or expose values, but their presence is a risk.

### TODO

```txt
[ ] Remove .env from repo/archive.
[ ] Remove creds-current.yml from repo/archive.
[ ] Rotate any keys that may have been exposed.
[ ] Keep only .env.example.
[ ] Add secret scanning in CI.
[ ] Update .gitignore.
```

---

## P2.3 — Build still ignores TypeScript errors

### File

```txt
next.config.ts
```

Current:

```txt
typescript.ignoreBuildErrors = true
```

### TODO

```txt
[ ] Add prebuild typecheck.
[ ] Remove ignoreBuildErrors after stabilization.
[ ] Treat typecheck failure as build failure.
[ ] Do not trust build unless CI typecheck passes.
```

---

## P2.4 — Hardcoded LAN URLs remain

Examples found:

```txt
192.168.88.96
192.168.88.97
```

In:

```txt
src/lib/constants/index.ts
src/components/trading/*
ta-service/server.py
```

### TODO

```txt
[ ] Move all service URLs to env/settings.
[ ] Remove LAN IP defaults from production code.
[ ] Show service missing/offline in System Health.
[ ] Add fallback provider behavior.
```

---

# Why your repeated trades issue happens — exact flow

This is the current cycle:

```txt
1. Worker or live simulation starts PAPER loop.
2. runMarketLoopOnce() runs.
3. runScanner() scans Polymarket/Kalshi.
4. Scanner usually starts from first page unless RESUME_FROM_CURSOR.
5. Same active markets are fetched again.
6. upsertScannedMarket() updates same Market rows.
7. Market.lastSeenAt and updatedAt become fresh again.
8. market-loop queries active markets ordered by lastSeenAt desc.
9. Same refreshed markets become top candidates again.
10. Dedupe does not block unless cooldown/lock exists.
11. Candidate may get re-scored.
12. Completed previous jobs do not block new jobs.
13. New research/risk/watch/order flow can happen again.
```

So the bot is doing:

```txt
same markets refreshed → same markets sorted top → same markets reprocessed
```

instead of:

```txt
same markets refreshed → check if changed enough → skip until cooldown
```

---

# The real fix for repeated trades

## Add a reprocessing gate

Before any market is queued again, check:

```txt
Has price moved enough?
Has liquidity changed enough?
Has spread improved enough?
Is there new wallet signal?
Is there new related-market contradiction?
Is oracle risk newly resolved?
Has cooldown expired?
Was manual force-research clicked?
```

If no:

```txt
do not enqueue
```

### TODO

```txt
[ ] Add shouldReprocessMarket().
[ ] Add reprocessReason field.
[ ] Add lastQueuedAt.
[ ] Add lastDecisionAt.
[ ] Add lastExecutionAt.
[ ] Add lastResearchAt.
[ ] Add minimum reprocess interval.
[ ] Add significant-change thresholds:
    priceMove >= 3%
    liquidityChange >= 25%
    spreadImprovement >= 30%
    newWalletCluster = true
    newRelatedMarketSignal = true
```

---

# Most important TODO list

## Scanner / source TODOs

```txt
[ ] Make incremental scan truly use cursor.
[ ] Add full vs incremental vs resume behavior clearly.
[ ] Add scan repeat-rate metric.
[ ] Add real “new markets found” count.
[ ] Add “changed markets found” count.
[ ] Avoid treating refreshed markets as new candidates.
[ ] Make maxPages per venue configurable in UI.
```

## Candidate / dedupe TODOs

```txt
[ ] Add cooldown after WATCH/DECIDED/EXECUTED.
[ ] Add shouldReprocessMarket().
[ ] Add reprocessReason.
[ ] Add lastQueuedAt / lastDecisionAt / lastResearchAt / lastExecutionAt.
[ ] Add hard block for EXECUTED unless material change.
[ ] Add one active job per market/stage.
[ ] Add one active watchlist entry per market.
```

## Job / worker TODOs

```txt
[ ] Stop using full pipeline for every stage job.
[ ] Split true stage functions.
[ ] Retry only failed stage.
[ ] Prevent completed job requeue until cooldown.
[ ] Add job dedupKey.
[ ] Add job history view by market.
```

## Paper execution TODOs

```txt
[ ] Count only filled paper bets in ROI/Brier.
[ ] Exclude SUBMITTED/FAILED/EXPIRED from performance.
[ ] Create/update PaperBet only after fill or mark intent separately.
[ ] Store fill provenance.
[ ] Require fresh real orderbook for A+.
```

## A+ gate TODOs

```txt
[ ] Fail closed on missing oracle check.
[ ] Fail closed on stale/missing orderbook.
[ ] Require real spread source.
[ ] Load A+ config from StrategyConfigVersion.
[ ] Store config version on Decision/PaperBet.
[ ] Add historical setup sample requirement before live.
```

## Wallet TODOs

```txt
[ ] Implement real Polymarket wallet source.
[ ] Map wallet trades to Market.id.
[ ] Add venue+address uniqueness.
[ ] Persist wallet cluster signals.
[ ] Feed wallet signal into candidate scoring.
```

## Related-market TODOs

```txt
[ ] Fix DUPLICATE vs VENUE_DUPLICATE naming.
[ ] Preserve direction for A_IMPLIES_B / B_IMPLIES_A.
[ ] Avoid using fallback 0.5 price for signal.
[ ] Scan a wider related-market universe.
[ ] Feed related-market signal into A+ scoring.
```

## Security TODOs

```txt
[ ] Remove secrets from archive.
[ ] Add real auth before public deployment.
[ ] Remove hardcoded LAN URLs.
[ ] Keep x-role only in local dev.
[ ] Remove ignoreBuildErrors eventually.
```

---

# Final prioritized implementation order

## Milestone 1 — stop repeated same trades

```txt
[ ] Implement true incremental/resume scanning.
[ ] Add candidate cooldowns.
[ ] Add shouldReprocessMarket().
[ ] Add lastDecisionAt / lastResearchAt / lastExecutionAt.
[ ] Add job dedupKey.
[ ] UI filter: show only new/changed/A+ markets.
```

## Milestone 2 — trusted paper metrics

```txt
[ ] Require real orderbook for A+.
[ ] Count only filled paper bets.
[ ] Exclude expired/failed/submitted from ROI/Brier.
[ ] Store fill rows and fill provenance.
[ ] Add paper execution dashboard by fill status.
```

## Milestone 3 — stage reliability

```txt
[ ] Split pipeline into stage-specific functions.
[ ] Worker runs only requested stage.
[ ] Retry only failed stage.
[ ] Add checkpoint/recovery per stage.
```

## Milestone 4 — alpha intelligence wiring

```txt
[ ] Wallet source connector.
[ ] Related-market signal hardening.
[ ] Oracle check automation.
[ ] Model registry weights in ensemble.
[ ] Bias model persistence.
[ ] Native TradingAgents for financial markets.
```

## Milestone 5 — production safety

```txt
[ ] Real auth.
[ ] Secret cleanup.
[ ] Remove LAN defaults.
[ ] Stronger CI regression tests.
[ ] Live readiness based only on filled A+ paper proof.
```

---

# Final answer

The repeated trades are happening because the app is currently doing:

```txt
refresh same venue pages
→ update same markets
→ sort refreshed markets to top
→ no strong cooldown/reprocess gate
→ enqueue same market again
```

The fix is:

```txt
scan all / resume correctly
separate refreshed vs new markets
cool down processed candidates
only reprocess on material change
dedupe jobs by market+stage
count only filled paper bets
```

Your codebase is close to a serious system, but the next work should be **not more features**. The next work should be:

```txt
Trusted PAPER Mode v1:
real scan behavior,
no repeated reprocessing,
strict A+ gate,
fresh orderbook,
filled-only metrics,
stage-specific jobs,
and safe dashboards.
```
