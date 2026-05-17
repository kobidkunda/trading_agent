I deep-studied the latest uploaded codebase `trading_agent-main (4).zip` against our full plan. Important update: **many earlier gaps are now partially implemented**. The repo already has modules for market loop, candidate scoring, wallet intelligence, ensemble probability, bias correction, Brier calibration, backtesting, walk-forward, oracle checks, orderbook microstructure, and CI.

The remaining gaps are now mostly **integration, correctness, runtime safety, and “real edge validation” gaps** — not just missing files.

# Already implemented / no longer a gap

These are present in the latest repo:

```txt
✅ DEMO / PAPER / LIVE enums exist
✅ DataSource MOCK / REAL exists
✅ ExecutionMode SIMULATED / REAL exists
✅ Order lifecycle enum exists
✅ Market has @@unique([venue, externalId])
✅ ScanRun, VenueCursor, MarketSnapshot exist
✅ TradeCandidate scoring fields exist
✅ Watchlist model exists
✅ PaperBet, Outcome, Postmortem exist
✅ Wallet, WalletTrade exist
✅ EnsemblePrediction exists
✅ CorrelationCluster exists
✅ OracleCheck exists
✅ RelatedMarket exists
✅ CausalTreeNode exists
✅ BacktestRun exists
✅ StrategyConfigVersion exists
✅ Test scripts exist in package.json
✅ GitHub CI exists
✅ AGENTS.md has been updated to current stack
```

So the plan has moved forward. Now the issue is: **the modules exist, but many are not fully wired into one reliable PAPER-mode alpha engine.**

---

# P0 gaps — must fix first

## 1. Market loop does not use the full A+ intelligence stack

File:

```txt
src/lib/engine/market-loop.ts
```

Current behavior:

```txt
scan venues
take latest 200 active markets
score with basic liquidity/spread/volume/freshness
create TRIAGE_MARKET jobs
```

Gap:

```txt
candidateThreshold is read but not actually used.
Only latest 200 markets are scored.
Advanced signals are not used in first scoring:
- walletSignalScore
- relatedMarketSignal
- bias-adjusted edge
- oracle risk
- model disagreement
- orderbook quality
- correlation risk
- causal research output
```

So the app has advanced modules, but the **market loop still behaves like a basic scanner**.

### TODO

```txt
[ ] Use candidateThreshold from config.
[ ] Remove hardcoded take: 200 or make it configurable.
[ ] Score all fresh active markets in batches.
[ ] Add category-specific scoring profiles.
[ ] Feed walletSignalScore into candidate scoring.
[ ] Feed relatedMarketSignalScore into candidate scoring.
[ ] Feed orderbookQuality into candidate scoring.
[ ] Feed oracleRiskPenalty into candidate scoring.
[ ] Feed modelDisagreementPenalty into candidate scoring.
[ ] Feed correlationRiskPenalty into candidate scoring.
[ ] Store accepted criteria as structured JSON, not comma text.
[ ] Store rejected criteria as structured JSON.
[ ] Create job type based on score:
    - TRIAGE_MARKET
    - QUICK_RESEARCH
    - STANDARD_RESEARCH
    - DEEP_RESEARCH
[ ] Do not send every eligible market only to TRIAGE_MARKET.
```

---

## 2. Polymarket spread is still mostly synthetic

File:

```txt
src/lib/venues/polymarket.ts
```

Current behavior:

```txt
If no real bestBid/bestAsk:
bestBid = price * 0.99
bestAsk = price * 1.01
spread = abs(price - (1 - price)) * 0.02
```

This is not real orderbook spread.

Gap:

```txt
A+ score, risk, paper execution, and adjusted edge can be wrong because spread is estimated.
```

For Polymarket, this is a serious issue. A market can look attractive because synthetic spread is low, but the actual book may be thin or wide.

### TODO

```txt
[ ] Add real Polymarket CLOB orderbook fetch per market.
[ ] Store bestBid and bestAsk from orderbook.
[ ] Store real spread = bestAsk - bestBid.
[ ] Store bid depth and ask depth.
[ ] Store price impact for planned order size.
[ ] Mark spreadSource = REAL_ORDERBOOK or ESTIMATED.
[ ] Block A+ execution when spreadSource = ESTIMATED.
[ ] Use estimated spread only for rough watchlist, never for A+ execution.
```

