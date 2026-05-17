I inspected the new uploaded repo: **`trading_agent-main (5).zip`**.

I extracted and reviewed the relevant implementation files across:

```txt
prisma/schema.prisma
package.json
next.config.ts
middleware.ts
AGENTS.md
src/lib/engine/*
src/lib/venues/*
src/lib/types/*
src/app/api/*
ta-service/server.py
.github/workflows/ci.yml
```

The repo is now much more advanced than earlier versions. Many things from the previous plan are already present. The remaining gaps are mostly **wiring, correctness, safety, and validation gaps**.

---

# Executive verdict

Your latest repo already has the bones of the system:

```txt
✅ DEMO / PAPER / LIVE modes
✅ DataSource MOCK / REAL
✅ execution lifecycle enums
✅ Market uniqueness constraint
✅ ScanRun / VenueCursor / MarketSnapshot
✅ Candidate scoring
✅ A+ signal gate module
✅ Wallet models and wallet intelligence modules
✅ Ensemble probability module
✅ Bias correction module
✅ Related-market scanner
✅ Oracle mismatch module
✅ Correlation cluster/risk modules
✅ Orderbook snapshot schema
✅ Paper order lifecycle
✅ Brier/calibration functions
✅ Backtest/walk-forward files
✅ API permission matrix
✅ Middleware exists
✅ CI workflow exists
```

But the system is **not yet fully trustworthy for real PAPER performance**, because the advanced modules are not consistently connected into the main execution loop.

The main issue is:

```txt
The repo has many advanced modules, but the active pipeline still does not reliably behave like a full A+ prediction-market alpha engine.
```

---

# Highest-level remaining gaps

```txt
1. Scanner still does not fetch enough real orderbook data.
2. Polymarket spread is still synthetic/estimated in key path.
3. Market loop does not use the full advanced scoring stack.
4. Candidate threshold exists but is not actually used in market-loop.
5. Scanner and market-loop create candidate jobs in overlapping/inconsistent ways.
6. Paper fill model names are inconsistent across files.
7. Paper order creation ignores fill model / expiry fields.
8. PaperBet is created before order fill, so performance metrics can count unfilled bets.
9. Strategy stage jobs are not truly stage-specific; many all run the full pipeline.
10. Wallet modules exist, but real wallet ingestion source is still not implemented.
11. Related-market scanner uses Market.latestPrice, but scanner does not update latestPrice.
12. Correlation clusters exist, but cluster risk is not passed into the main risk engine.
13. API auth exists, but currently trusts x-role header, so it is not production-secure.
14. Build ignores TypeScript errors.
15. TradingAgents native full graph is still underused in the main TypeScript path.
```

---

# What is no longer a gap

These were earlier issues, but in v5 they are now mostly implemented.

## Fixed / mostly fixed

```txt
✅ Market has @@unique([venue, externalId])
✅ TradeCandidate has scoring fields
✅ PaperBet has setupType and aPlusStatus
✅ Order lifecycle fields exist
✅ WalletTrade has uniqueness constraint
✅ ModelRegistryRecord exists
✅ CorrelationCluster exists
✅ OracleCheck exists
✅ RelatedMarket exists
✅ StrategyConfigVersion exists
✅ BacktestRun exists
✅ OrderbookSnapshot exists
✅ ResearchCheckpoint exists
✅ API_PERMISSION_MATRIX exists
✅ Middleware exists
✅ CI workflow exists
✅ AGENTS.md is updated to current direction
```

So the next work should not be “add more files.”
The next work should be:

```txt
make existing files truthful, connected, and testable
```

---

# P0 gaps — must fix before trusting PAPER results

## P0.1 — Polymarket spread is still synthetic

File:

```txt
src/lib/venues/polymarket.ts
```

Current behavior:

```txt
bestBid = price * 0.99
bestAsk = price * 1.01
spread = abs(price - (1 - price)) * 0.02
```

This is not real bid/ask spread.

Why this is dangerous:

```txt
A market can look tradeable even if the real book is wide/thin.
A+ gate can misread market quality.
Paper execution can simulate fake fills.
Adjusted edge can be fake.
```

### TODO

```txt
[ ] Add real Polymarket CLOB orderbook fetch.
[ ] Fetch orderbook by token / market.
[ ] Store real bestBid.
[ ] Store real bestAsk.
[ ] Store real spread = bestAsk - bestBid.
[ ] Store bidDepth.
[ ] Store askDepth.
[ ] Store priceImpact.
[ ] Store fillProbability.
[ ] Store raw orderbook JSON.
[ ] Add spreadSource = REAL_ORDERBOOK only when real book was fetched.
[ ] Mark synthetic spread as ESTIMATED.
[ ] Block A+ execution when spreadSource = ESTIMATED.
[ ] Allow ESTIMATED only for WATCH / TRIAGE.
```

Acceptance rule:

```txt
No A+ PAPER bet without real orderbook spread.
```

---

## P0.2 — Scanner pagination is still limited

Files:

```txt
src/lib/engine/scanner.ts
src/lib/venues/polymarket.ts
src/lib/venues/kalshi.ts
```

Current defaults:

```txt
Polymarket maxPages = 5
Kalshi maxPages = 3
```

The plan says:

```txt
scan all active markets
```

But the code still fetches a limited slice.

### TODO

```txt
[ ] Make maxPagesPerVenue configurable.
[ ] Add scanUntilNoCursor option.
[ ] Add scan timeout.
[ ] Add rate-limit delay.
[ ] Persist cursorStart.
[ ] Persist cursorEnd.
[ ] Persist hasMore.
[ ] Implement FULL_SCAN.
[ ] Implement INCREMENTAL_SCAN.
[ ] Implement RESUME_FROM_CURSOR.
[ ] Show scan page count in dashboard.
[ ] Add alert when scan suddenly returns fewer markets than normal.
```

Acceptance rule:

```txt
PAPER mode must scan all configured active markets, not only first few pages.
```

---

## P0.3 — Market latest fields are not updated

File:

```txt
src/lib/engine/scanner-upsert.ts
```

Schema has:

```txt
Market.latestPrice
Market.latestSpread
Market.latestLiquidity
Market.lastSnapshotAt
```

But `scanner-upsert.ts` creates snapshots and historical snapshots without updating these `Market.latest*` fields.

Why this matters:

```txt
Related-market scanner uses latestPrice.
Dashboards may show stale/null values.
Correlation and ranking can use old data.
Candidate freshness becomes unreliable.
```

### TODO

