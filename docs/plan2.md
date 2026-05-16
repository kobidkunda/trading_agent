Below is the **prediction-market app audit only** — **no crypto part**.

Based on the uploaded app, the main problem is not only repeated markets. The app currently mixes:

```txt
Demo simulation
Real scanner
Paper trading
Live mode UI
Research pipeline
Order execution
```

These are not separated cleanly, so the system behaves like a demo instead of a real paper-trading bot.

---

# 1. Biggest gap: dry-run is not real paper trading

## Current behavior

The app has this flow:

```txt
src/lib/engine/live-simulation.ts
```

It uses hardcoded `MARKET_TEMPLATES`.

That is why you repeatedly see:

```txt
Will Bitcoin exceed $100,000 by end of 2026?
Will Solana surpass $500 by September 2026?
Will global temperatures set a new record high in 2026?
Will a team score 100+ points in NBA playoffs?
Will an Oscar-winning film in 2026 be AI-generated?
```

The app creates fake market IDs like:

```txt
live_...
```

So the same title becomes a new “market” again and again.

## Required update

Split modes clearly:

```txt
DEMO mode  = hardcoded fake templates
PAPER mode = real Polymarket/Kalshi data + simulated execution
LIVE mode  = real data + real execution, disabled until connector is ready
```

Current dry-run must become:

```txt
PAPER mode = real market data, no real money execution
```

---

# 2. Real scanner is separate but not connected properly

There is a real scanner:

```txt
src/lib/engine/scanner.ts
```

It calls:

```txt
src/lib/venues/polymarket.ts
src/lib/venues/kalshi.ts
```

But the live simulation does **not** use this scanner. It uses mock templates.

So your app has real scanner code, but the main “live/dry-run screen” is still running demo logic.

## Required update

Create a real market loop:

```txt
src/lib/engine/market-loop.ts
```

It should do:

```txt
Every 1–5 minutes:
  scan Polymarket
  scan Kalshi
  upsert markets
  create snapshots
  score candidates
  dedupe
  queue triage/research
```

---

# 3. Worker does not run continuous lifecycle

Current worker:

```txt
src/lib/engine/worker.ts
```

It only picks one pending job at a time.

When worker starts, API creates one `SCAN` job:

```txt
src/app/api/jobs/worker/route.ts
```

But after scan:

```txt
No automatic TRIAGE jobs
No automatic RESEARCH jobs
No automatic JUDGE jobs
No automatic RISK jobs
No recurring SCAN jobs
```

So it is not a real continuous bot.

## Critical bug

When a job fails, worker sets status to:

```txt
RETRYING
```

But worker only fetches:

```txt
status: PENDING
```

So failed retry jobs get stuck forever.

## Required update

Worker must process:

```txt
PENDING
RETRYING
```

And it must create lifecycle jobs:

```txt
SCAN_VENUE
SCORE_CANDIDATES
TRIAGE_MARKET
RESEARCH_MARKET
JUDGE_MARKET
RISK_CHECK
PAPER_EXECUTE
ORDER_TRACK
RESOLUTION_CHECK
```

---

# 4. Venue data fetching is incomplete

## Polymarket issue

File:

```txt
src/lib/venues/polymarket.ts
```

Current fetch:

```txt
/markets?limit=100&active=true
```

Problems:

```txt
only first 100 markets
no pagination
no cursor
no real order book
spread is fake-calculated
liquidity uses volume-like field
no proper closed/resolved sync
```

## Kalshi issue

File:

```txt
src/lib/venues/kalshi.ts
```

Current fetch:

```txt
/markets?limit=100
```

Problems:

```txt
only first 100 markets
no cursor pagination
no active/open filtering clarity
no series/event grouping
no complete snapshot tracking
```

## Required update

Both adapters need:

```txt
pagination
cursor support
active-market filtering
closed/resolved filtering
order book / bid-ask snapshot
rate-limit handling
retry/backoff
raw response logging
```

---

# 5. Market deduplication is weak

Current schema:

```prisma
externalId String @unique
venue      String
```

But code checks:

```txt
externalId + venue
```

Better schema:

```prisma
@@unique([venue, externalId])
```

Also add:

```txt
normalizedTitle
titleHash
firstSeenAt
lastSeenAt
isActive
isClosed
isResolved
```

## Current problem

Mock markets get random IDs:

```txt
live_DateNow_random
```

So dedupe cannot work.

## Required update

Real markets should dedupe by:

```txt
venue + externalId
```

And candidates should dedupe by:

```txt
marketId
normalized title
resolution date
outcomes
```

---

# 6. Market freshness tracking is missing

Existing scanner creates new snapshots, but it does not properly update the parent market freshness.

Current market table does not have:

```txt
lastSeenAt
lastSnapshotAt
snapshotAge
scanRunId
```

Also `/api/markets` orders by:

```txt
Market.updatedAt
```

But adding a new snapshot does not necessarily update `Market.updatedAt`.

So UI can show stale ordering.

## Required update

When scanner sees an existing market:

```txt
create MarketSnapshot
update Market.lastSeenAt
update Market.updatedAt
update status
```

UI should display:

```txt
lastSeenAt
snapshotAge
latest implied probability
latest spread
latest liquidity
```

---

# 7. No ScanRun / audit-grade scan tracking

Currently scan only writes a simple audit log.

Need proper scan tracking:

```txt
ScanRun
VenueCursor
MarketSnapshot
CandidateRun
```

## Add `ScanRun`

Fields:

```txt
venue
startedAt
finishedAt
status
marketsFetched
marketsCreated
marketsUpdated
marketsSkipped
errorMessage
cursorStart
cursorEnd
```

This lets you see whether the app is actually getting fresh data.

---

# 8. Candidate selection algorithm is missing

Right now scanner creates `TradeCandidate` for every new market.

There is no strong pre-score before LLM research.

That means the app may waste research on bad markets.

## Required algorithm

Add candidate score:

```txt
candidateScore =
  liquidityScore
+ spreadScore
+ volumeScore
+ priceMoveScore
+ freshnessScore
+ categoryPriority
- duplicatePenalty
- stalePenalty
- alreadyProcessedPenalty
```

Decision:

```txt
score < 50     → skip
50–69          → store snapshot only
70–84          → triage
85–89          → quick research
90+            → full research + debate + risk
```

This will prevent repeated heavy research on weak markets.

---

# 9. Candidate cooldown is missing

Same market can be processed again and again.

Need cooldown rules:

```txt
same market triage cooldown: 1–3 hours
same market research cooldown: 6–24 hours
same market execution cooldown: until price moves significantly
watch recheck: 1–6 hours
failed research retry: max 3 retries
```

Reprocess only if:

```txt
implied probability moved 3%–5%
liquidity changed significantly
spread improved
new relevant news found
manual force-research clicked
cooldown expired
```

---

# 10. Pipeline stage logic is not clean

File:

```txt
src/lib/engine/pipeline.ts
```

Current problem:

All job types eventually call:

```txt
runPipelineForMarket()
```

So `TRIAGE`, `RESEARCH`, `JUDGE`, and `RISK` jobs are not truly independent stages.

That makes resume/retry difficult.

## Required update

Split pipeline into real stage functions:

```txt
runTriageStage()
runResearchStage()
runJudgeStage()
runRiskStage()
runPaperExecutionStage()
```

Then worker can retry only the failed stage.

---

# 11. Research can return too early

In `pipeline.ts`, if DeerFlow is down and fallback runs, the function can still return early before judge/risk execution.

Current bad behavior:

```txt
DeerFlow down
→ fallback maybe attempted
→ return result
→ no debate
→ no risk
→ candidate stuck
```

## Required update

Research failure should not stop everything if fallback data exists.

Correct logic:

```txt
Primary research fails
→ fallback research
→ if minimum research exists, continue to debate
→ if no research exists, mark failed with retry
```

Do not leave candidate permanently stuck in `RESEARCHING`.

---

# 12. Candidate stages are inconsistent

Current stages:

```txt
SCANNED
TRIAGED
RESEARCHING
JUDGED
DECIDED
EXECUTED
SETTLED
```

Problems:

```txt
RESEARCHING can be set after research already ran
no RESEARCHED stage
no FAILED stage
no SKIPPED stage
no WATCHING cooldown/recheck logic
```

