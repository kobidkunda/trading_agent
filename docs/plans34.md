Below is a **detailed no-code implementation plan** to upgrade your Trading Agent into a serious prediction-market alpha engine.

Scope: **Polymarket/Kalshi prediction-market system only**.
Not BIOLASTIC. Not generic crypto-exchange bot. Crypto is included only where it helps **prediction-market contracts** like BTC/ETH barrier markets.

Your current app direction is correct: scan Polymarket/Kalshi → research → debate → probability judge → risk engine → paper bet → outcome tracking, but the uploaded research correctly describes it as still **prototype-grade** and missing stronger market-intelligence layers. 

---

# Final target system

```txt
Prediction Market Alpha Engine

1. Real market scanner
2. Real paper-trading engine
3. Market dedupe + freshness tracking
4. Candidate scoring
5. Smart wallet tracking
6. Wang/favorite-longshot bias correction
7. Ensemble probability engine
8. Causal tree research
9. Related-market scanner
10. Orderbook/microstructure engine
11. Correlation + tail-risk engine
12. A+ Signal Gate
13. Paper execution + outcome tracking
14. Brier / calibration / ROI dashboard
15. Walk-forward validation
16. Only then tiny live execution
```

The goal is not “many bets.” The goal is:

```txt
Scan many.
Research fewer.
Bet only A+ setups.
Measure everything.
Scale only after proof.
```

---

# Phase 0 — freeze the rules before building

## Purpose

Before adding features, define what a “good bet” means. Otherwise the app will become a feature-heavy but unprofitable simulator.

## Core decision levels

Every market should end in one of these states:

```txt
SKIP
WATCH
RESEARCH
A_SETUP
A_PLUS_BET
```

## A+ execution rule

A market is allowed to become a paper/live bet only if all are true:

```txt
candidateScore >= 90
adjustedEdge >= minimum threshold
liquidity >= minimum threshold
spread <= maximum threshold
resolutionClarity >= required threshold
confidence >= required threshold
tailRisk acceptable
correlation exposure acceptable
no oracle mismatch issue
no duplicate/cooldown violation
paper performance for setup type is proven
```

## First default thresholds

```txt
candidateScore: >= 90
adjusted edge: >= 6% to 8%
confidence: >= 75%
resolution clarity: >= 85%
source quality: >= 75%
max spread: 2% to 4%
minimum liquidity: configurable by category
max same-event exposure: configurable
max same-category exposure: configurable
```

## Deliverables

```txt
A+ criteria document
risk rule document
market category taxonomy
setup type taxonomy
skip reason taxonomy
```

---

# Phase 1 — fix foundation first

This is the most important phase. Do not add smart-wallet or AI models before this is working.

## 1.1 Separate DEMO, PAPER, LIVE

## Current issue

Dry-run/demo/live are mixed. Your notes also highlight that some systems confuse mock/demo mode with real paper trading.

## Required modes

```txt
DEMO
- fake templates
- UI testing only
- never used for performance metrics

PAPER
- real Polymarket/Kalshi data
- simulated orders
- realistic fill model
- used for strategy validation

LIVE
- real data
- real orders
- disabled until safety checks pass
```

## Todos

```txt
Create backend setting for trading mode.
Make frontend mode switch persist to backend.
Make worker read backend mode, not local frontend state.
Block LIVE unless live connector and safety flags exist.
Move all fake templates into DEMO only.
Ensure PAPER never uses fake templates.
```

## Acceptance criteria

```txt
PAPER mode pulls real venue data.
DEMO mode is clearly labeled.
LIVE mode cannot accidentally place orders.
Dashboard always shows mode, data source, and execution mode.
```

---

## 1.2 Build real paper execution

## Current issue

Paper execution that instantly fills orders is misleading.

## Required behavior

Paper orders must have lifecycle:

```txt
PLANNED
SUBMITTED
PARTIALLY_FILLED
FILLED
CANCELLED
EXPIRED
FAILED
```

## Todos