```txt
[ ] On every scan, update Market.latestPrice.
[ ] Update Market.latestSpread.
[ ] Update Market.latestLiquidity.
[ ] Update Market.lastSnapshotAt.
[ ] Update Market.lastSeenAt.
[ ] Update latest volume if available.
[ ] Add test: scan updates latestPrice and related-market scanner reads it.
```

Acceptance rule:

```txt
After each scan, Market row must reflect latest snapshot summary.
```

---

## P0.4 — Market resolutionTime is not populated

File:

```txt
src/lib/engine/scanner-upsert.ts
src/lib/venues/polymarket.ts
src/lib/venues/kalshi.ts
```

Schema supports:

```txt
Market.resolutionTime
```

But scanner input does not include resolution time.

Why this matters:

```txt
date-window risk cluster does not work
near-expiry logic is weak
oracle/cutoff checks are weaker
backtesting and outcome polling become harder
```

### TODO

```txt
[ ] Add resolutionTime to ScannerMarketInput.
[ ] Map Polymarket end_date_iso / endDate to resolutionTime.
[ ] Map Kalshi close_time / expiration_time to resolutionTime.
[ ] Store resolutionTime on Market create and update.
[ ] Use resolutionTime for date clusters.
[ ] Use resolutionTime for near-expiry risk.
[ ] Use resolutionTime for scan filters.
```

Acceptance rule:

```txt
Every market with known close/resolution date must store resolutionTime.
```

---

## P0.5 — Candidate threshold exists but is not used

File:

```txt
src/lib/engine/market-loop.ts
```

Current code reads:

```txt
const candidateThreshold = config.candidateThreshold ?? 75;
```

But then does not use it.

Why this matters:

```txt
UI/config says one thing.
Market loop does another thing.
Weak candidates can still be queued.
```

### TODO

```txt
[ ] Apply candidateThreshold before job creation.
[ ] If score < candidateThreshold, keep as snapshot/watch only.
[ ] Store skip reason: BELOW_CANDIDATE_THRESHOLD.
[ ] Add dashboard indicator for threshold.
[ ] Add test: lowering/raising threshold changes queued jobs.
```

Acceptance rule:

```txt
candidateThreshold must directly control which markets enter the research queue.
```

---

## P0.6 — Market loop only scores latest 200 markets

File:

```txt
src/lib/engine/market-loop.ts
```

Current behavior:

```txt
take: 200
```

Why this is a gap:

```txt
The bot may miss the best opportunity if it is not in the latest 200.
```

### TODO

```txt
[ ] Replace hardcoded take: 200 with config.
[ ] Add batching.
[ ] Score all fresh active markets.
[ ] Prefer sorting by freshness + liquidity + volatility + category priority.
[ ] Add pagination in scoring loop.
```

Acceptance rule:

```txt
Market-loop scoring should cover all fresh active markets, not a fixed arbitrary slice.
```

---

## P0.7 — Market loop does not use the full advanced signal stack

File:

```txt
src/lib/engine/market-loop.ts
```

Current market-loop scoring uses mostly:

```txt
liquidity
spread
volume
freshness
price move
category priority
basic penalties
```

But the plan requires:

```txt
wallet signal
related-market signal
oracle risk
orderbook quality
bias-adjusted edge
model disagreement
correlation risk
tail risk
source quality
resolution clarity
```

The modules exist, but they are not fully used at the first ranking stage.

### TODO

```txt
[ ] Feed walletSignalScore into computeCandidateScore.
[ ] Feed relatedMarketSignal into computeCandidateScore.
[ ] Feed oracleRiskPenalty into computeCandidateScore.
[ ] Feed orderbookQuality into computeCandidateScore.
[ ] Feed correlationRiskPenalty into computeCandidateScore.
[ ] Feed manipulationRiskPenalty into computeCandidateScore.
[ ] Feed sourceQuality when research exists.
[ ] Feed resolutionClarity when oracle check exists.
[ ] Feed adjustedEdge when probability model exists.
[ ] Store full score breakdown.
```

Acceptance rule:

```txt
Candidate score shown in UI must explain all important inputs, not just liquidity/spread.
```

---

## P0.8 — Scanner-upsert enqueues wrong candidateId for new candidates

File:

```txt
src/lib/engine/scanner-upsert.ts
```

Current issue:

```txt
await db.tradeCandidate.create(...)
...
enqueueCandidateJobs(scoreAction, {
  marketId: created.id,
  candidateId: created.id
})
```

`candidateId` should be the TradeCandidate id, not the Market id.

### TODO

```txt
[ ] Save created TradeCandidate return value.
[ ] Pass tradeCandidate.id as candidateId.
[ ] Add test: new market enqueues job with correct candidateId.
[ ] Add validation in job worker: candidateId must exist if provided.
```

Acceptance rule:

```txt
Job payload candidateId must always point to TradeCandidate.id.
```

---

## P0.9 — Market-loop and scanner-upsert both create candidate jobs

Files:

```txt
src/lib/engine/scanner-upsert.ts
src/lib/engine/market-loop.ts
```

`scanner-upsert.ts` uses:

```txt
enqueueCandidateJobs(scoreAction, ...)
```

`market-loop.ts` separately creates:

```txt
TRIAGE_MARKET jobs
```

This can duplicate work and create inconsistent job routing.

### TODO

```txt
[ ] Decide one owner for job enqueueing.
[ ] Prefer scanner-upsert creates initial candidate jobs.
[ ] Market-loop should only monitor/fill gaps/retry stale candidates.
[ ] Add duplicate job prevention by marketId + job type + status.
[ ] Add test: one scan creates at most one active research job per market.
```

Acceptance rule:

```txt
A market should not get duplicate active jobs for the same stage.
```

---

## P0.10 — All research-stage jobs run the full pipeline

File:

```txt
src/lib/engine/worker.ts
```

Current behavior:

```txt
TRIAGE_MARKET
QUICK_RESEARCH
STANDARD_RESEARCH
DEEP_RESEARCH
JUDGE_MARKET
RISK_CHECK
```

all call:

```txt
runPipelineForMarket(marketId)
```

So stages are not actually independent.

Why this matters:

```txt
Retries are expensive.
Failures are hard to resume.
A TRIAGE job can run full deep work.
A RISK_CHECK can re-run research.
```

### TODO

```txt
[ ] Split runPipelineForMarket into stage functions:
    - runTriageStage
    - runQuickResearchStage
    - runStandardResearchStage
    - runDeepResearchStage
    - runJudgeStage
    - runRiskStage
    - runAPlusGateStage
    - runPaperExecuteStage

[ ] Worker should call only the requested stage.
[ ] Store stage output after each stage.
[ ] Retry only failed stage.
[ ] Save checkpoint per stage.
[ ] Add stage status UI.
```

Acceptance rule:

```txt
A RISK_CHECK job must not re-run full research.
```

---

# P0 — paper execution gaps

## P0.11 — Fill model names are inconsistent

Files:

```txt
src/lib/types/index.ts
src/lib/engine/trading-config.ts
src/lib/engine/paper-execution.ts
src/lib/engine/order-tracker.ts
```

Current types conflict.

In `types/index.ts`:

```txt
FillModel =
  DEMO_INSTANT
  STRICT_LIMIT
  BOOK_DEPTH_AWARE
  CONSERVATIVE_PAPER
```

But `trading-config.ts` uses:

```txt
INSTANT
BOOK_AWARE
```

And `paper-execution.ts` accepts:

```txt
INSTANT | BOOK_AWARE
```

This is a major correctness gap.

### TODO

```txt
[ ] Standardize FillModel everywhere.
[ ] Remove INSTANT / BOOK_AWARE old names.
[ ] Use:
    DEMO_INSTANT
    STRICT_LIMIT
    BOOK_DEPTH_AWARE
    CONSERVATIVE_PAPER

[ ] Update trading-config.
[ ] Update paper-execution.
[ ] Update order-tracker.
[ ] Update tests.
[ ] Add migration for old stored fillModel values.
```

Acceptance rule:

```txt
Only one FillModel enum exists across the app.
```

---

## P0.12 — Paper order creation ignores fillModel / expiry / execution notes

File:

```txt
src/lib/engine/paper-execution.ts
src/lib/engine/pipeline.ts
```

Pipeline calls:

```txt
buildPaperOrderRecord({
  ...
  fillModel: tradingConfig.paperFillModel,
  orderExpiryMinutes: tradingConfig.orderExpiryMinutes,
  executionNotesJson: ...
})
```

But `buildPaperOrderRecord()` does not accept these fields.

Because it is cast as:

```txt
as unknown as Record<string, unknown>
```

TypeScript errors can be hidden.

### TODO

```txt
[ ] Add fillModel to buildPaperOrderRecord params.
[ ] Add orderExpiryMinutes to params.
[ ] Calculate orderExpiryAt.
[ ] Add executionNotesJson param.
[ ] Store fillModel on Order.
[ ] Store orderExpiryAt on Order.
[ ] Store executionNotesJson on Order.
[ ] Remove unsafe cast.
[ ] Add typecheck test.
```

Acceptance rule:

```txt
Paper order must store exact fill model and expiry rules used.
```

---

## P0.13 — Order status and lifecycle are inconsistent

File:

```txt
src/lib/engine/paper-execution.ts
```

Current order record:

```txt
lifecycleStatus: SUBMITTED
status: PLANNED
```

This is confusing and can break dashboards.

### TODO

```txt
[ ] Decide canonical mapping.
[ ] If lifecycleStatus = SUBMITTED, status should be SUBMITTED.
[ ] Use PLANNED only before submission.
[ ] Add validation helper.
[ ] Add tests for lifecycle/status consistency.
```

Acceptance rule:

```txt
Order.status and Order.lifecycleStatus must not contradict each other.
```

---

## P0.14 — PaperBet is created before order fill

File:

```txt
src/lib/engine/pipeline.ts
```

Current flow:

```txt
create Order
create PaperBet immediately
create ORDER_TRACK job
```

This means:

```txt
An unfilled order can still become a PaperBet.
A+ ROI/Brier can count a bet that never actually filled.
Entry price can be theoretical, not actual fill price.
```

### TODO

```txt
[ ] Link PaperBet to Order.
[ ] Add orderId to PaperBet or create PaperBet only after fill.
[ ] If order expires/failed, mark PaperBet as NOT_EXECUTED.
[ ] Only resolved filled PaperBets count toward A+ stats.
[ ] Use avgFillPrice as entryPrice.
[ ] Add executionStatus to PaperBet:
    PLANNED
    SUBMITTED
    FILLED
    PARTIAL
    FAILED
    EXPIRED
```

Acceptance rule:

```txt
A+ win rate / ROI must count only filled paper bets.
```

---

## P0.15 — Fill rows are not created

Schema has:

```txt
Fill
```

But `order-tracker.ts` updates `Order` and `Position` without creating a `Fill` record.

Why this matters:

```txt
No fill audit trail.
Hard to debug partial fills.
Hard to backtest execution realism.
```

### TODO

```txt
[ ] Create Fill row for every incremental fill.
[ ] Store price.
[ ] Store size.
[ ] Store timestamp.
[ ] Store liquidity/slippage/priceImpact at fill time.
[ ] Store fill model used.
[ ] Store orderbook snapshot id if available.
```

Acceptance rule:

```txt
Every non-zero paper fill must create a Fill record.
```

---

## P0.16 — Conservative fill models are not implemented

File:

```txt
src/lib/engine/paper-execution.ts
```

Current logic:

```txt
INSTANT
BOOK_AWARE
```

But plan requires:

```txt
DEMO_INSTANT
STRICT_LIMIT
BOOK_DEPTH_AWARE
CONSERVATIVE_PAPER
```

### TODO

```txt
[ ] DEMO_INSTANT:
    - only DEMO mode
    - excluded from real metrics

[ ] STRICT_LIMIT:
    - fill only if price crosses book
    - no heuristic fill

[ ] BOOK_DEPTH_AWARE:
    - fill only based on available depth

[ ] CONSERVATIVE_PAPER:
    - worse price
    - partial fill possible
    - slippage applied
    - no fill if book stale
```

Acceptance rule:

```txt
Trusted PAPER Mode must use CONSERVATIVE_PAPER or STRICT_LIMIT, never DEMO_INSTANT.
```

---

# P0 — A+ gate and risk gaps

## P0.17 — A+ gate exists, but input data is incomplete

File:

```txt
src/lib/engine/a-plus/signal-gate.ts
src/lib/engine/pipeline.ts
```

Good: A+ gate now downgrades BID to WATCH if it fails.

Gap: the gate receives weak/incomplete inputs:

```txt
spreadSource inferred from latestOrderbook existence
orderbookQuality heuristic
oracle unknown can behave like low risk
correlationExposure approximated from category exposure
tailRiskScore partly heuristic
no setup historical performance
no strategy config version
```

### TODO

```txt
[ ] Store and pass actual spreadSource from snapshot/orderbook.
[ ] Do not infer REAL_ORDERBOOK from existence of any orderbook row.
[ ] Require real orderbook source provenance.
[ ] Treat missing oracle check as UNKNOWN, not LOW.
[ ] Require OracleCheck before A+.
[ ] Pass real cluster exposure from correlation-risk module.
[ ] Pass real tail-risk score.
[ ] Pass historical setup win rate.
[ ] Pass strategy config version.
[ ] Block A+ if any required input is missing.
```