## Required stages

Use:

```txt
SCANNED
TRIAGED
RESEARCH_QUEUED
RESEARCHING
RESEARCHED
JUDGED
DECIDED
WATCHING
EXECUTED
SKIPPED
FAILED
SETTLED
```

Add:

```txt
lastProcessedAt
nextEligibleAt
processingLock
lockExpiresAt
retryCount
lastError
cooldownUntil
```

---

# 13. Risk engine has serious logic bugs

## Bug 1: wrong position fields

In `pipeline.ts`, exposure calculation uses:

```txt
pos.amount
pos.marketCategory
```

But `Position` schema has:

```txt
currentSize
marketId
market.category through relation
```

So exposure calculation is broken.

## Required fix

Fetch:

```txt
Position include Market
```

Then calculate:

```txt
actualDailyExposure += pos.currentSize
if pos.market.category === market.category:
  actualCategoryExposure += pos.currentSize
```

---

## Bug 2: WATCH can create fake orders

Current logic:

```ts
if (riskResult.action === 'BID' || riskResult.action === 'WATCH') {
  create order
  create position
  create paper bet
}
```

This is wrong.

`WATCH` should not create an order or position.

Correct:

```txt
BID   → create paper order / paper position
WATCH → create watchlist item only
SKIP  → save decision only
```

---

## Bug 3: WATCH may accidentally size a trade

Risk returns:

```txt
adjustedSize = 0
maxSize = 0
```

But pipeline uses:

```ts
riskResult.adjustedSize || riskResult.maxSize || computePositionSize(...)
```

Since `0` is falsy, it falls back to `computePositionSize()`.

So a WATCH decision can still get a non-zero paper order.

This must be fixed immediately.

Use null-safe check, not `||`.

---

## Bug 4: risk settings are hardcoded

`risk.ts` has constants:

```txt
MAX_POSITION_SIZE
BID_EDGE_THRESHOLD
WATCH_EDGE_THRESHOLD
MAX_DAILY_EXPOSURE
MAX_CATEGORY_EXPOSURE
MIN_LIQUIDITY
MAX_SPREAD
```

But strategy settings also exist in DB.

The risk engine should use DB strategy settings, not hardcoded constants.

---

## Bug 5: open position count is used like money

In risk sizing:

```ts
MAX_POSITION_SIZE - input.openPositions
```

`openPositions` is a count, not exposure amount.

So this logic is mathematically wrong.

Need:

```txt
remainingMarketCapacity
remainingDailyExposure
remainingCategoryExposure
```

---

# 14. Paper execution is too fake

Current behavior:

```txt
create order
filledSize = orderSize
status = FILLED
create position immediately
```

This is not realistic.

Even in paper mode, order lifecycle should simulate:

```txt
PLANNED
SUBMITTED
PARTIALLY_FILLED
FILLED
CANCELLED
FAILED
EXPIRED
```

Paper fills should depend on:

```txt
best bid
best ask
spread
liquidity
order size
slippage
timeout
```

## Required update

Create:

```txt
src/lib/engine/paper-execution.ts
src/lib/engine/order-tracker.ts
```

Paper mode should still behave like real order tracking.

---

# 15. Live mode is UI-only

Frontend has dry-run/live toggle:

```txt
src/app/page.tsx
src/components/trading/StrategyHub.tsx
src/store/trading-store.ts
```

But this is mostly Zustand/frontend state.

Backend worker route starts with:

```txt
dryRun: true
```

And pipeline uses:

```txt
isTestMode()
```

which is an in-memory variable.

Problems:

```txt
mode not persisted in DB
mode lost on server restart
UI live mode does not mean backend live mode
backend has no real execution connector
```

## Required update

Store mode in DB:

```txt
trading_mode = DEMO | PAPER | LIVE
data_source = MOCK | REAL
execution_mode = SIMULATED | REAL
global_kill_switch = true/false
```

Worker must read mode from DB.

LIVE mode should be blocked until live connectors are implemented.

---

# 16. Bundled DB does not match Prisma schema

Important blocker.

`prisma/schema.prisma` contains:

```txt
PaperBet
```

But both bundled DB files do not have `PaperBet` table:

```txt
db/custom.db
prisma/db/custom.db
```

This can break:

```txt
/api/paper-bets
/api/verify
resolution-poller
createPaperBet()
paper accuracy metrics
```

## Required fix

Run migration / db push:

```bash
npx prisma generate
npx prisma db push
```

But first decide final schema changes, then migrate once.

---

# 17. Resolution logic will fail for fake markets

Resolution poller uses market `externalId` to call:

```txt
Polymarket / Kalshi APIs
```

But fake markets have IDs like:

```txt
live_...
sim_...
```

These are not real venue IDs.

So resolution polling cannot work correctly for demo-created markets.

## Required update

Separate:

```txt
DemoOutcomeResolver
RealVenueResolutionPoller
```

Paper mode with real data should use real external IDs.

Demo mode should use synthetic demo resolution only.

---

# 18. Research cost control is missing

Current full research can be very heavy:

```txt
SearXNG
Firecrawl
DeerFlow
TradingAgents
Agent-Reach
Debate arena
MiroFish
Qdrant
```

But the app does not strongly control when to use each.

## Required research algorithm

Use adaptive levels:

```txt
LOW score:
  no research

MEDIUM score:
  quick research

HIGH score:
  standard research

VERY HIGH score:
  full research + debate
```

Example:

```txt
candidateScore 70–84 → quick
candidateScore 85–89 → standard
candidateScore 90+   → deep
```

This prevents burning tokens/services on every market.

---

# 19. Triage skip does not create a useful decision record

If triage says not worth research, pipeline returns early.

That means:

```txt
no Decision record
no skip analytics
no reason-code analytics
no future learning
```

## Required update

Every terminal outcome should create a record:

```txt
TRIAGE_SKIP
RESEARCH_FAILED
RISK_SKIP
WATCH
BID
```

This lets you see why markets were skipped.

---

# 20. UI lacks debugging columns

The market table should show why something is repeated/stale.

Add columns:

```txt
externalId
normalizedTitle
lastSeenAt
snapshotAge
latestSnapshotAt
candidateScore
cooldownUntil
nextEligibleAt
sourceMode
dataSource
scanRunId
lastResearchAt
lastDecisionAt
duplicateStatus
```

This will make issues visible immediately.

---

# 21. Main architectural update needed

The app should become:

```txt
Venue Scanner
  ↓
Market Upsert
  ↓
Snapshot Refresh
  ↓
Candidate Scoring
  ↓
Deduplication + Cooldown
  ↓
Job Queue
  ↓
Triage
  ↓
Research
  ↓
Judge / Debate
  ↓
Risk Engine
  ↓
Paper Execution
  ↓
Order Tracker
  ↓
Resolution / Accuracy
```

Right now it is closer to:

```txt
Demo templates
  ↓
Pipeline
  ↓
Instant fake order
```

---

# 22. Files that need update

## Critical

```txt
src/lib/engine/live-simulation.ts
src/lib/engine/simulation.ts
src/lib/engine/scanner.ts
src/lib/engine/worker.ts
src/lib/engine/pipeline.ts
src/lib/engine/risk.ts
src/lib/engine/mode.ts
src/lib/venues/polymarket.ts
src/lib/venues/kalshi.ts
prisma/schema.prisma
```

## API

```txt
src/app/api/simulation/route.ts
src/app/api/jobs/worker/route.ts
src/app/api/markets/route.ts
src/app/api/markets/sync/route.ts
src/app/api/strategy/route.ts
src/app/api/paper-bets/route.ts
```

## UI

```txt
src/app/page.tsx
src/components/trading/StrategyHub.tsx
src/components/trading/PipelineSettings.tsx
src/components/trading/SimulationLab.tsx
src/components/trading/MarketTriage.tsx
src/components/trading/LiveStatus.tsx
```

## New modules needed

```txt
src/lib/engine/market-loop.ts
src/lib/engine/candidate-scoring.ts
src/lib/engine/candidate-dedupe.ts
src/lib/engine/paper-execution.ts
src/lib/engine/order-tracker.ts
src/lib/venues/types.ts
```

---

# 23. Priority order

## Priority 1 — stop fake repeated markets