```txt
Add realistic paper order simulation.
Use orderbook bid/ask for fill assumptions.
Track spread cost.
Track slippage.
Track liquidity cap.
Track partial fill possibility.
Track order expiry.
Track cancellation.
Track actual paper PnL.
Separate WATCH from ORDER.
```

## Acceptance criteria

```txt
WATCH never creates an order.
BID creates a paper order.
Paper order may fill, partially fill, expire, or cancel.
Position opens only after fill.
PnL includes spread/slippage/fees.
```

---

## 1.3 Market freshness and dedupe

## Problem

Repeated markets and stale snapshots destroy trust in results.

## Todos

```txt
Upsert markets by venue + externalId.
Store normalizedTitle.
Store titleHash.
Store firstSeenAt.
Store lastSeenAt.
Store lastSnapshotAt.
Store latest implied probability.
Store latest spread.
Store latest liquidity.
Add duplicate status.
Add cooldown status.
```

## Candidate dedupe rules

Do not reprocess if:

```txt
same venue + externalId already exists
same normalized title recently researched
same market is currently RESEARCHING
market already EXECUTED and price did not move enough
market on cooldown
market closed/resolved
```

## Acceptance criteria

```txt
Repeated scan updates same market, not duplicate row.
Dashboard shows lastSeenAt and snapshot age.
Market list can filter stale/fresh/duplicate markets.
```

---

# Phase 2 — build the scoring layer

This is where the app stops treating all markets equally.

## 2.1 Numeric Market Score

Your notes correctly point out that pass/fail triage is not enough; a numeric score lets the system rank 50+ markets and prioritize the best ones. 

## Scoring formula

```txt
candidateScore =
  liquidityScore
+ spreadScore
+ edgeScore
+ confidenceScore
+ sourceQualityScore
+ resolutionClarityScore
+ recencyScore
+ categoryPriorityScore
+ walletSignalScore
+ relatedMarketSignalScore
- uncertaintyPenalty
- contradictionPenalty
- duplicatePenalty
- stalePenalty
- oracleRiskPenalty
- correlationRiskPenalty
- manipulationRiskPenalty
```

## Score bands

```txt
0–49   = SKIP
50–69  = STORE / WATCH LOW
70–84  = QUICK RESEARCH
85–89  = STANDARD RESEARCH
90–100 = A+ CANDIDATE
```

## Todos

```txt
Create score components.
Create score explanation output.
Store accepted criteria.
Store rejected criteria.
Store skip reason.
Show score breakdown in UI.
```

## Acceptance criteria

Every candidate should show:

```txt
total score
score components
why it passed
why it failed
next action
next eligible time
```

---

## 2.2 Cost-adjusted edge calculator

## Purpose

Never compare your probability directly with market price. You need adjusted edge.

## Formula

```txt
rawEdge = ourProbability - marketProbability

adjustedEdge =
  rawEdge
- spreadCost
- slippageCost
- feeCost
- uncertaintyPenalty
- resolutionRiskPenalty
- liquidityPenalty
```

## Todos

```txt
Calculate raw edge.
Calculate adjusted edge.
Estimate fill cost from orderbook.
Estimate uncertainty penalty.
Estimate resolution ambiguity penalty.
Reject low adjusted-edge trades.
```

## Acceptance criteria

No A+ bet can execute unless:

```txt
adjustedEdge >= configured minimum
```

---

# Phase 3 — add Wang / bias correction

Prediction markets often have favorite-longshot bias. Your uploaded notes specifically mention Wang Transform-style correction and warn that naïvely comparing LLM probability against market price is weak. 

## Purpose

Convert market price into a better fair-market baseline before comparing your model.

## Add module

```txt
MarketBiasCorrectionEngine
```

## Inputs

```txt
market price
category
time to resolution
market liquidity
historical resolved market data
contract type
favorite/longshot status
```

## Outputs

```txt
biasAdjustedMarketProbability
favoriteLongshotBias
correctionConfidence
```

## Todos

```txt
Collect resolved market history.
Classify markets by category.
Estimate bias by probability bucket.
Estimate bias by category.
Apply correction before edge calculation.
Show raw price vs corrected price.
```

## Example