---

## 3. Venue pagination / full active market scan is incomplete

Files:

```txt
src/lib/venues/polymarket.ts
src/lib/venues/kalshi.ts
src/lib/engine/scanner.ts
```

Current behavior:

```txt
Polymarket maxPages = 5
Kalshi maxPages = limited
VenueCursor exists but is not truly used
scanner passes null cursor after full scan
```

Gap:

```txt
The plan says “scan all active markets,” but current scanner may only fetch a partial universe.
```

### TODO

```txt
[ ] Make maxPagesPerVenue configurable.
[ ] Add scanUntilNoCursor option.
[ ] Persist cursorStart and cursorEnd in ScanRun.
[ ] Persist VenueCursor after each venue scan.
[ ] Add FULL_SCAN mode.
[ ] Add INCREMENTAL_SCAN mode.
[ ] Add RESUME_FROM_CURSOR mode.
[ ] Add scan timeout and rate-limit delay.
[ ] Show scanned pages and cursor state in dashboard.
[ ] Add alert if scan result count suddenly drops.
```

---

## 4. Paper order tracking does not actually fill orders correctly

Files:

```txt
src/lib/engine/order-tracker.ts
src/lib/engine/paper-execution.ts
src/lib/engine/worker.ts
```

Critical bug:

```txt
resolvePaperFill() can return lifecycleStatus = FAILED
but processPaperOrderFill() ignores that and sets:
isFullyFilled ? FILLED : PARTIALLY_FILLED
```

So a failed/no-fill paper order can become:

```txt
PARTIALLY_FILLED
```

Also, `ORDER_TRACK` in worker currently mostly classifies terminal states; it does **not** call the realistic fill engine with orderbook data.

### TODO

```txt
[ ] In processPaperOrderFill(), use fillResult.lifecycleStatus directly.
[ ] If fillResult.lifecycleStatus = FAILED, mark order FAILED.
[ ] If fillResult.filledSize = 0, do not mark PARTIALLY_FILLED.
[ ] ORDER_TRACK job must call processPaperOrderFill().
[ ] ORDER_TRACK must pass orderbook-derived fillProbability.
[ ] ORDER_TRACK must pass bidDepth, askDepth, spread, priceImpact.
[ ] Make order tracking idempotent.
[ ] Prevent same order fill from being applied twice.
[ ] Add fillAttemptCount.
[ ] Add lastFillAttemptAt.
[ ] Add order expiry timeout per strategy.
[ ] Add cancel stale order rule.
```

---

## 5. Paper fill model is still too heuristic

File:

```txt
src/lib/engine/paper-execution.ts
```

Current fallback:

```txt
fillRatio = liquidity / (size * price * 100)
```

Gap:

```txt
This can create unrealistic fills without real orderbook depth.
```

The plan requires realistic PAPER mode. Right now it is improved, but not strong enough for trusting win rate.

### TODO

Create clear fill models:

```txt
[ ] DEMO_INSTANT
    - only for DEMO
    - never included in real performance metrics

[ ] STRICT_LIMIT
    - fill only if order crosses the book
    - or market trades through limit price

[ ] BOOK_DEPTH_AWARE
    - fill based on actual depth at price levels

[ ] CONSERVATIVE_PAPER
    - assume worse price
    - assume partial fill
    - apply slippage
    - use for A+ performance metrics
```

Acceptance rule:

```txt
[ ] A+ PAPER performance must use only CONSERVATIVE_PAPER or STRICT_LIMIT.
[ ] No A+ score should rely on DEMO_INSTANT results.
```

---

## 6. A+ Signal Gate exists as a type, but not as a hard execution gate

File:

```txt
src/lib/types/index.ts
```

There is:

```txt
APlusSignalConfig
```

But the actual execution path still depends mostly on:

```txt
computeRisk()
```

Gap:

```txt
The app can still reach BID based on risk result even if full A+ criteria were not proven.
```

Candidate scoring currently routes research depth. It does not fully act as:

```txt
final A+ execution gate
```

### TODO

Add a real module:

```txt
src/lib/engine/a-plus/signal-gate.ts
```

It should check:

```txt
[ ] candidateScore >= configured threshold
[ ] adjustedEdge >= configured threshold
[ ] confidence >= configured threshold
[ ] resolutionClarity >= configured threshold
[ ] spread <= configured threshold
[ ] liquidity >= category threshold
[ ] modelDisagreement <= threshold
[ ] oracleRisk <= threshold
[ ] tailRisk <= threshold
[ ] correlationExposure <= threshold
[ ] orderbookQuality >= threshold
[ ] dataSource = REAL
[ ] spreadSource = REAL_ORDERBOOK
[ ] paper setup has sufficient sample size before live
```

Execution rule:

```txt
[ ] Risk BID alone should not create order.
[ ] Risk BID + APlusSignalGate PASS creates PAPER order.
[ ] Risk BID + APlusSignalGate FAIL creates WATCH or SKIP.
```

---

## 7. Risk engine still uses hardcoded thresholds

File:

```txt
src/lib/engine/risk.ts
```

Current hardcoded constants include:

```txt
MAX_POSITION_SIZE
BID_EDGE_THRESHOLD
WATCH_EDGE_THRESHOLD
MAX_DAILY_EXPOSURE
MAX_CATEGORY_EXPOSURE
MIN_LIQUIDITY
MAX_SPREAD
```

Gap:

```txt
Plan says thresholds should come from strategy config / A+ config.
Code still has too much hardcoded policy.
```

### TODO

```txt
[ ] Move all risk constants into StrategyConfigVersion or APlusSignalConfig.
[ ] Add category-specific risk profiles.
[ ] Use config for max spread.
[ ] Use config for min liquidity.
[ ] Use config for edge threshold.
[ ] Use config for max position size.
[ ] Use config for max category exposure.
[ ] Use config for max correlated exposure.
[ ] Use config for uncertainty threshold.
[ ] Store the exact config version used for every Decision.
```

---

## 8. Bias correction / Wang transform is still heuristic

File:

```txt
src/lib/engine/bias-correction.ts
```

Current behavior:

```txt
category adjustments are hardcoded
global resolvedMarketCount controls activation
```

Gap:

```txt
The plan requires bias correction calibrated from resolved markets.
Current correction can create false confidence.
```

### TODO

```txt
[ ] Add BiasModelVersion table or equivalent persisted model registry.
[ ] Store calibration sample count.
[ ] Store calibration by probability bucket.
[ ] Store calibration by category.
[ ] Store calibration date range.
[ ] Store Wang lambda / transform parameters.
[ ] Do not apply category correction until category sample size is sufficient.
[ ] Show bias model status:
    - UNCALIBRATED
    - GLOBAL_ONLY
    - CATEGORY_CALIBRATED
[ ] If uncalibrated, mark output as heuristic.
[ ] Do not allow heuristic bias correction to pass A+ gate alone.
```

---

## 9. Brier/calibration logic exists but is not fully connected to live go/no-go

File:

```txt
src/lib/engine/brier-calibration.ts
src/lib/engine/live-readiness.ts
```

Good:

```txt
Brier functions exist.
Sample sufficiency constants exist.
Live readiness requires 500 paper samples.
```

Gaps:

```txt
Category ROI appears not fully computed.
A+ bucket filtering is not strict enough.
Paper sample count counts all resolved paper bets, not necessarily only true A+ bets.
Live readiness has placeholders:
killSwitchTested = false
manualApprovalEnabled = false
maxStakeConfigured = false
dailyLossConfigured = false
```

### TODO

```txt
[ ] Tag every paper bet with setupType and aPlusStatus.
[ ] Count only A_PLUS_BET resolved paper bets for A+ sample requirement.
[ ] Calculate A+ bucket ROI directly from PaperBet outcomes.
[ ] Calculate A+ bucket Brier directly from PaperBet predictions.
[ ] Calculate category ROI.
[ ] Calculate setup-type ROI.
[ ] Calculate model-wise Brier.
[ ] Add calibration dashboard with sample sufficiency warnings.
[ ] Replace live-readiness placeholders with real config checks.
[ ] Add kill-switch test record.
[ ] Add manual approval setting.
[ ] Add max stake setting.
[ ] Add daily loss setting.
```

---

# P1 gaps — high priority after trusted paper mode

## 10. Wallet tracker is not end-to-end

Files:

```txt
src/lib/engine/wallet-ingestion.ts
src/lib/engine/wallet-ranker.ts
src/lib/engine/wallet-cluster.ts
```

Current state:

```txt
wallet-ingestion accepts already-fetched wallet stats/trades
no actual Polymarket wallet connector
wallet trades may have marketId = null
wallet cluster detector requires marketId not null
```

So wallet cluster signals may never fire unless another process links trades to markets.

### Critical dedupe bug

In `wallet-ingestion.ts`, keys are inconsistent:

```txt
existingKeys = externalMarketId:timestamp
new key = walletId:externalMarketId:timestamp
```

So duplicate wallet trades may not be detected correctly.

### TODO

```txt
[ ] Build real wallet data source connector.
[ ] Define wallet source:
    - Polymarket profile API
    - CLOB fills
    - subgraph/indexer
[ ] Add getWalletTrades(address).
[ ] Add getWalletPositions(address).
[ ] Add getResolvedWalletPnL(address).
[ ] Link WalletTrade.externalMarketId to Market.id.
[ ] Fix wallet trade dedupe key.
[ ] Store venue + externalMarketId + walletId + timestamp + side as unique key.
[ ] Backfill resolved wallet trades.
[ ] Separate realized PnL from open PnL.
[ ] Do not rank wallets on open PnL only.
```

---

## 11. Wallet ranker anti-survivorship rules are weak

File:

```txt
src/lib/engine/wallet-ranker.ts
```

Current issue:

```txt
MIN_RESOLVED_TRADES = 5
```

But the plan requires stricter rules like:

```txt
minimum 50 resolved trades
minimum 30 active days
profit factor > 1.2
not dependent on one jackpot
```

### TODO

```txt
[ ] Raise minimum resolved trades to 50 for production signals.
[ ] Add minimum active days.
[ ] Add jackpot dependency check.
[ ] Add max drawdown.
[ ] Add recent performance decay.
[ ] Add category-specific wallet skill.
[ ] Add copy-late penalty.
[ ] Add wallet reliability score.
[ ] Only eligible wallets can contribute to walletSignalScore.
```

---

## 12. Wallet cluster signal does not check market conditions

File:

```txt
src/lib/engine/wallet-cluster.ts
```

Current cluster logic:

```txt
3+ top wallets enter same market within 10 minutes
```

Gap:

```txt
No check for spread, liquidity, price already moved, copy-late risk, or orderbook conditions.
```

### TODO

```txt
[ ] Require market liquidity above threshold.
[ ] Require spread below threshold.
[ ] Require orderbook depth enough for our stake.
[ ] Reject signal if price moved too far after wallet entry.
[ ] Reject if wallet entries conflict by side.
[ ] Reject if market has high oracle risk.
[ ] Reject if cluster exposure already high.
[ ] Store walletClusterSignal lifecycle:
    DETECTED → RESEARCHED → PAPER_TESTED → APPROVED/REJECTED
```

---

## 13. Ensemble model registry is in-memory

File:

```txt
src/lib/engine/model-registry.ts
```

Current issue:

```txt
model registry resets on server restart
weights/status are not persisted
```

Gap:

```txt
The plan requires models to be promoted/demoted by historical Brier score.
Current registry is not durable enough.
```

### TODO

```txt
[ ] Add persisted ModelRegistry table.
[ ] Store modelName.
[ ] Store modelVersion.
[ ] Store provider.
[ ] Store supported categories.
[ ] Store rollingBrier.
[ ] Store sampleSize.
[ ] Store weight.
[ ] Store status: TESTING / ACTIVE / DISABLED.
[ ] Store lastEvaluatedAt.
[ ] Auto-disable model when Brier is bad with sufficient samples.
[ ] Use category-specific model weights.
```

---

## 14. Ensemble disagreement is not a hard A+ blocker

File:

```txt
src/lib/engine/ensemble-probability.ts
src/lib/engine/pipeline.ts
```

Gap:

```txt
The pipeline logs model disagreement, but A+ execution is not strictly blocked by disagreement threshold.
```

### TODO

```txt
[ ] Add maxModelDisagreement to A+ gate.
[ ] If disagreement is HIGH, force WATCH.
[ ] Store disagreement reason in Decision.
[ ] Store per-model prediction in the candidate detail view.
[ ] Show model weights in UI.
```

---

## 15. Causal tree exists but final probability math needs hard rules

File:

```txt
src/lib/engine/causal-tree.ts
```

Gap:

```txt
Causal tree can become explanation-only unless probability aggregation is formalized.
```