```txt
Rename current live simulation to DEMO mode.
Make PAPER mode use real scanner only.
Prevent MARKET_TEMPLATES from running in PAPER/LIVE.
```

## Priority 2 — fix database/schema

```txt
Add missing PaperBet table.
Add compound unique venue + externalId.
Add ScanRun.
Add CandidateRun.
Add lastSeenAt fields.
Add watchlist table.
```

## Priority 3 — make scanner real

```txt
Pagination for Polymarket.
Pagination for Kalshi.
Real snapshots.
Market upsert.
Status refresh.
ScanRun logs.
```

## Priority 4 — add candidate scoring/dedupe

```txt
Score every market before research.
Cooldown repeated markets.
Prevent duplicate candidate creation.
Do not research same market repeatedly.
```

## Priority 5 — fix risk/order logic

```txt
Fix pos.amount bug.
Fix WATCH creating orders.
Fix zero-size fallback bug.
Use strategy settings in risk.
Separate paper execution from decision.
```

## Priority 6 — make worker continuous

```txt
Recurring scan loop.
Retry RETRYING jobs.
Queue downstream jobs.
Clear stale locks.
Track failed jobs properly.
```

## Priority 7 — improve UI observability

```txt
Show mode.
Show scan runs.
Show snapshot age.
Show candidate score.
Show cooldown.
Show source mode.
Show order lifecycle.
```

---

# Final summary

The main gaps in the uploaded prediction-market app are:

```txt
1. Dry-run is actually demo simulation.
2. Real scanner is not connected to live/paper loop.
3. Worker is not a continuous trading lifecycle.
4. Venue scanning fetches only first 100 markets.
5. No pagination/cursor support.
6. Weak deduplication.
7. No candidate scoring before research.
8. No cooldown, so same markets repeat.
9. Risk exposure uses wrong fields.
10. WATCH incorrectly creates orders/positions.
11. Paper execution instantly fills fake orders.
12. Live mode is frontend-only.
13. Prisma schema and bundled DB are out of sync.
14. Resolution logic cannot handle fake external IDs.
15. Research pipeline can stop early or get stuck.
16. UI does not show freshness/source/cooldown clearly.
```

The fix should not be “patch one repeated-title bug.” The real fix is to convert the app into a proper:

```txt
Real-data paper trading engine
```

with:

```txt
DEMO separated
PAPER using real Polymarket/Kalshi data
LIVE blocked until safe
continuous scanner
candidate scoring
dedupe/cooldown
stage-based worker
paper order tracker
correct risk engine
```
No — **you are not fully utilizing TauricResearch/TradingAgents**.

You have it installed and wrapped, but your app is using only a **small/partial layer** of its power. In the main app pipeline, you are mostly using your own lightweight `/analyze/all` FastAPI endpoint, not the full native TradingAgents multi-agent graph.

My estimate:

```txt id="qtumdf"
TradingAgents power available: 100%
Your current real usage in app pipeline: ~25%–35%
```

---

# What TradingAgents can actually do

The official TradingAgents repo is a **multi-agent financial trading framework** with:

```txt id="t30l6c"
Fundamentals Analyst
Sentiment Analyst
News Analyst
Technical Analyst
Bull Researcher
Bear Researcher
Trader Agent
Risk Management Team
Portfolio Manager
Decision log memory
Checkpoint resume
Multi-provider LLM support
Structured output agents
Debate rounds
Saved reports
```

The official README says TradingAgents mirrors real trading-firm dynamics using analysts, trader, risk-management team, and dynamic discussions for strategy decisions. It includes analyst roles for fundamentals, sentiment, news, and technical analysis, plus bull/bear researchers, trader, risk management, and portfolio manager. ([GitHub][1])

Recent versions also added important features like grounded sentiment, `TRADINGAGENTS_*` env configurability, remote Ollama, multi-provider support, decision logs, checkpoint resume, and structured-output decision agents. ([GitHub][2])

---

# What your uploaded app currently does

Your app has this wrapper:

```txt id="dttf6d"
ta-service/server.py
```

It installs TradingAgents and exposes:

```txt id="zc3fqr"
GET  /health
GET  /models
POST /analyze
POST /analyze/all
POST /analyze/news
POST /analyze/sentiment
POST /analyze/technical
POST /analyze/reddit
POST /analyze/x
```