```txt
Market YES price: 0.57
Naive implied probability: 57%

After correction:
bias-adjusted fair market probability: 50%–53%

Your model probability: 64%

Adjusted edge becomes more meaningful.
```

## Acceptance criteria

Dashboard should show:

```txt
market price probability
bias-adjusted probability
our probability
raw edge
adjusted edge
```

---

# Phase 4 — Brier score and calibration

This must be built early. Otherwise you will not know whether the system is truly improving.

Your notes call rolling Brier score a critical fix and suggest breaking edge down by category. 

## Add metrics

```txt
Brier score
rolling 50-bet Brier score
rolling 100-bet Brier score
calibration error
A+ bucket win rate
A+ bucket ROI
category-wise Brier
model-wise Brier
setup-wise Brier
```

## Calibration buckets

```txt
50–60% predictions
60–70% predictions
70–80% predictions
80–90% predictions
90–100% predictions
```

## What to check

If the model says:

```txt
80% probability
```

Then over many bets, it should resolve true around:

```txt
80%
```

If it resolves only 55%, the model is badly calibrated.

## Todos

```txt
Store every model prediction.
Store final outcome.
Calculate Brier after resolution.
Calculate rolling Brier.
Calculate category-level Brier.
Calculate setup-type Brier.
Calculate model-level Brier.
Display calibration chart.
```

## Acceptance criteria

Do not enable live mode until:

```txt
A+ bucket has enough sample size
A+ Brier is acceptable
A+ ROI is positive
calibration is not broken
```

---

# Phase 5 — smart wallet tracker

This is one of the strongest practical upgrades.

Your research notes describe wallet tracking as a high-priority intelligence layer: strong wallets entering/exiting can signal hidden information or early positioning. 

## Purpose

Track top-performing Polymarket wallets and use their movement as a research trigger.

## Add modules

```txt
WalletIngestionEngine
WalletPerformanceRanker
WalletClusterSignalDetector
WalletCopyRiskFilter
```

## Data to collect

```txt
wallet address
market traded
side
quantity
price
timestamp
market category
resolution date
current position
realized PnL
unrealized PnL
win rate
profit factor
Brier score
category specialization
average position size
holding time
```

## Wallet ranking

Rank wallets by:

```txt
resolved PnL
not open-position PnL only
win rate
profit factor
Brier score
number of resolved trades
category consistency
recent performance
drawdown
average edge captured
```

## Avoid survivorship bias

Do not trust wallets with:

```txt
too few trades
one lucky win
only open profit
extreme concentration
unknown resolution history
poor recent performance
```

## Cluster trigger rule

Trigger deep research if:

```txt
3+ high-ranked wallets enter same market
within 10 minutes
same side
combined size above threshold
market still liquid
spread acceptable
```

## Todos

```txt
Pull historical wallet trades.
Build wallet ranking table.
Create top-wallet watchlist.
Subscribe/poll wallet activity.
Detect cluster entries.
Create walletSignalScore.
Auto-queue deep research.
Log hypothetical entry price.
Track paper PnL of wallet-copy signals.
```

## Acceptance criteria

Before live use:

```txt
at least 2–4 weeks passive observation
at least 100 wallet-cluster signals
positive paper PnL
acceptable Brier score
no overdependence on one wallet
```

---

# Phase 6 — ensemble probability engine

Single LLM probability is not enough. Your notes recommend stacking multiple estimators and weighting them by historical Brier score per model/category. 

## Add module

```txt
EnsembleProbabilityEngine
```

## Inputs

```txt
LLM probability
TradingAgents probability
DeerFlow probability
statistical baseline probability
wallet signal probability
related-market probability
orderbook pressure probability
news/social sentiment probability
manual override probability
```

## Output

```txt
finalProbability
confidence
uncertainty
modelDisagreement
bestModelForCategory
modelWeights
```

## Weighting logic

```txt
models with better historical Brier score get more weight
models with weak performance get downweighted
models with high disagreement trigger WATCH/SKIP
```

## Todos