### TODO

```txt
[ ] Define node probability.
[ ] Define node weight.
[ ] Define dependency type:
    - independent
    - conditional
    - blocking
    - supporting
[ ] Define contradiction penalty.
[ ] Define source quality penalty.
[ ] Aggregate final probability from weighted nodes.
[ ] Store causal tree version with every deep research run.
[ ] Measure which causal nodes later predicted outcomes correctly.
```

---

## 16. Related-market scanner needs stricter relationship DSL

File:

```txt
src/lib/engine/related-market.ts
```

Good:

```txt
Relationship types exist in types.
```

Gap:

```txt
The plan requires formal violation math for each relationship type.
```

### TODO

```txt
[ ] Implement SAME_OUTCOME violation formula.
[ ] Implement OPPOSITE_OUTCOME violation formula.
[ ] Implement A_IMPLIES_B formula.
[ ] Implement B_IMPLIES_A formula.
[ ] Implement MUTUALLY_EXCLUSIVE sum rule.
[ ] Implement COLLECTIVELY_EXHAUSTIVE sum rule.
[ ] Implement NESTED_THRESHOLD formula.
[ ] Implement RANGE_BUCKET sum rule.
[ ] Add confidence score for relationship extraction.
[ ] Add oracle mismatch warning for cross-venue related markets.
[ ] Do not trade relationship signal if relationship confidence is low.
```

---

## 17. Oracle mismatch guard is too shallow for real money

File:

```txt
src/lib/engine/oracle-mismatch.ts
```

Gap:

```txt
Resolution ambiguity is one of the biggest prediction-market risks.
Current guard needs deeper parsing and stronger blocking.
```

### TODO

```txt
[ ] Parse resolution source.
[ ] Parse official oracle.
[ ] Parse cutoff date/time.
[ ] Parse timezone.
[ ] Parse appeal/challenge process.
[ ] Parse human discretion wording.
[ ] Parse ambiguous terms.
[ ] Compare similar markets across venues.
[ ] Assign oracleRiskScore.
[ ] Force WATCH/manual review if oracleRiskScore is high.
[ ] Block A+ if oracle risk exceeds config.
```

---

## 18. Correlation clusters exist but automatic cluster building is incomplete

Files:

```txt
src/lib/engine/correlation-risk.ts
src/lib/engine/risk-exposure.ts
```

Good:

```txt
CorrelationCluster and ClusterMarketLink exist.
Risk exposure can read cluster links.
```

Gap:

```txt
If markets are not automatically assigned to clusters, cluster risk cannot protect you.
```

### TODO

```txt
[ ] Auto-generate eventCluster for each market.
[ ] Auto-generate categoryCluster.
[ ] Auto-generate underlyingAssetCluster.
[ ] Auto-generate oracleCluster.
[ ] Auto-generate resolutionDateCluster.
[ ] Link markets to clusters during scan/candidate phase.
[ ] Calculate worst-case cluster loss.
[ ] Calculate same-underlying exposure.
[ ] Calculate same-oracle exposure.
[ ] Calculate same-resolution-date exposure.
[ ] Block A+ if cluster utilization exceeds threshold.
```

---

# P2 gaps — operational and production safety

## 19. API permission matrix exists but is not enforced

File:

```txt
src/lib/types/index.ts
```

Good:

```txt
UserRole and API_PERMISSION_MATRIX exist.
```

Gap:

```txt
API routes do not appear to call canAccessRoute().
No middleware is enforcing roles.
Credentials route is open at route level.
```

This is serious for any hosted app.

### TODO

```txt
[ ] Add authentication middleware.
[ ] Add role extraction.
[ ] Enforce API_PERMISSION_MATRIX on every API route.
[ ] Protect /api/credentials with Admin only.
[ ] Protect /api/trading/mode POST with Admin only.
[ ] Protect live execution routes with live-execution permission.
[ ] Add audit log for denied access.
[ ] Add local-only mode for development.
```

---

## 20. Credential encryption exists, but security workflow is incomplete

File:

```txt
src/app/api/credentials/route.ts
src/lib/engine/crypto.ts
```

Good:

```txt
credentials are encrypted before storing
masked preview returned
audit log created
```

Gaps:

```txt
No route auth enforcement.
No encryption key rotation plan.
No secret backup/restore plan.
No admin approval flow for credential changes.
```