Acceptance rule:

```txt
A+ gate must fail closed, not pass with unknown data.
```

---

## P0.18 — A+ config is not strategy-versioned

Files:

```txt
src/lib/constants/index.ts
src/lib/engine/a-plus/signal-gate.ts
prisma/schema.prisma
```

Default config exists:

```txt
DEFAULT_APLUS_CONFIG
```

But every decision should record exactly which config version was used.

### TODO

```txt
[ ] Store APlusSignalConfig in StrategyConfigVersion.
[ ] Load A+ config from active strategy version.
[ ] Store strategyConfigVersionId on Decision.
[ ] Store strategyConfigVersionId on Order.
[ ] Store strategyConfigVersionId on PaperBet.
[ ] Store config snapshot JSON on Decision.
```

Acceptance rule:

```txt
Every decision must be reproducible from its config version.
```

---

## P0.19 — Risk engine still has hardcoded policy constants

File:

```txt
src/lib/engine/risk.ts
```

Hardcoded examples:

```txt
MAX_POSITION_SIZE = 5000
BID_EDGE_THRESHOLD = 0.05
WATCH_EDGE_THRESHOLD = 0.02
MAX_DAILY_EXPOSURE = 50000
MAX_CATEGORY_EXPOSURE = 10000
MAX_SPREAD = 0.05
```

This conflicts with strategy config.

### TODO

```txt
[ ] Move all risk constants into strategy config.
[ ] Use category-specific thresholds.
[ ] Use active StrategyConfigVersion.
[ ] Remove hardcoded max position from computePositionSize.
[ ] Store risk config version on Decision.
[ ] Add tests: config changes risk output.
```

Acceptance rule:

```txt
Risk behavior must be controlled by active strategy config, not hidden constants.
```

---

## P0.20 — Cluster/tail risk is not passed into main pipeline risk

Files:

```txt
src/lib/engine/correlation-risk.ts
src/lib/engine/risk-exposure.ts
src/lib/engine/risk.ts
src/lib/engine/pipeline.ts
```

`risk.ts` supports cluster options, but `pipeline.ts` does not pass real cluster exposure into `computeRisk()`.

Currently correlation exposure used in A+ gate is mostly approximated from category exposure.

### TODO

```txt
[ ] Call computeClusterAwareExposure() in pipeline.
[ ] Pass clusterExposures to computeRisk().
[ ] Pass tailRiskWarnings to computeRisk().
[ ] Pass clusterOverlapCount to computeRisk().
[ ] Block BID when cluster utilization exceeds threshold.
[ ] Show cluster blockers in Decision.reason.
```

Acceptance rule:

```txt
A group of correlated markets must be blocked before paper execution.
```

---

# P1 gaps — high priority intelligence wiring

## P1.1 — Wallet source connector is still missing

Files:

```txt
src/lib/engine/wallet-source.ts
src/lib/engine/wallet-ingestion.ts
```

There is a nice abstraction:

```txt
WalletSourceAdapter
```

But real source adapters return empty / disabled.

So the wallet system exists but is not live.

### TODO

```txt
[ ] Add real Polymarket wallet activity source.
[ ] Add getWalletTrades(address).
[ ] Add getWalletPositions(address).
[ ] Add getResolvedWalletPnL(address).
[ ] Add pagination.
[ ] Add rate limits.
[ ] Add wallet source cursor.
[ ] Add source trust level.
[ ] Add ingestion schedule/job.
[ ] Add wallet backfill job.
```

Acceptance rule:

```txt
Wallet dashboard must populate from real public wallet activity, not manual imports only.
```

---

## P1.2 — Wallet signal is not wired into candidate scoring

Files:

```txt
src/lib/engine/wallet-signal.ts
src/lib/engine/market-loop.ts
src/lib/engine/scanner-upsert.ts
```

`wallet-signal.ts` exists, but scanner/market loop do not call it during ranking.

### TODO

```txt
[ ] Call computeWalletSignalScore() during candidate enrichment.
[ ] Store walletSignalScore on TradeCandidate.
[ ] Store wallet signal explanation.
[ ] Only count trusted eligible wallets.
[ ] Add wallet signal to A+ accepted/rejected criteria.
```

Acceptance rule:

```txt
If top wallets cluster into a market, candidate score and UI must show it.
```

---

## P1.3 — Wallet address uniqueness is too broad

Schema:

```txt
Wallet.address @unique
Wallet.venue
```

If two venues use same address string, they collide.

### TODO

```txt
[ ] Change unique key to @@unique([venue, address]).
[ ] Add migration.
[ ] Update ingestion queries.
[ ] Update wallet ranking queries.
```

Acceptance rule:

```txt
Same address on different venues should not corrupt wallet records.
```

---

## P1.4 — Wallet cluster signals are not persisted as lifecycle objects

File:

```txt
src/lib/engine/wallet-cluster.ts
```

It detects signals, but there is no persistent signal lifecycle table.

Plan requires:

```txt
DETECTED → RESEARCHED → PAPER_TESTED → APPROVED/REJECTED
```

### TODO

```txt
[ ] Add WalletClusterSignal model.
[ ] Store detectedAt.
[ ] Store wallet count.
[ ] Store combined size.
[ ] Store side.
[ ] Store source wallets.
[ ] Store market conditions at detection.
[ ] Track paper result of wallet signals.
[ ] Feed signal performance back into wallet reliability.
```

Acceptance rule:

```txt
Wallet signals must be measurable over time.
```

---

# P1 — related-market gaps

## P1.5 — Related-market scanner uses latestPrice, but latestPrice is not updated

File:

```txt
src/lib/engine/related-market.ts
src/lib/engine/scanner-upsert.ts
```

Related scanner reads:

```txt
market.latestPrice ?? 0.5
```

But `latestPrice` is not updated during scan.

Result:

```txt
related-market violations may be calculated using 0.5 fallback
```

### TODO

```txt
[ ] Fix Market.latestPrice update first.
[ ] Add regression test for related-market violation using real latest prices.
[ ] Do not use 0.5 fallback for A+ signal.
[ ] If latestPrice missing, mark related signal UNKNOWN.
```

Acceptance rule:

```txt
Related-market scanner must never create trade signal from fallback 0.5 prices.
```

---

## P1.6 — Related-market relationship type mismatch

File:

```txt
src/lib/engine/related-market.ts
src/lib/types/index.ts
```

`types/index.ts` defines:

```txt
VENUE_DUPLICATE
```

But related-market code uses:

```txt
DUPLICATE
```

Schema stores string, so it may run, but type vocabulary is inconsistent.

### TODO