```txt
Standardize all research output into one schema.
Store model predictions separately.
Track model accuracy after resolution.
Create category-specific model weights.
Create ensemble probability.
Create disagreement score.
Block A+ when disagreement is too high.
```

## Acceptance criteria

Every final decision must show:

```txt
individual model probabilities
model weights
ensemble probability
disagreement score
confidence
```

---

# Phase 7 — causal tree research

Your notes mention SimpleFunctions-style thesis decomposition: turn one thesis into a tree of assumptions and scan contracts around it. 

## Purpose

Replace flat “research this market” prompts with structured causal reasoning.

## Example

Market:

```txt
Will Bitcoin exceed $100,000 by end of 2026?
```

Causal tree:

```txt
Main thesis
├── ETF inflows
├── macro liquidity
├── interest-rate path
├── BTC supply
├── volatility regime
├── regulatory events
├── market positioning
└── contradiction checks
```

Each node gets:

```txt
probability
importance weight
evidence
source quality
confidence
last updated
contradictions
```

## Todos

```txt
Create thesis parser.
Create assumption tree.
Assign node weights.
Attach evidence sources to each node.
Estimate node probabilities.
Aggregate into final market probability.
Track which assumptions later proved useful.
```

## Acceptance criteria

Deep research output should show:

```txt
causal tree
node probabilities
node weights
evidence links
contradictions
final aggregated probability
```

---

# Phase 8 — related-market scanner

This is one of the best ways to find edge without pure prediction.

## Purpose

Find contradictions between related contracts.

## Relationship types

```txt
same outcome
opposite outcome
nested outcome
mutually exclusive outcomes
collectively exhaustive outcomes
range markets
calendar variants
venue duplicates
```

## Examples

```txt
BTC > 100K by Dec
BTC > 120K by Dec

The 120K probability cannot logically exceed 100K probability.
```

```txt
Candidate wins nomination
Candidate wins presidency

Presidency probability should not exceed nomination probability unless market definitions differ.
```

## Todos

```txt
Normalize market titles.
Extract entities.
Extract dates.
Extract thresholds.
Extract outcomes.
Cluster related markets.
Classify relationship type.
Calculate contradiction score.
Create arbitrage/mispricing alert.
Feed relatedMarketSignalScore into A+ gate.
```

## Acceptance criteria

Dashboard should show:

```txt
related markets
relationship type
price inconsistency
possible edge
resolution rule warning
```

---

# Phase 9 — orderbook microstructure

For liquid markets, price alone is not enough.

## Add module

```txt
OrderbookMicrostructureEngine
```

## Track

```txt
best bid
best ask
spread
bid depth
ask depth
depth imbalance
large walls
thin-book danger
price impact
fill probability
recent book movement
depth decay near resolution
```

## Use cases

```txt
avoid fake liquidity
estimate paper fill correctly
detect whale pressure
detect short-term direction pressure
adjust position size
```

## Later advanced feature

Add DeepLOB-style orderbook model as a feature only.

Do not let it trade directly.

## Todos

```txt
Store orderbook snapshots.
Calculate depth imbalance.
Calculate spread trend.
Calculate price impact by order size.
Calculate fill probability.
Feed into paper execution.
Feed into candidate score.
```

## Acceptance criteria

A+ bet cannot execute if:

```txt
orderbookQuality below threshold
price impact too high
spread too wide
fill probability too low
```

---

# Phase 10 — correlation and tail-risk engine

Your research notes identify correlated market exposure as a critical missing control: daily exposure is not enough if many positions depend on the same event. 

## Add module

```txt
CorrelationRiskEngine
TailRiskAnalyzer
```

## Risk clusters

```txt
same event
same category
same country
same election
same sports team
same crypto asset
same macro variable
same resolution source
same date window
```

## Tail-risk metrics

```txt
max gain
max loss
loss-to-win ratio
one-loss-wipes-N-wins score
correlation-adjusted exposure
cluster exposure
liquidity-adjusted exit risk
```

## Example warning

```txt
This NO bet has 92% estimated win chance,
but one loss wipes out 14 similar wins.
```

## Todos