### TODO

```txt
[ ] Require Admin auth for all credential routes.
[ ] Add credential rotation metadata.
[ ] Add lastUsedAt.
[ ] Add createdBy / updatedBy.
[ ] Add secret export disabled by default.
[ ] Add encrypted DB backup compatibility.
[ ] Add credential test isolation.
```

---

## 21. Next.js build ignores TypeScript errors

File:

```txt
next.config.ts
```

Current:

```txt
typescript.ignoreBuildErrors = true
```

CI runs typecheck, which is good. But production build can still pass even with TS errors if CI is bypassed.

Also, local typecheck in this sandbox failed because `bun-types` was not installed in the environment, meaning setup needs to be very explicit.

### TODO

```txt
[ ] Keep CI typecheck required.
[ ] Add prebuild script that runs typecheck.
[ ] Document that bun install is required before typecheck.
[ ] Add local setup checklist.
[ ] Consider removing ignoreBuildErrors once app stabilizes.
[ ] Do not accept “build passed” unless typecheck also passed.
```

---

## 22. CI exists but should be stricter

File:

```txt
.github/workflows/ci.yml
```

Good:

```txt
Prisma generate
Prisma validate
tsc
lint
db push
bun test
build
```

Gaps:

```txt
No separate test groups.
No explicit DEMO pollution test gate.
No route authorization test.
No seeded fixture tests.
No smoke test for PAPER mode.
```

### TODO

```txt
[ ] Add unit test job.
[ ] Add integration test job.
[ ] Add API route test job.
[ ] Add scanner fixture test.
[ ] Add paper execution lifecycle test.
[ ] Add wallet dedupe test.
[ ] Add order-tracker failed-fill test.
[ ] Add no-DEMO-in-PAPER regression test.
[ ] Add auth/permission matrix tests.
```

---

## 23. Worker reliability improved, but job pipeline is still too coarse

File:

```txt
src/lib/engine/worker.ts
```

Good:

```txt
Processes PENDING and RETRYING.
Has stale lock cleanup.
Has heartbeat fields.
Runs market loop when no jobs.
```

Gap:

```txt
TRIAGE_MARKET, RESEARCH_MARKET, JUDGE_MARKET, RISK_CHECK all call the full runPipelineForMarket().
Stages are not truly independently resumable.
ORDER_TRACK does not actually fill paper orders.
```

### TODO

```txt
[ ] Split runPipelineForMarket into true stage functions:
    - runTriageStage
    - runQuickResearchStage
    - runDeepResearchStage
    - runJudgeStage
    - runRiskStage
    - runAPlusGateStage
    - runPaperExecuteStage
[ ] Worker should run only the requested stage.
[ ] Save stage output after every stage.
[ ] Retry only failed stage.
[ ] ORDER_TRACK must process fills, not only terminal states.
[ ] Add stuck stage dashboard.
```

---

## 24. Live readiness checklist is mostly placeholders

File:

```txt
src/lib/engine/live-readiness.ts
```

Good:

```txt
Requires 500 paper samples.
Requires positive ROI.
Requires Brier <= 0.25.
Checks credential failures.
Checks audit logs.
```

Gaps:

```txt
killSwitchTested is hardcoded false
manualApprovalEnabled is hardcoded false
maxStakeConfigured is hardcoded false
dailyLossConfigured is hardcoded false
```

This means live will always be blocked, which is safe, but not operationally complete.

### TODO

```txt
[ ] Add kill switch test record.
[ ] Add manual approval setting.
[ ] Add max stake setting.
[ ] Add daily loss setting.
[ ] Add unresolved exposure limit.
[ ] Add live credential safety test.
[ ] Add “manual approval only” first live stage.
[ ] Add live audit checklist page.
```

---

## 25. Hardcoded internal service URL remains

File:

```txt
src/lib/engine/risk.ts
```

Earlier inspected config included a default service URL like:

```txt
http://192.168.88.96:7234
```

Gap:

```txt
Deployment-specific IP should not be a hardcoded default.
```

### TODO

```txt
[ ] Move all service URLs to Settings/.env.
[ ] Remove LAN IP defaults from code.
[ ] Add service health check before using provider.
[ ] Add fallback if provider unavailable.
[ ] Show missing provider in dashboard.
```

---