```txt
[ ] Standardize relationship type names.
[ ] Use VENUE_DUPLICATE or SAME_OUTCOME consistently.
[ ] Add migration for stored DUPLICATE rows if needed.
[ ] Add tests for every relationship type.
```

Acceptance rule:

```txt
Relationship types must match across type definitions, code, UI, and DB.
```

---

## P1.7 — Related-market pair ordering can invert logic

File:

```txt
src/lib/engine/related-market.ts
```

Code sorts pair ids:

```txt
pair = [market.id, other.id].sort()
```

But relationship logic is calculated before/independent of sorted storage.

For relationships like:

```txt
A_IMPLIES_B
B_IMPLIES_A
NESTED_THRESHOLD
```

pair order matters.

### TODO

```txt
[ ] Preserve directional relationship semantics.
[ ] Store sourceMarketId and targetMarketId.
[ ] Do not sort ids for directional relationships.
[ ] Or normalize relationship direction after sorting.
[ ] Add test:
    BTC > 120K implies BTC > 100K
    not the reverse.
```

Acceptance rule:

```txt
Directional related-market rules must not be inverted by id sorting.
```

---

## P1.8 — Related-market scanner only compares recent 100 markets

File:

```txt
src/lib/engine/related-market.ts
```

Current:

```txt
take: 100
```

### TODO

```txt
[ ] Compare against all active markets in same category/entity cluster.
[ ] Use indexed normalizedTitle/entity extraction.
[ ] Batch relation scan.
[ ] Store relation scan run.
[ ] Add queue job for related scan.
```

Acceptance rule:

```txt
Related scanner should not miss obvious relationship because market was outside last 100.
```

---

# P1 — model / ensemble gaps

## P1.9 — ModelRegistry exists but is not fully used by ensemble

Files:

```txt
src/lib/engine/model-registry.ts
src/lib/engine/ensemble-probability.ts
```

`ModelRegistryRecord` is persisted. Good.

But ensemble weighting still appears to mostly use previous `EnsemblePrediction` rows, not the registry as the central source of truth.

### TODO

```txt
[ ] Use ModelRegistry.getWeights(category) in ensemble.
[ ] Apply category-specific weights.
[ ] Require sample-size gates before active status.
[ ] Update ModelRegistry after outcomes resolve.
[ ] Auto-disable bad models.
[ ] Show model registry in admin UI.
```

Acceptance rule:

```txt
Ensemble weights must come from persisted model registry, not ad-hoc previous rows.
```

---

## P1.10 — Ensemble does not include all intended model sources

Plan says ensemble should include:

```txt
LLM probability
TradingAgents
DeerFlow
MiroFish
wallet signal
orderbook signal
related-market signal
statistical baseline
bias-adjusted market baseline
```

Current ensemble mostly parses agent outputs.

### TODO

```txt
[ ] Add wallet-derived probability source.
[ ] Add orderbook pressure probability source.
[ ] Add related-market probability source.
[ ] Add statistical baseline probability source.
[ ] Add bias-adjusted market probability as baseline.
[ ] Store source category for every prediction.
[ ] Do not delete previous prediction history on re-run.
```

Acceptance rule:

```txt
Every final probability should show all contributing sources and weights.
```

---

## P1.11 — Ensemble disagreement is only partially enforced

Pipeline downgrades BID when disagreement is HIGH. Good.

But A+ config should also enforce numeric max disagreement.

### TODO

```txt
[ ] Store modelDisagreement on TradeCandidate.
[ ] Store disagreement level on Decision.
[ ] Add maxModelDisagreement from active strategy config.
[ ] Block A+ if disagreement exceeds threshold.
[ ] Show which models disagreed.
```

Acceptance rule:

```txt
High model disagreement should always force WATCH or SKIP.
```

---

# P1 — bias and calibration gaps

## P1.12 — Bias correction is still heuristic / not persisted

File:

```txt
src/lib/engine/bias-correction.ts
```

The file defines an interface:

```txt
BiasModelVersion
```

But there is no Prisma `BiasModelVersion` model.

Current category adjustments are hardcoded:

```txt
politics: 0.05
sports: -0.05
crypto: 0.08
...
```

### TODO

```txt
[ ] Add BiasModelVersion model to Prisma.
[ ] Store wangLambda by category.
[ ] Store offset by category.
[ ] Store probability bucket calibration.
[ ] Store sample size.
[ ] Store date range.
[ ] Store active/inactive status.
[ ] Learn from resolved markets.
[ ] Mark uncalibrated outputs as HEURISTIC.
[ ] Do not allow heuristic correction alone to pass A+.
```

Acceptance rule:

```txt
Bias correction must be calibrated from resolved market history before trusted use.
```

---

## P1.13 — Calibration can count unfilled paper bets

Files:

```txt
src/lib/engine/paper-bets.ts
src/lib/engine/brier-calibration.ts
src/lib/engine/live-readiness.ts
src/lib/engine/pipeline.ts
```

Because `PaperBet` is created before fill, A+ stats can count unfilled paper decisions.

### TODO

```txt
[ ] Add executionStatus to PaperBet.
[ ] Link PaperBet to Order.
[ ] Count only FILLED PaperBets in ROI/Brier.
[ ] Exclude FAILED / EXPIRED orders.
[ ] For partial fills, calculate weighted stake and avg entry.
```

Acceptance rule:

```txt
A+ sample count must mean filled A+ paper bets, not submitted intent.
```

---

# P1 — TradingAgents gap

## P1.14 — Native TradingAgents graph is still underused

Files:

```txt
src/lib/engine/research/tradingagents-api.ts
ta-service/server.py
```

The TypeScript integration still calls:

```txt
/analyze/all
```

But full native TradingAgents graph is in the service around:

```txt
TradingAgentsGraph(...)
ta.propagate(...)
```

That means the main app still mostly uses the wrapper/custom all-analysis path rather than the full native TradingAgents graph.

### TODO

```txt
[ ] Add /analyze/native or use existing /analyze for full graph.
[ ] Route only financial/ticker-like markets to native TradingAgents.
[ ] Keep /analyze/all for cheap quick analysis.
[ ] Parse full native TradingAgents reports.
[ ] Store bull/bear debate.
[ ] Store trader decision.
[ ] Store risk manager opinion.
[ ] Store portfolio manager opinion.
[ ] Store checkpoint / memory metadata.
[ ] Feed TradingAgents output into ensemble, not directly into execution.
```

Acceptance rule:

```txt
Financial prediction markets should use native TradingAgents when deep research is requested.
```

---

# P1 — correlation / oracle gaps

## P1.15 — Correlation clusters exist but are underused

Files:

```txt
src/lib/engine/correlation-risk.ts
src/lib/engine/risk-exposure.ts
src/lib/engine/pipeline.ts
```

Scanner-upsert calls clustering, but pipeline risk does not use full cluster risk.

### TODO

```txt
[ ] Ensure every scanned market is linked to clusters.
[ ] Build clusters from:
    - category
    - event
    - underlying asset
    - oracle source
    - resolution date
    - country/team/person
[ ] Use cluster exposure in pipeline risk.
[ ] Show cluster exposure in decision UI.
[ ] Block A+ if cluster exposure too high.
```

Acceptance rule:

```txt
Five BTC-related bets must be treated as correlated exposure, not independent bets.
```

---

## P1.16 — Oracle unknown is treated too safely

File:

```txt
src/lib/engine/pipeline.ts
src/lib/engine/oracle-mismatch.ts
```

If `OracleCheck` does not exist, risk can behave like oracle risk is LOW.

That is unsafe.

### TODO

```txt
[ ] Make oracle check mandatory before A+.
[ ] If OracleCheck missing, set oracleRisk = UNKNOWN.
[ ] UNKNOWN blocks A+ and forces WATCH.
[ ] Run oracle analysis during scan/candidate enrichment.
[ ] Store manualReviewStatus.
[ ] Add manual approval route/UI for high-risk oracle cases.
```

Acceptance rule:

```txt
No A+ bet without an oracle/resolution check.
```

---

# P2 gaps — security, CI, deployment safety

## P2.1 — API auth trusts x-role header

Files:

```txt
src/lib/engine/auth.ts
middleware.ts
```

Current role extraction:

```txt
x-role: Admin
```

This is not real authentication.

Any caller can spoof the header if the app is exposed.

### TODO

```txt
[ ] Replace x-role trust with real auth/session.
[ ] Use NextAuth or another session provider.
[ ] Store user role server-side.
[ ] Accept x-role only in local dev mode.
[ ] Block x-role in production.
[ ] Add admin login.
[ ] Add audit logs with actor userId.
[ ] Protect /api/credentials with real Admin session.
```

Acceptance rule:

```txt
A random HTTP caller must not be able to become Admin by setting a header.
```

---

## P2.2 — Mode route method permission mismatch

File:

```txt
src/app/api/trading/mode/route.ts
```

Observed issue:

```txt
POST route checks permission as PUT in at least one place.
```

This is semantically wrong even if Admin currently passes.

### TODO

```txt
[ ] Ensure every route checks its actual HTTP method.
[ ] Add route permission tests for POST/PUT/PATCH/DELETE.
[ ] Add CI route permission matrix test.
```

Acceptance rule:

```txt
Permission matrix must match actual route methods.
```

---

## P2.3 — Secrets appear in uploaded repo

Top-level files include:

```txt
.env
creds-current.yml
```

I did not reveal values, but their presence is a security concern.

### TODO

```txt
[ ] Remove .env from repo/archive.
[ ] Remove creds-current.yml from repo/archive.
[ ] Rotate any exposed keys.
[ ] Add .env.example only.
[ ] Add secret scanning to CI.
[ ] Add gitignore rules.
[ ] Add deployment secret setup doc.
```

Acceptance rule:

```txt
No real secrets should exist in uploaded/exported repo archives.
```

---

## P2.4 — Build ignores TypeScript errors

File:

```txt
next.config.ts
```

Current:

```txt
typescript.ignoreBuildErrors = true
```

This can hide real issues like extra fields passed to `buildPaperOrderRecord()`.

### TODO

```txt
[ ] Keep CI typecheck required.
[ ] Add npm run prebuild = npm run typecheck.
[ ] Remove ignoreBuildErrors when stabilized.
[ ] Never accept build success unless typecheck passes.
[ ] Add local setup notes for Bun.
```

Acceptance rule:

```txt
Production build must not hide TypeScript contract errors.
```

---

## P2.5 — Hardcoded LAN service URLs remain

Files:

```txt
src/lib/constants/index.ts
src/lib/engine/risk.ts
```

Examples:

```txt
MIROFISH_BASE_URL = http://192.168.88.96:5401
AGENT_REACH_URL fallback = http://192.168.88.96:7234
```

### TODO

```txt
[ ] Move all service URLs to env/settings.
[ ] Remove LAN defaults from source.
[ ] Add service health checks.
[ ] Add missing-provider dashboard warning.
[ ] Add fallback behavior.
```

Acceptance rule:

```txt
The app should not depend on a developer LAN IP by default.
```

---

## P2.6 — CI exists but needs stronger domain regression tests

Current CI is good:

```txt
prisma generate
prisma validate
tsc
lint
db push
bun test
build
```

But it needs more product-specific regressions.

### TODO tests

```txt
[ ] Scanner updates Market.latestPrice/latestSpread/latestLiquidity.
[ ] Polymarket estimated spread cannot pass A+.
[ ] New candidate job uses correct candidateId.
[ ] candidateThreshold blocks jobs below threshold.
[ ] No duplicate active jobs for same market/stage.
[ ] Fill model enum is consistent.
[ ] buildPaperOrderRecord stores fillModel and orderExpiryAt.
[ ] Failed/unfilled order does not create counted PaperBet.
[ ] Partial/filled order creates Fill row.
[ ] Related-market directional rule is not inverted.
[ ] Missing OracleCheck blocks A+.
[ ] Cluster risk is passed into computeRisk.
[ ] x-role cannot grant Admin in production.
[ ] DEMO/MOCK markets excluded from PAPER metrics.
```

---

# File-by-file TODO map

## `src/lib/venues/polymarket.ts`

```txt
[ ] Replace synthetic spread with real CLOB orderbook.
[ ] Fetch best bid/ask per token.
[ ] Fetch depth.
[ ] Fetch price impact.
[ ] Fetch fill probability or compute conservatively.
[ ] Output spreadSource.
[ ] Output rawOrderbookJson.
[ ] Make maxPages configurable.
[ ] Support scanUntilNoCursor.
[ ] Store real cursor.
[ ] Add rate-limit/backoff.
```

---

## `src/lib/venues/kalshi.ts`

```txt
[ ] Make maxPages configurable.
[ ] Persist cursor.
[ ] Add real orderbook/depth endpoint if available.
[ ] Store fillProbability/priceImpact.
[ ] Add rate-limit/backoff.
[ ] Normalize resolutionTime.
```

---

## `src/lib/engine/scanner.ts`

```txt
[ ] Use scan config for maxPages.
[ ] Use scan mode FULL/INCREMENTAL/RESUME.
[ ] Persist cursorStart and cursorEnd.
[ ] Save hasMore.
[ ] Pass resolutionTime into upsert.
[ ] Pass spreadSource into upsert.
[ ] Add scan result anomaly alert.
```