```txt
Create event cluster IDs.
Create correlation tags.
Calculate cluster exposure.
Calculate worst-case cluster loss.
Limit same-underlying exposure.
Limit same-resolution exposure.
Add tail-risk warnings.
```

## Acceptance criteria

System must block bets when:

```txt
cluster exposure exceeds limit
same-underlying exposure exceeds limit
tail-loss ratio too high
drawdown limit reached
```

---

# Phase 11 — oracle / resolution mismatch guard

Your notes mention cross-platform oracle/resolution mismatch as a major risk. 

## Purpose

Prevent losing money because two similar markets resolve differently.

## Add module

```txt
ResolutionRuleParser
OracleMismatchGuard
```

## Check

```txt
venue
oracle source
resolution criteria
date/time cutoff
timezone
ambiguous wording
human discretion
official source
appeal/challenge process
similar market on other venue
```

## Risk levels

```txt
LOW
MEDIUM
HIGH
BLOCK
```

## Todos

```txt
Parse resolution text.
Extract oracle/source.
Compare similar markets across venues.
Detect mismatched definitions.
Flag ambiguous markets.
Require manual review for high-risk resolution.
```

## Acceptance criteria

A+ bet blocked if:

```txt
resolution ambiguity high
oracle mismatch high
cross-venue definitions conflict
```

---

# Phase 12 — three-tier research gating

Do not run expensive research on every market.

## Tiers

```txt
Tier 0: no research
- low score
- stale
- low liquidity
- wide spread

Tier 1: quick research
- market metadata
- simple search
- one LLM summary

Tier 2: standard research
- search + source quality
- TradingAgents/LLM
- contradiction check

Tier 3: deep research
- causal tree
- multiple sources
- debate
- ensemble
- related-market check
- wallet check
```

## Routing

```txt
score < 70: no research
70–84: quick research
85–89: standard research
90+: deep research
wallet cluster trigger: deep research
related-market contradiction: deep research
large price tremor: deep research
```

## Todos

```txt
Add researchDepth field.
Add research budget limits.
Add queue priority.
Add max deep research per hour.
Add fallback if provider fails.
Add checkpoint/resume for long research.
```

## Acceptance criteria

```txt
weak markets do not consume expensive research
deep research only runs on high-value candidates
failed research does not get stuck forever
```

---

# Phase 13 — worker and job reliability

## Problems to prevent

```txt
jobs stuck in RESEARCHING
failed retries not picked up
duplicate processing
long research lost after crash
```

## Add job lifecycle

```txt
PENDING
RUNNING
RETRYING
COMPLETED
FAILED
CANCELLED
STALE_LOCK_RELEASED
```

## Todos

```txt
Worker must process PENDING and RETRYING.
Add lock timeout.
Add retry count.
Add backoff.
Add stale job recovery.
Add job dependency chain.
Add checkpoint for long research.
Add worker health dashboard.
```

## Job types

```txt
SCAN_VENUE
UPSERT_MARKETS
SCORE_CANDIDATES
TRIAGE_MARKET
QUICK_RESEARCH
STANDARD_RESEARCH
DEEP_RESEARCH
ENSEMBLE_PROBABILITY
RISK_CHECK
PAPER_EXECUTE
ORDER_TRACK
RESOLUTION_CHECK
POSTMORTEM
```

## Acceptance criteria

```txt
No market stays RESEARCHING forever.
Failed provider does not kill pipeline.
Retried jobs actually run.
Dashboard shows stuck jobs.
```

---

# Phase 14 — dashboards

## Required pages

```txt
/live-scanner
/candidates
/a-plus-signals
/research-queue
/wallets
/related-markets
/orderbook
/risk
/paper-orders
/paper-bets
/outcomes
/calibration
/backtests
/settings
/system-health
```

## Important columns

For candidates:

```txt
market
venue
category
price
bias-adjusted price
our probability
adjusted edge
candidate score
liquidity
spread
wallet signal
related-market signal
resolution clarity
tail risk
decision
skip reason
next eligible time
```

For A+ dashboard:

```txt
A+ score
accepted criteria
rejected criteria
model disagreement
max stake
risk flags
paper status
final outcome
```