## 26. Demo data migration / cleanup is still a required task

The schema has `dataSource`, but old generated demo rows may still exist in bundled DB.

### TODO

```txt
[ ] Detect old external IDs starting with live_, sim_, demo_.
[ ] Mark them DataSource.MOCK.
[ ] Hide MOCK rows from PAPER dashboards.
[ ] Exclude MOCK from Brier/ROI.
[ ] Exclude MOCK from backtests.
[ ] Exclude MOCK from resolution poller.
[ ] Add “Demo Data Cleanup” script.
```

---

## 27. Historical backfill is not fully defined

Backtesting, Wang calibration, wallet ranking, and Brier analysis need historical data.

### TODO

```txt
[ ] Build resolved market importer.
[ ] Build historical market snapshot importer.
[ ] Build historical orderbook importer where possible.
[ ] Build historical wallet trade importer.
[ ] Build historical outcome importer.
[ ] Add source provenance to historical data.
[ ] Add backfill status dashboard.
```

---

# Detailed TODO map by module

## `market-loop.ts`

```txt
[ ] Use candidateThreshold.
[ ] Remove hardcoded 200 market cap.
[ ] Batch all fresh markets.
[ ] Wire wallet signals.
[ ] Wire related-market signals.
[ ] Wire oracle risk.
[ ] Wire orderbook quality.
[ ] Wire model disagreement.
[ ] Wire correlation risk.
[ ] Route jobs by research depth.
[ ] Create DEEP_RESEARCH directly for score >= 90.
```

## `polymarket.ts`

```txt
[ ] Fetch real CLOB orderbook.
[ ] Replace synthetic spread.
[ ] Add configurable maxPages.
[ ] Persist cursors.
[ ] Add resolved market ingestion.
[ ] Add rate limit handling.
[ ] Add orderbook source metadata.
```

## `scanner.ts`

```txt
[ ] Add FULL_SCAN / INCREMENTAL_SCAN / RESUME modes.
[ ] Store cursorStart.
[ ] Store cursorEnd.
[ ] Store hasMore.
[ ] Add scan failure alerts.
[ ] Add scan freshness dashboard.
```

## `paper-execution.ts`

```txt
[ ] Add strict fill model names.
[ ] Add conservative paper model.
[ ] Require orderbook for A+ fills.
[ ] Add venue fee model.
[ ] Add stale order expiry.
[ ] Add fill confidence.
```

## `order-tracker.ts`

```txt
[ ] Use fillResult.lifecycleStatus.
[ ] Do not turn failed fills into partial fills.
[ ] Pass orderbook-derived fillProbability.
[ ] Prevent duplicate fill application.
[ ] Add fill attempt history.
[ ] Add expiration/cancel logic.
```

## `risk.ts`

```txt
[ ] Remove hardcoded thresholds.
[ ] Use StrategyConfigVersion.
[ ] Use APlusSignalConfig.
[ ] Use bias-adjusted probability consistently.
[ ] Use model disagreement.
[ ] Use oracle risk.
[ ] Use correlation risk.
[ ] Use tail-risk score.
```

## `bias-correction.ts`

```txt
[ ] Add persisted bias model versions.
[ ] Calibrate from resolved markets.
[ ] Add probability bucket calibration.
[ ] Add category calibration.
[ ] Mark heuristic outputs as uncalibrated.
```

## `brier-calibration.ts`

```txt
[ ] Compute category ROI.
[ ] Enforce A+ bucket sample sufficiency.
[ ] Use only true A+ paper bets for A+ readiness.
[ ] Add setup-wise Brier.
[ ] Add model-wise Brier.
```

## `wallet-ingestion.ts`

```txt
[ ] Build real source connector.
[ ] Fix dedupe key.
[ ] Link externalMarketId to Market.id.
[ ] Backfill resolved wallet PnL.
[ ] Separate realized/open PnL.
```

## `wallet-ranker.ts`

```txt
[ ] Raise min resolved trades.
[ ] Add active days.
[ ] Add jackpot dependency.
[ ] Add drawdown.
[ ] Add category-specific skill.
[ ] Add recent decay.
```

## `wallet-cluster.ts`

```txt
[ ] Require marketId link.
[ ] Check market spread.
[ ] Check market liquidity.
[ ] Check price moved since wallet entry.
[ ] Check side agreement.
[ ] Check copy-late risk.
```