But the important issue is this:

```txt id="yrmdpr"
/analyze uses TradingAgentsGraph.propagate()
/analyze/all does NOT use TradingAgentsGraph.propagate()
```

And your main TypeScript integration mostly calls:

```txt id="6kcksl"
runTradingAgentsSimple()
→ POST /analyze/all
```

So the main pipeline is **not truly running full TradingAgents**.

It is running your own custom parallel prompts:

```txt id="izjqzd"
news LLM prompt
sentiment LLM prompt
technical LLM prompt
Reddit fetch
X/SearXNG fetch
```

That is useful, but it is **not the full TradingAgents framework**.

---

# Biggest gap

## Your main app calls `/analyze/all`, not `/analyze`

Current main path:

```txt id="7h3r40"
src/lib/engine/research/full-research.ts
→ runTradingAgentsSimple()
→ src/lib/engine/research/tradingagents-api.ts
→ POST /analyze/all
```

But `/analyze/all` in `ta-service/server.py` does not run:

```txt id="qv6t0h"
TradingAgentsGraph()
ta.propagate()
```

So you miss:

```txt id="ncck0a"
native TradingAgents analyst graph
bull/bear debate
trader agent
risk-management team
portfolio manager
native decision structure
memory log
checkpoint resume
saved full reports
```

That is the main reason I say you are not fully using it.

---

# What you are using

You are using:

```txt id="uzpevn"
1. TradingAgents package installed in ta-service
2. FastAPI wrapper around it
3. Basic model/provider passing
4. Some custom news/sentiment/technical prompts
5. Reddit fetching
6. X/Twitter search through SearXNG
7. Agent-Reach enrichment
8. Optional finance enrichment
9. Basic health/model endpoint
10. Some app-side source saving
```

Good start.

But this is more like:

```txt id="nznxc4"
TradingAgents-inspired analyst service
```

Not:

```txt id="m0guc4"
Full TradingAgents-powered research/risk/portfolio engine
```

---

# What you are missing

## 1. Native full TradingAgents graph in main pipeline

You should make FULL research call:

```txt id="7odxsq"
POST /analyze
```

not only:

```txt id="92f779"
POST /analyze/all
```

Because `/analyze` is the endpoint that runs:

```txt id="1hcfey"
TradingAgentsGraph(...)
ta.propagate(ticker, date)
```

TradingAgents’ documented Python usage is exactly this pattern: initialize `TradingAgentsGraph`, then call `.propagate(ticker, date)` to get a decision. ([GitHub][1])

---

## 2. Your ticker extraction is too weak

Prediction markets are not always stock tickers.

Current `extract_ticker()` maps things like:

```txt id="um87ce"
Bitcoin → BTC
Ethereum → ETH
NBA → SPY
Senate → SPY
Election → SPY
Oscar → MKT
```

This is not enough.

For Polymarket/Kalshi, you need a proper adapter:

```txt id="0ycw9k"
market title
resolution criteria
category
underlying asset/topic
related tickers
related macro indicators
related news queries
settlement date
```

Example:

```txt id="95r3n3"
Will Bitcoin exceed $100,000 by end of 2026?
→ ticker: BTC
→ benchmark: BTC/USD
→ data: BTC price, ETF flows, macro liquidity, rates, crypto news
```

But:

```txt id="x33gqq"
Will a sitting US Senator switch parties in 2026?
→ no stock ticker
→ needs political/news/event research, not TradingAgents stock graph
```

So not every market should go to native TradingAgents. You need routing.

---

## 3. You are not using the bull/bear debate properly

TradingAgents includes bullish and bearish researchers that debate the analyst team’s insights. ([GitHub][1])

Your app has its own debate arena, but the TradingAgents output used in `/analyze/all` does not include the native TradingAgents debate.

Missing:

```txt id="0ukr35"
bull researcher output
bear researcher output
research manager conclusion
debate transcript
debate rounds
final trade thesis
```

---

## 4. You are not using TradingAgents risk/portfolio manager

TradingAgents has risk-management and portfolio-manager roles; the portfolio manager approves/rejects transactions after risk assessment. ([GitHub][1])