---

## `src/lib/engine/scanner-upsert.ts`

```txt
[ ] Add resolutionTime to ScannerMarketInput.
[ ] Update Market.latestPrice.
[ ] Update Market.latestSpread.
[ ] Update Market.latestLiquidity.
[ ] Update Market.lastSnapshotAt.
[ ] Fix candidateId bug when enqueueing new candidate.
[ ] Do not create duplicate candidate jobs.
[ ] Store duplicateOf / duplicateStatus if title hash repeats.
[ ] Trigger oracle check.
[ ] Trigger wallet signal update.
[ ] Trigger related-market update after latestPrice is updated.
```

---

## `src/lib/engine/market-loop.ts`

```txt
[ ] Use candidateThreshold.
[ ] Remove hardcoded take: 200.
[ ] Score all fresh active markets in batches.
[ ] Use full advanced scoring inputs.
[ ] Stop creating duplicate TRIAGE jobs.
[ ] Route jobs by score/research depth.
[ ] Use JSON criteria consistently.
[ ] Fix redundant stage assignment.
```

---

## `src/lib/engine/candidate-scoring.ts`

```txt
[ ] Make edgeScore positive-side aware; do not use abs(adjustedEdge) blindly.
[ ] Add category-specific scoring profiles.
[ ] Add config-driven score weights.
[ ] Penalize missing orderbook for A+ candidate.
[ ] Add score version.
[ ] Store score component breakdown.
```

Important bug:

```txt
edgeScore = abs(adjustedEdge)
```

This can reward a large negative edge unless side handling is perfect elsewhere.

---

## `src/lib/engine/paper-execution.ts`

```txt
[ ] Standardize FillModel names.
[ ] Add DEMO_INSTANT.
[ ] Add STRICT_LIMIT.
[ ] Add BOOK_DEPTH_AWARE.
[ ] Add CONSERVATIVE_PAPER.
[ ] Add fillModel to order record builder.
[ ] Add orderExpiryAt.
[ ] Add executionNotesJson.
[ ] Fix status/lifecycle mismatch.
[ ] Remove old INSTANT/BOOK_AWARE naming.
```

---

## `src/lib/engine/order-tracker.ts`

```txt
[ ] Create Fill rows for every actual fill.
[ ] Link Fill to Order.
[ ] Link Fill to OrderbookSnapshot if available.
[ ] Avoid immediate FAILED on low fill probability unless model says strict fail.
[ ] Support multiple fill attempts until expiry.
[ ] Add idempotency guard.
[ ] Stop searching/updating WATCH positions unless migration requires it.
```

---

## `src/lib/engine/pipeline.ts`

```txt
[ ] Pass real cluster risk into computeRisk.
[ ] Pass active StrategyConfigVersion.
[ ] Pass real spreadSource, not inferred.
[ ] Require OracleCheck before A+.
[ ] Do not create counted PaperBet before order fill.
[ ] Store orderId on PaperBet or delay PaperBet creation.
[ ] Do not mark candidate EXECUTED until fill or final execution status.
[ ] Store config snapshot on Decision.
[ ] Store aPlusGate result JSON on Decision or PaperBet.
[ ] Use TradingAgents native graph for suitable financial markets.
```

---

## `src/lib/engine/risk.ts`

```txt
[ ] Remove hardcoded thresholds.
[ ] Use strategy config.
[ ] Use category risk profiles.
[ ] Use clusterOpts in pipeline.
[ ] Use tail-risk warnings.
[ ] Use oracle risk.
[ ] Use model disagreement.
[ ] Use real fee/slippage config.
[ ] Fix position size to respect active config max position.
```

---

## `src/lib/engine/a-plus/signal-gate.ts`

```txt
[ ] Load active A+ config from DB.
[ ] Add orderbook source provenance check.
[ ] Treat missing oracle as UNKNOWN and fail.
[ ] Add historical setup performance check.
[ ] Add minimum paper sample check for live readiness.
[ ] Add strategyConfigVersionId.
[ ] Add hard blocker for unfilled/untrusted execution data.
```

---

## `src/lib/engine/wallet-source.ts`

```txt
[ ] Implement real Polymarket wallet source.
[ ] Implement pagination.
[ ] Implement wallet position fetch.
[ ] Implement wallet resolved PnL fetch.
[ ] Persist wallet source cursor.
[ ] Add source trust metadata.
```

---

## `src/lib/engine/wallet-ingestion.ts`

```txt
[ ] Change Wallet unique to venue + address.
[ ] Add source cursor support.
[ ] Backfill activeDays from trades.
[ ] Backfill resolvedTrades from outcomes.
[ ] Separate realized and unrealized PnL.
[ ] Link every WalletTrade to Market.id where possible.
```

---

## `src/lib/engine/wallet-signal.ts`

```txt
[ ] Call this from candidate enrichment.
[ ] Store explanation.
[ ] Store trusted/ineligible wallet list.
[ ] Add copy-late penalty.
[ ] Add wallet signal paper performance.
```

---

## `src/lib/engine/wallet-cluster.ts`

```txt
[ ] Persist detected cluster signals.
[ ] Add signal lifecycle.
[ ] Add copy-late price movement check.
[ ] Use strategy config thresholds.
[ ] Add UI page for wallet cluster signals.
```

---

## `src/lib/engine/related-market.ts`

```txt
[ ] Fix relationship type naming.
[ ] Fix directional relationship storage.
[ ] Avoid 0.5 fallback for signal generation.
[ ] Scan more than latest 100.
[ ] Use entity/indexed search.
[ ] Add oracle mismatch for cross-venue pairs.
[ ] Feed signal into candidate scoring.
```

---

## `src/lib/engine/oracle-mismatch.ts`

```txt
[ ] Run automatically for candidate markets.
[ ] Store UNKNOWN risk when not checked.
[ ] Require check before A+.
[ ] Add source URL validation.
[ ] Add cross-venue mismatch comparison.
[ ] Add manual review workflow.
```

---

## `src/lib/engine/correlation-risk.ts`

```txt
[ ] Ensure clusters are built after every scan.
[ ] Use resolutionTime clusters.
[ ] Improve entity extraction.
[ ] Add same-underlying exposure.
[ ] Add same-oracle exposure.
[ ] Feed cluster exposure into pipeline risk.
```

---

## `src/lib/engine/model-registry.ts`

```txt
[ ] Seed registry with known models.
[ ] Use registry weights in ensemble.
[ ] Update registry after outcomes.
[ ] Add category-specific activation.
[ ] Add admin UI.
```