## `model-registry.ts`

```txt
[ ] Persist registry in DB.
[ ] Add status lifecycle.
[ ] Add category-specific weights.
[ ] Add sample-size gates.
[ ] Add audit for model disable/promotion.
```

## `related-market.ts`

```txt
[ ] Implement relationship formulas.
[ ] Add violation score.
[ ] Add relationship confidence.
[ ] Add oracle mismatch warning.
[ ] Add dashboard.
```

## `oracle-mismatch.ts`

```txt
[ ] Parse resolution source.
[ ] Parse cutoff.
[ ] Parse timezone.
[ ] Parse ambiguity.
[ ] Parse human discretion.
[ ] Force manual review for high risk.
```

## `correlation-risk.ts` / `risk-exposure.ts`

```txt
[ ] Auto-create clusters.
[ ] Link markets to clusters.
[ ] Calculate worst-case cluster loss.
[ ] Add same-underlying exposure.
[ ] Add same-oracle exposure.
[ ] Add same-date exposure.
```

## API / auth

```txt
[ ] Enforce API_PERMISSION_MATRIX.
[ ] Add auth middleware.
[ ] Protect credential routes.
[ ] Protect mode change route.
[ ] Protect live execution.
[ ] Add denied-access audit logs.
```

## CI / testing

```txt
[ ] Add failed-fill regression test.
[ ] Add order tracker idempotency test.
[ ] Add scanner pagination fixture test.
[ ] Add Polymarket real-spread fixture test.
[ ] Add wallet dedupe regression test.
[ ] Add no-DEMO-in-PAPER test.
[ ] Add A+ gate pass/fail test.
[ ] Add live readiness test.
```

---

# Remaining gap priority table

| Priority | Gap                                                        | Why it matters                                           |
| -------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| P0       | Polymarket spread is synthetic                             | Edge/risk/paper fill can be fake                         |
| P0       | Order tracker marks failed fills as partial                | Paper results become invalid                             |
| P0       | ORDER_TRACK does not perform real fill processing          | Paper execution lifecycle is incomplete                  |
| P0       | A+ gate is not hard execution gate                         | Risk BID can bypass full acceptance criteria             |
| P0       | Market loop ignores advanced signal stack                  | Intelligence modules exist but are not used early enough |
| P0       | Candidate threshold read but not used                      | Config/UI setting does not control behavior              |
| P1       | Bias correction hardcoded                                  | Wang correction may give false edge                      |
| P1       | Wallet ingestion not end-to-end                            | Wallet alpha cannot actually run reliably                |
| P1       | Wallet dedupe bug                                          | Duplicate trades can corrupt wallet ranking              |
| P1       | Wallet cluster requires marketId but ingestion leaves null | Cluster signals may never fire                           |
| P1       | Model registry in-memory                                   | Ensemble learning resets and cannot govern models        |
| P1       | Correlation clusters not auto-built                        | Cluster risk protection may not work                     |
| P2       | API permissions not enforced                               | Unsafe if hosted                                         |
| P2       | Live readiness placeholders                                | Live mode cannot progress safely                         |
| P2       | Demo data cleanup missing                                  | Mock data can pollute paper metrics                      |
| P2       | Historical backfill undefined                              | Brier/Wang/wallet/backtest cannot be trusted             |

---

# Final conclusion

The latest repo is much better than the earlier version. It already contains most of the planned modules and schema. But the main remaining problem is:

```txt
The system has many advanced parts, but they are not yet fully connected into one trustworthy A+ PAPER trading loop.
```

The next milestone should be very specific:

# Trusted PAPER Mode v1

Required before adding more features:

```txt
1. Real venue data only
2. Real orderbook spread
3. No demo pollution
4. Candidate threshold works
5. Advanced score signals wired
6. A+ gate blocks execution unless all criteria pass
7. Paper order tracker uses realistic fills
8. Failed fills stay FAILED
9. Wallet signals are linked to real markets
10. Brier/ROI metrics count only real A+ paper bets
11. API auth is enforced
12. CI catches lifecycle and mode regressions
```

Only after this should you move to:

```txt
wallet copy trading
related-market arbitrage
market making
tiny live mode
```

Right now, the highest-value implementation work is not adding more AI. It is making the **existing modules truthful, wired, measurable, and safe**.