For performance:

```txt
A+ win rate
A+ ROI
A+ Brier
category ROI
category Brier
model Brier
setup performance
drawdown
```

---

# Phase 15 — backtesting and walk-forward validation

The deep-trading research file says the awesome-deep-trading repo is mostly a curated list, not a runnable trading system, but it highlights useful families: models, data, infrastructure, evaluation, and deployment. 

Your app must become runnable and testable.

## Add modes

```txt
TRAIN
TEST
PAPER
LIVE
```

## Backtest engine

Must replay:

```txt
historical market snapshots
historical orderbook if available
model predictions at that time
wallet signals at that time
candidate score
paper order fill assumptions
final outcome
```

## Walk-forward testing

```txt
train on period A
test on future period B
roll forward
repeat
```

## Todos

```txt
Create historical snapshot store.
Create replay runner.
Create strategy config versioning.
Create result comparison.
Create walk-forward validator.
Create performance-by-setup report.
```

## Acceptance criteria

No strategy goes live unless:

```txt
tested out-of-sample
tested by category
tested by setup type
tested with realistic execution
positive A+ ROI
acceptable drawdown
```

---

# Phase 16 — strategy optimizer

## Purpose

Find the best thresholds without guessing.

## Parameters to optimize

```txt
candidate score threshold
minimum adjusted edge
minimum liquidity
maximum spread
confidence threshold
resolution clarity threshold
wallet cluster size
wallet ranking threshold
cooldown length
position size cap
category exposure cap
research depth routing
```

## Todos

```txt
Create strategy config versions.
Run parameter sweeps.
Compare ROI/Brier/drawdown.
Reject overfit configs.
Promote best config to PAPER mode.
```

## Acceptance criteria

Every strategy config should have:

```txt
version
date range tested
sample size
A+ win rate
A+ ROI
Brier
drawdown
notes
status: draft / testing / paper / live-approved
```

---

# Phase 17 — tiny live mode later

Do not build live execution until paper mode proves real edge.

## Live preconditions

```txt
500+ paper bets/trades
A+ bucket win rate >= 75%–80%
positive ROI after simulated costs
acceptable Brier
calibration acceptable
drawdown controlled
no repeated fake markets
paper execution realistic
manual review passed
```

## Live safety

```txt
global kill switch
daily loss limit
max bet size
max category exposure
max event cluster exposure
manual approval mode first
no auto-scaling
wallet/key safety
full audit log
```

## Live rollout

```txt
Stage 1: paper only
Stage 2: manual approval
Stage 3: tiny auto mode
Stage 4: limited capital
Stage 5: scale only after 30–90 days
```

---

# Full implementation todo list

## Foundation todos

```txt
[ ] Separate DEMO/PAPER/LIVE modes.
[ ] Make PAPER use real venue data only.
[ ] Remove fake templates from PAPER.
[ ] Add backend-persisted mode settings.
[ ] Add worker mode awareness.
[ ] Add global kill switch.
[ ] Add market freshness fields.
[ ] Add venue + externalId dedupe.
[ ] Add normalized title dedupe.
[ ] Add market cooldown logic.
```

## Paper execution todos

```txt
[ ] Add paper order lifecycle.
[ ] Add realistic fill model.
[ ] Add partial fill simulation.
[ ] Add order expiry.
[ ] Add paper PnL calculation.
[ ] Add paper position tracking.
[ ] Add paper order dashboard.
[ ] Separate WATCH from BID.
```

## Scoring todos

```txt
[ ] Add candidateScore.
[ ] Add score component table.
[ ] Add accepted criteria JSON.
[ ] Add rejected criteria JSON.
[ ] Add skip reason taxonomy.
[ ] Add cost-adjusted edge.
[ ] Add bias-adjusted probability.
[ ] Add score dashboard.
```

## Research todos

```txt
[ ] Add 3-tier research gating.
[ ] Add causal tree research.
[ ] Standardize research output schema.
[ ] Add provider fallback.
[ ] Add model disagreement score.
[ ] Add research checkpoint/resume.
[ ] Add source quality scoring.
```