Your app uses its own deterministic risk engine, which is good, but you should still capture TradingAgents’ risk/portfolio opinion as **one advisory input**.

Correct design:

```txt id="5pi2ca"
TradingAgents Portfolio Manager opinion
        ↓
Your deterministic risk engine final gate
```

Never let TradingAgents directly execute trades.

---

## 5. You are not using persistent decision log memory

TradingAgents has a persistent decision log: completed runs append decisions to `~/.tradingagents/memory/trading_memory.md`, and future runs can use prior same-ticker decisions and cross-ticker lessons. ([GitHub][1])

Your app has Qdrant and DB memory ideas, but it is not clearly feeding resolved prediction-market outcomes back into TradingAgents’ own memory.

Missing:

```txt id="xjplm8"
past decision
market price at decision
final outcome
Brier score
alpha vs market
reflection
lesson learned
future prompt injection
```

---

## 6. You are not using checkpoint resume

TradingAgents supports LangGraph checkpoint resume so a crashed/interrupted run can continue from the last successful node. ([GitHub][1])

Your app currently can get stuck in `RESEARCHING`, and failed jobs can remain broken. TradingAgents checkpointing could help for long research runs.

Missing:

```txt id="kzrn2f"
checkpoint_enabled = true
per-market checkpoint path
resume failed TradingAgents run
clear checkpoint on completion
```

---

## 7. Your `/models` endpoint is too simple

Official TradingAgents supports many providers:

```txt id="sn0l01"
OpenAI
Google/Gemini
Anthropic/Claude
xAI/Grok
DeepSeek
Qwen
GLM
MiniMax
OpenRouter
Ollama
Azure
```

The README lists multi-provider support and configurable `llm_provider`, `deep_think_llm`, and `quick_think_llm`. ([GitHub][1])

Your `/models` endpoint mostly calls your OpenAI-compatible `/models` and returns model IDs. It does not fully expose:

```txt id="76e7yl"
provider capabilities
structured-output support
deep/quick model compatibility
region support
context size
local/remote Ollama endpoint
default recommended model per role
```

---

## 8. Your `TA_MAX_DEBATE_ROUNDS` env is not fully used

In Docker Compose you set:

```txt id="yl2o12"
TA_MAX_DEBATE_ROUNDS
```

But in `server.py`, `/analyze` only applies `max_debate_rounds` when it comes from the request. It does not clearly read `TA_MAX_DEBATE_ROUNDS`.

Also `/analyze/all` does not use native debate rounds anyway.

---

## 9. You are not using saved TradingAgents reports fully

Official TradingAgents can save reports and decision logs. Recent changelog notes report saving fixes and structured reports. ([GitHub][2])

Your wrapper sets:

```txt id="9dd6bb"
config["results_dir"] = /app/data/logs
```

But the Next.js app is not fully ingesting the saved markdown reports:

```txt id="s7i5um"
analyst reports
debate transcripts
trader report
portfolio manager report
final decision
complete_report.md
```

You should import those into `AgentOutput` / `ResearchSource`.

---

# What to change

## Replace current TradingAgents usage levels

Use 3 levels:

```txt id="54xnmk"
Level 1: Lightweight TA-inspired prompts
Level 2: Full native TradingAgentsGraph
Level 3: Full native TradingAgentsGraph + memory + checkpoint + saved reports
```

### QUICK research

Use your current `/analyze/all`.

Good for cheap screening.

```txt id="nctgia"
news prompt
sentiment prompt
technical prompt
reddit/x
```

### STANDARD research

Use `/analyze` with native TradingAgentsGraph, but with low debate rounds.

```txt id="xrpjk0"
TradingAgentsGraph.propagate()
max_debate_rounds = 1
quick + deep model split
```

### DEEP research

Use full native TradingAgents:

```txt id="v389ba"
TradingAgentsGraph.propagate()
max_debate_rounds = 2–4
checkpoint enabled
decision log enabled
saved reports imported
portfolio/risk manager captured
```

---

# Best architecture for your app