---

## `src/lib/engine/ensemble-probability.ts`

```txt
[ ] Use ModelRegistry weights.
[ ] Include wallet probability.
[ ] Include orderbook probability.
[ ] Include related-market probability.
[ ] Include statistical baseline.
[ ] Include bias-adjusted baseline.
[ ] Preserve prediction history instead of delete/recreate.
[ ] Store category on predictions.
```

---

## `src/lib/engine/bias-correction.ts`

```txt
[ ] Add Prisma BiasModelVersion.
[ ] Train from resolved markets.
[ ] Persist Wang parameters.
[ ] Persist bucket calibration.
[ ] Mark heuristic mode.
[ ] Block trusted A+ reliance on heuristic-only correction.
```

---

## `src/lib/engine/backtest-engine.ts`

```txt
[ ] Add historical backfill source.
[ ] Add BacktestTrade or per-trade detail table.
[ ] Replay orderbook depth where available.
[ ] Replay realistic paper fill models.
[ ] Store config version used.
[ ] Compare strategy versions.
```

---

## `src/lib/engine/live-readiness.ts`

```txt
[ ] Count only filled A+ paper bets.
[ ] Require real orderbook source.
[ ] Require real auth enabled.
[ ] Require kill switch test.
[ ] Require manual approval mode first.
[ ] Require max stake and daily loss settings.
[ ] Require no secrets in repo.
```

---

## `middleware.ts` / `auth.ts`

```txt
[ ] Replace x-role trust with real session auth.
[ ] Allow x-role only in LOCAL_DEV_AUTH_BYPASS.
[ ] Add production guard.
[ ] Add route permission tests.
[ ] Add denied-access audit logs.
```

---

## `next.config.ts`

```txt
[ ] Remove ignoreBuildErrors eventually.
[ ] Add prebuild typecheck.
[ ] Keep CI typecheck required.
```

---

# Missing / weak tests to add

```txt
[ ] scanner-upsert updates Market.latestPrice.
[ ] scanner-upsert stores resolutionTime.
[ ] scanner-upsert new candidate job uses TradeCandidate.id.
[ ] candidateThreshold prevents job enqueue.
[ ] no duplicate active jobs per market/stage.
[ ] Polymarket estimated spread cannot pass A+.
[ ] missing OracleCheck fails A+.
[ ] fill model enum compatibility.
[ ] buildPaperOrderRecord stores fillModel/orderExpiryAt.
[ ] failed/expired order does not count as PaperBet result.
[ ] fill creates Fill row.
[ ] partial fill updates PaperBet stake correctly.
[ ] related-market directional rule not inverted.
[ ] related scanner does not use 0.5 fallback for trade signal.
[ ] correlation cluster exposure blocks risk.
[ ] x-role cannot grant Admin in production.
[ ] .env/secret files are not present in release archive.
[ ] Native TradingAgents route is used for financial deep research.
```

---

# Updated implementation order

## Milestone 1 — Trusted real scanner

```txt
[ ] Real Polymarket orderbook.
[ ] Configurable full pagination.
[ ] Market.latest* updates.
[ ] resolutionTime updates.
[ ] Candidate threshold enforced.
[ ] No duplicate job creation.
```

## Milestone 2 — Trusted paper execution

```txt
[ ] Unified FillModel enum.
[ ] Store fillModel/orderExpiryAt.
[ ] Implement conservative fill models.
[ ] Create Fill rows.
[ ] PaperBet only after fill or linked to order execution status.
[ ] Exclude unfilled bets from ROI/Brier.
```

## Milestone 3 — Real A+ gate

```txt
[ ] Fail closed on missing oracle/orderbook.
[ ] Use real cluster exposure.
[ ] Use real orderbook provenance.
[ ] Load A+ config from StrategyConfigVersion.
[ ] Store config version on decisions.
```

## Milestone 4 — Intelligence wiring

```txt
[ ] Wallet source connector.
[ ] Wallet signal into scoring.
[ ] Related-market signal into scoring.
[ ] ModelRegistry into ensemble.
[ ] Bias model persistence/calibration.
[ ] Native TradingAgents for suitable markets.
```

## Milestone 5 — Safety and production readiness

```txt
[ ] Real auth/session.
[ ] Secret cleanup.
[ ] CI domain regression tests.
[ ] Backup/export.
[ ] Live readiness based only on filled A+ paper results.
```

---

# Final priority table

| Priority | Gap                                       | Why it matters                         |
| -------- | ----------------------------------------- | -------------------------------------- |
| P0       | Synthetic Polymarket spread               | Can fake edge and fake fills           |
| P0       | Scanner pagination limited                | Misses opportunities                   |
| P0       | latestPrice not updated                   | Breaks related-market logic            |
| P0       | resolutionTime missing                    | Breaks date/correlation/risk logic     |
| P0       | candidateThreshold unused                 | Config does not control behavior       |
| P0       | Wrong candidateId on new job              | Job references wrong object            |
| P0       | Duplicate job creation paths              | Wasted/repeated research               |
| P0       | Stage jobs run full pipeline              | No real resumability                   |
| P0       | Fill model enum mismatch                  | Paper execution correctness risk       |
| P0       | buildPaperOrderRecord ignores fill config | Orders lack fill/expiry rules          |
| P0       | PaperBet before fill                      | Metrics can count unfilled bets        |
| P0       | Cluster risk not passed to risk engine    | Correlated exposure can slip through   |
| P1       | Wallet source missing                     | Wallet alpha cannot run end-to-end     |
| P1       | Related-market directional bug            | Implication relationships can invert   |
| P1       | ModelRegistry not driving ensemble        | Model weights not governed properly    |
| P1       | Bias correction not persisted/calibrated  | Wang correction is still heuristic     |
| P1       | TradingAgents native graph underused      | Missing full analyst/debate/risk power |
| P2       | x-role auth is spoofable                  | Unsafe if hosted                       |
| P2       | secrets included in archive               | Security risk                          |
| P2       | build ignores TS errors                   | Real bugs can be hidden                |

---

# Final conclusion

The codebase is no longer a simple prototype. It now has most of the planned architecture. But the most important remaining gap is:

```txt
The advanced modules exist, but the active execution loop is not yet fully truthful, strict, and measurable.
```

Your next target should be:

```txt
Trusted PAPER Mode v1
```

Not more AI, not live trading, not more dashboards.

Trusted PAPER Mode v1 means:

```txt
real data
real orderbook
real spread
real candidate threshold
real A+ gate
real conservative fills
filled-only paper metrics
real wallet/source wiring
real cluster risk
real auth
real tests
```

Once that works, then the app can start proving whether the A+ strategy has genuine edge.