## Ensemble todos

```txt
[ ] Store each model prediction.
[ ] Track model Brier score.
[ ] Create category-specific model weights.
[ ] Create ensemble probability.
[ ] Create uncertainty score.
[ ] Block high-disagreement bets.
```

## Wallet intelligence todos

```txt
[ ] Pull wallet trade history.
[ ] Rank wallets by resolved performance.
[ ] Track top wallets.
[ ] Detect wallet clusters.
[ ] Add walletSignalScore.
[ ] Paper-test wallet-copy signals.
[ ] Add wallet dashboard.
```

## Related-market todos

```txt
[ ] Normalize titles/entities/dates.
[ ] Cluster related markets.
[ ] Detect nested/opposite/same outcomes.
[ ] Detect impossible pricing.
[ ] Add relatedMarketSignalScore.
[ ] Add related-market dashboard.
```

## Risk todos

```txt
[ ] Add event cluster exposure.
[ ] Add same-category exposure.
[ ] Add same-underlying exposure.
[ ] Add same-oracle exposure.
[ ] Add tail-risk analyzer.
[ ] Add oracle mismatch guard.
[ ] Add drawdown stop.
[ ] Add max daily risk.
```

## Performance todos

```txt
[ ] Add Brier score.
[ ] Add rolling Brier score.
[ ] Add calibration chart.
[ ] Add ROI by category.
[ ] Add win rate by setup.
[ ] Add A+ bucket dashboard.
[ ] Add postmortem reports.
```

## Backtesting todos

```txt
[ ] Store historical snapshots.
[ ] Store historical predictions.
[ ] Build replay engine.
[ ] Add walk-forward validator.
[ ] Add strategy config versions.
[ ] Add optimizer.
[ ] Add train/test/paper/live separation.
```

---

# Recommended build order

## Sprint 1 — make the app trustworthy

```txt
1. DEMO/PAPER/LIVE separation
2. Real scanner into PAPER
3. Market dedupe/freshness
4. Realistic paper execution
5. WATCH vs BID separation
```

## Sprint 2 — make decisions measurable

```txt
1. Candidate score
2. Cost-adjusted edge
3. Brier score
4. Calibration dashboard
5. A+ Signal Gate
```

## Sprint 3 — add intelligence

```txt
1. Wang/bias correction
2. Ensemble probability
3. 3-tier research gating
4. Causal tree research
5. Related-market scanner
```

## Sprint 4 — add alpha sources

```txt
1. Smart wallet tracker
2. Wallet cluster signals
3. Orderbook microstructure
4. Tail-risk analyzer
5. Oracle mismatch guard
```

## Sprint 5 — prove it

```txt
1. Backtest engine
2. Walk-forward validation
3. Strategy optimizer
4. Performance by setup
5. Paper-mode promotion rules
```

## Sprint 6 — tiny live mode

```txt
1. Manual approval mode
2. Tiny execution limits
3. Kill switch
4. Audit logs
5. 30–90 day live proof
```

---

# Final acceptance criteria

The implementation is successful only when:

```txt
PAPER uses real data, not demo data.
Every candidate has a score and skip reason.
Every A+ bet has accepted criteria saved.
Every model prediction is scored after resolution.
Every bet contributes to Brier/calibration metrics.
Risk engine blocks correlated exposure.
Wallet signals are paper-tested before use.
Orderbook determines fill realism.
A+ bucket shows positive ROI and acceptable Brier.
LIVE stays disabled until paper proof exists.
```

---

# Final recommendation

Build this in this order:

```txt
1. Real paper engine
2. A+ Signal Gate
3. Brier/calibration dashboard
4. Wang/bias correction
5. Smart wallet tracker
6. Ensemble probability
7. Related-market scanner
8. Correlation/tail-risk engine
9. Backtest/walk-forward validation
```

This gives you the best path toward a real edge because it focuses on:

```txt
real data
realistic execution
measured probability skill
strict filtering
risk control
only A+ bets
```

Do not chase more AI first. First make the app **truthful, measurable, and selective**.