```txt id="x9trc2"
Prediction Market Candidate
    ↓
Market-to-TA Adapter
    ↓
Decide if TA is applicable
    ↓
TradingAgents Native Run
    ↓
Extract:
  analyst reports
  bull/bear debate
  trader decision
  risk/portfolio opinion
  confidence
  thesis
    ↓
Your Probability Judge
    ↓
Your Deterministic Risk Engine
    ↓
Paper order / Watch / Skip
```

---

# Required new module

Create:

```txt id="75pe4v"
src/lib/engine/research/tradingagents-native.ts
```

Responsibilities:

```txt id="ea2q1r"
call /analyze, not /analyze/all
pass provider/model/debate/checkpoint settings
parse decision
parse saved reports
return structured analyst/debate/risk/portfolio output
```

---

# Required ta-service update

Update `ta-service/server.py`:

```txt id="fo4l57"
1. Add /analyze/native endpoint.
2. Use TradingAgentsGraph.propagate().
3. Enable checkpoint config.
4. Enable memory log path.
5. Use TA_MAX_DEBATE_ROUNDS env fallback.
6. Return structured sections.
7. Return saved report paths/content.
8. Return raw decision object, not only str(decision).
```

Current `/analyze` returns mostly:

```txt id="2u6e4e"
decision = str(decision)
sentiment_report = social_context
raw_output = ticker + decision + enrichment
```

Better response:

```json id="o1rghk"
{
  "status": "completed",
  "ticker": "BTC",
  "decision": {
    "rating": "Buy/Hold/Sell",
    "confidence": 0.72,
    "thesis": "...",
    "risks": [...]
  },
  "reports": {
    "fundamentals": "...",
    "sentiment": "...",
    "news": "...",
    "technical": "...",
    "bullResearcher": "...",
    "bearResearcher": "...",
    "trader": "...",
    "riskManager": "...",
    "portfolioManager": "..."
  },
  "memory": {
    "usedPastDecisions": true,
    "logPath": "..."
  },
  "checkpoint": {
    "enabled": true,
    "resumed": false
  }
}
```

---

# Important: TradingAgents is stock/ticker-first

TradingAgents was designed around tickers like:

```txt id="0mj4wn"
NVDA
AAPL
TSLA
BTC
ETH
SPY
```

The README example uses `.propagate("NVDA", "2026-01-15")`. ([GitHub][1])

Prediction markets are event-based, so use TradingAgents only when the market has a strong financial/ticker object.

Good TradingAgents fit:

```txt id="t3yzbl"
Bitcoin price markets
Ethereum upgrade markets
Tesla/Nvidia/Apple stock markets
Fed rate / SPY / macro markets
Oil/gold/commodity markets
```

Weak TradingAgents fit:

```txt id="pwwlft"
Oscar AI-generated film
NBA score event
Senator switching party
weather/climate event
random political resolution event
```

For weak-fit markets, use:

```txt id="je1q6w"
DeerFlow
SearXNG
Firecrawl
Agent-Reach
custom probability judge
```

---

# Final verdict

You are **not fully utilizing TradingAgents**.

Current usage:

```txt id="g9gyq8"
Installed: yes
Health/model wrapper: yes
Custom TA-like analysts: yes
Native TradingAgentsGraph in main pipeline: mostly no
Bull/bear debate: mostly no
Risk/portfolio manager: mostly no
Decision log memory: no
Checkpoint resume: no
Saved reports ingestion: no
Provider capability management: partial
Prediction-market adaptation: weak
```

Best next fix:

```txt id="b87ci8"
Keep /analyze/all for quick cheap analysis.
Add /analyze/native for real TradingAgentsGraph.
Route only financially-linked prediction markets to native TradingAgents.
Import full reports, debate, risk, portfolio, memory, and checkpoint metadata into your app.
```

That will move you from:

```txt id="iy79uw"
TradingAgents wrapper
```

to:

```txt id="9mbdoc"
TradingAgents-powered prediction-market research engine
```

[1]: https://github.com/TauricResearch/TradingAgents "GitHub - TauricResearch/TradingAgents: TradingAgents: Multi-Agents LLM Financial Trading Framework · GitHub"
[2]: https://github.com/TauricResearch/TradingAgents/blob/main/CHANGELOG.md "TradingAgents/CHANGELOG.md at main · TauricResearch/TradingAgents · GitHub"
