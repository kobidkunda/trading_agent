# Refined Implementation Plan — Prediction Market Alpha Engine

> Addresses all 27 gaps from the gap analysis. Agent-buildable, exact contracts, verifiable.

---

## Stack Decision

**Decision: Stay with current stack — Next.js API routes + Prisma + SQLite.**

Reason: Prisma schema already has 38 models including Wallet, EnsemblePrediction, CorrelationCluster, OracleCheck, CausalTreeNode, RelatedMarket, BacktestRun, StrategyConfigVersion, OrderbookSnapshot, etc. DB schema is ahead of codebase. Migrating to FastAPI+Postgres would waste months of schema work. SQLite handles 100K+ rows fine for single-operator use.

Migration to Postgres deferred until: 100K+ markets, multi-operator usage, or 100+ concurrent bets.

---

## MVP Boundary (Release 1 Only)

```
PAPER mode only — real Polymarket/Kalshi data, simulated orders.
No LIVE execution. No wallet tracking. No ensemble models.
No causal trees. No backtest/optimizer. No related-market scanner.

MVP SCOPE:
  ✓ Real Polymarket/Kalshi scanner with pagination
  ✓ Market deduplication (venue+externalId)
  ✓ Candidate scoring engine
  ✓ A+ Signal Gate with hard thresholds
  ✓ Realistic paper order lifecycle (ORDERBOOK_DEPTH_AWARE)
  ✓ Paper position tracking with PnL
  ✓ Brier score + ROI dashboard
  ✓ DEMO/PAPER mode strict separation
  ✓ Demo data migration (mark existing fake as DEMO)
```

Releases 2-6 come AFTER Release 1 is verified working.

---

## Release Roadmap

| Release | Scope | Gate Before Next |
|---------|-------|------------------|
| R1: Trustworthy PAPER | Real scanner + dedupe + A+ gate + paper execution + Brier/ROI dashboard | 200+ paper bets, positive A+ ROI, acceptable Brier |
| R2: Scoring & A+ Gate | Wang correction + ensemble probability + 3-tier research | Calibration data collected, ensemble outperforms single |
| R3: Calibration + Backfill | Historical backfill + calibration dashboard + postmortems | 500+ resolved markets, calibration chart clean |
| R4: Wallet Intelligence | Wallet tracker + anti-survivorship + cluster signals + related-market | Wallet signals paper-positive for 2-4 weeks |
| R5: Backtest + Optimizer | Walk-forward validation + strategy optimizer + config versioning | Strategy proven out-of-sample |
| R6: Tiny Live Mode | Manual approval + kill switch + audit logs + tiny execution | 500+ paper bets, positive A+ ROI, all safety gates |

---

## R1: Trustworthy PAPER Mode — Detailed Specification

### R1.1 — Venue Adapter Contracts

#### Polymarket Adapter (`src/lib/venues/polymarket.ts`)

```typescript
interface PolymarketAdapter {
  // Gamma Markets API
  listActiveMarkets(params: {
    limit: number;       // max 500
    next_cursor?: string;
    active?: boolean;    // default true
    closed?: boolean;    // default false
    order?: string;       // "volume24hr", "liquidity", "createdAt"
  }): Promise<{
    markets: PolymarketMarket[];
    next_cursor: string | null;
  }>;

  // CLOB API — orderbook
  getOrderbook(tokenId: string): Promise<{
    bids: Array<{ price: number; size: number }>;
    asks: Array<{ price: number; size: number }>;
    last_updated: number;
  }>;

  // Gamma — resolved markets
  getResolvedMarkets(params: {
    limit: number;
    next_cursor?: string;
  }): Promise<{
    markets: PolymarketMarket[];
    next_cursor: string | null;
  }>;

  // Normalize
  normalizeMarket(raw: PolymarketMarket): NormalizedMarket;
  normalizeOrderbook(raw: PolymarketOrderbook): NormalizedOrderbook;
}
```

Endpoints:
- Markets: `GET https://gamma-api.polymarket.com/markets?limit=500&active=true&closed=false&next_cursor=...`
- Orderbook: `GET https://clob.polymarket.com/book?token_id={tokenId}`
- Resolved: `GET https://gamma-api.polymarket.com/markets?limit=500&closed=true&next_cursor=...`

Rate limits: 10 req/s for Gamma, 2 req/s for CLOB. Implement exponential backoff (1s, 2s, 4s, 8s, max 60s).

#### Kalshi Adapter (`src/lib/venues/kalshi.ts`)

```typescript
interface KalshiAdapter {
  listActiveMarkets(params: {
    limit: number;       // max 100
    cursor?: string;
    status?: string;     // "open", "closed"
  }): Promise<{
    markets: KalshiMarket[];
    cursor: string | null;
  }>;

  getOrderbook(ticker: string): Promise<{
    yes_bid: number;
    yes_ask: number;
    no_bid: number;
    no_ask: number;
    last_updated: string;
  }>;

  getSettledMarkets(params: {
    limit: number;
    cursor?: string;
  }): Promise<{
    markets: KalshiMarket[];
    cursor: string | null;
  }>;

  normalizeMarket(raw: KalshiMarket): NormalizedMarket;
  normalizeOrderbook(raw: KalshiOrderbook): NormalizedOrderbook;
}
```

Endpoints:
- Markets: `GET https://trading-api.kalshi.com/trade-api/v2/markets?limit=100&status=open&cursor=...`
- Orderbook: `GET https://trading-api.kalshi.com/trade-api/v2/markets/{ticker}/orderbook`
- Settled: `GET https://trading-api.kalshi.com/trade-api/v2/markets?limit=100&status=closed&cursor=...`

Auth: RSA key-based. Stored in Credential table with `service='kalshi'`.

#### Normalized Market Contract

```typescript
interface NormalizedMarket {
  externalId: string;
  venue: 'POLYMARKET' | 'KALSHI';
  title: string;
  normalizedTitle: string;
  titleHash: string;
  description: string | null;
  category: string;
  status: 'ACTIVE' | 'CLOSED' | 'RESOLVED';
  resolutionTime: Date | null;
  outcomes: string[];         // ["Yes", "No"] or custom
  outcomePrices: number[];    // [0.57, 0.43] or custom
  volume24h: number;
  liquidity: number;
  yesPrice: number | null;
  noPrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  rawJson: string;            // full raw response for debugging
}
```

Scan frequency: Every 5 minutes for active markets, every 15 minutes for orderbook depth.

---

### R1.2 — Demo Data Migration

**Step 1: Add `mode` column to existing Market records**

```sql
-- Mark all existing markets with fake externalIds as DEMO
UPDATE Market SET mode = 'DEMO' WHERE externalId LIKE 'live_%' OR externalId LIKE 'demo_%';

-- Set remaining to PAPER (they should have real venue externalIds)
UPDATE Market SET mode = 'PAPER' WHERE mode IS NULL OR mode = '';

-- Future: LIVE mode when connector exists
```

**Step 2: Add `mode` field to Market model**

```prisma
model Market {
  // ... existing fields ...
  mode TradingMode @default(PAPER)
  // ... existing fields ...
}
```

**Step 3: Filter by mode in API routes**

All API routes (`/api/markets`, `/api/decisions`, `/api/research`, `/api/simulation`) must accept `?mode=PAPER` parameter and default to PAPER (never return DEMO unless explicitly requested).

**Step 4: Prevent DEMO from entering PAPER pipeline**

```typescript
// In scanner.ts:
if (market.mode === 'DEMO') return; // skip demo markets
// In candidate scoring:
if (candidate.market.mode !== 'PAPER') return;
// In resolution poller:
if (market.mode === 'DEMO') return; // never resolve fake markets
```

**Verification**: `SELECT COUNT(*) FROM Market WHERE mode='DEMO' AND dataSource='REAL'` must return 0.

---

### R1.3 — Paper Execution Rules

#### Fill Models (Exact Logic)

| Model | Use | Fill Rule |
|-------|-----|-----------|
| `INSTANT_DEMO` | DEMO mode only | Always fills at market price instantly |
| `BID_ASK_AWARE` | Quick testing | Fills if our price crosses spread |
| `ORDERBOOK_DEPTH_AWARE` | **PAPER mode (R1)** | Uses orderbook depth to simulate fills |
| `STRICT_NO_FILL_UNLESS_CROSSED` | Future live parity | Only fills if bid crosses ask |

#### ORDERBOOK_DEPTH_AWARE Implementation

```typescript
function simulatePaperFill(
  order: { side: 'YES' | 'NO'; price: number; size: number },
  orderbook: { bids: PriceLevel[]; asks: PriceLevel[] },
  config: { maxSlippage: number; minFillPct: number; expirySec: number }
): FillResult {
  // 1. Check orderbook freshness — reject if > 60s old
  // 2. For BUY/YES: walk ask side, fill up to size until price > order.price + slippage
  // 3. For BUY/NO: walk bid side inversely
  // 4. Return: { filledSize, avgFillPrice, spreadCost, slippageCost, fillPct, status }
  // 5. Partial fill: if < minFillPct of size filled after walking full book, mark PARTIALLY_FILLED
  // 6. No fill: if no resting orders at our price, mark SUBMITTED (unfilled)
  // 7. Expiry: if order age > expirySec and not filled, mark EXPIRED
}

interface FillResult {
  filledSize: number;
  avgFillPrice: number | null;
  spreadCost: number;      // (ask-bid)/2 * filledSize
  slippageCost: number;    // price impact from walking book
  fillPct: number;         // 0.0 to 1.0
  status: 'FILLED' | 'PARTIALLY_FILLED' | 'UNFILLED' | 'EXPIRED';
  reason?: string;
}
```

#### Paper Order Lifecycle

```
PLANNED → SUBMITTED → PARTIALLY_FILLED → FILLED
                   → UNFILLED → EXPIRED
                   → CANCELLED
```

Transitions:
- `PLANNED`: Created by risk engine after A+ gate approval
- `SUBMITTED`: Order published to paper orderbook (timestamp recorded)
- `PARTIALLY_FILLED`: Some size filled, remaining queued
- `FILLED`: All size filled → create Position record
- `EXPIRED`: Past expiry time, unfilled portion lost
- `CANCELLED`: Manual cancel or risk rule triggered

#### Position Opening Rules

- Position opens ONLY after FILLED status (not on SUBMITTED)
- Entry price = avgFillPrice from fills
- PnL calculated only on FILLED portions
- WATCH orders create Watchlist entries, NEVER orders

#### Default Paper Config

```typescript
const PAPER_EXECUTION_DEFAULTS = {
  maxSlippageBps: 50,       // 0.5%
  minFillPct: 0.80,         // Must fill at least 80% to avoid partial
  expirySec: 300,           // 5 minutes
  orderbookMaxAgeSec: 60,   // Orderbook older than 60s = stale
  minLiquidityPerBet: 500, // $500
  spreadCostBps: 10,        // 0.1% spread cost assumption
};
```

---

### R1.4 — A+ Signal Gate Thresholds

#### Hard Pass/Fail Rules (R1)

| Criterion | Threshold | Category-Specific Adjustments | Fail Reason Code |
|-----------|-----------|-------------------------------|------------------|
| `candidateScore` | >= 90 | None | `SCORE_TOO_LOW` |
| `adjustedEdge` | >= 6% | Politics: 8%, Crypto: 10% | `EDGE_TOO_LOW` |
| `confidence` | >= 75% | None | `CONFIDENCE_TOO_LOW` |
| `resolutionClarity` | >= 85% | None | `RESOLUTION_UNCLEAR` |
| `spread` | <= 4% | Politics: 3%, Crypto: 5% | `SPREAD_TOO_WIDE` |
| `liquidity` | >= $1,000 | Politics: $2,000, Crypto: $3,000 | `LIQUIDITY_TOO_LOW` |
| `modelDisagreement` | <= 25% | None (R1: single model) | `MODEL_DISAGREEMENT` |
| `tailRisk` | <= 15% max loss of stake | None | `TAIL_RISK_HIGH` |
| `correlationExposure` | <= configured limit | Same-event: $2K, Same-category: $5K | `CORRELATION_EXPOSED` |
| `orderbookQuality` | >= 60% | Fill probability >= 60% | `ORDERBOOK_POOR` |
| `duplicateStatus` | None | Must not be duplicate or on cooldown | `DUPLICATE_OR_COOLDOWN` |
| `oracleRisk` | Not BLOCK | Must not have blocked oracle risk | `ORACLE_RISK_BLOCK` |

#### Category-Specific Defaults

```typescript
const CATEGORY_THRESHOLDS = {
  politics:     { minLiq: 2000, maxSpread: 3, minEdge: 8 },
  sports:       { minLiq: 1500, maxSpread: 4, minEdge: 6 },
  crypto:       { minLiq: 3000, maxSpread: 5, minEdge: 10 },
  science:      { minLiq: 1000, maxSpread: 4, minEdge: 6 },
  entertainment:{ minLiq: 1000, maxSpread: 4, minEdge: 7 },
  economics:    { minLiq: 2000, maxSpread: 3, minEdge: 8 },
  default:      { minLiq: 1000, maxSpread: 4, minEdge: 6 },
};
```

#### A+ Gate Implementation (`src/lib/engine/aplus-gate.ts`)

```typescript
function evaluateAPlusGate(
  candidate: TradeCandidate,
  market: Market,
  snapshot: MarketSnapshot,
  config: APLusConfig
): APLusResult {
  const checks: GateCheck[] = [
    { name: 'candidateScore', passed: candidate.candidateScore >= config.minScore, value: candidate.candidateScore, threshold: config.minScore },
    { name: 'adjustedEdge', passed: candidate.adjustedEdge >= config.minEdge, value: candidate.adjustedEdge, threshold: config.minEdge },
    { name: 'confidence', passed: candidate.confidence >= config.minConfidence, value: candidate.confidence, threshold: config.minConfidence },
    { name: 'resolutionClarity', passed: candidate.resolutionClarity >= config.minResolutionClarity, value: candidate.resolutionClarity, threshold: config.minResolutionClarity },
    { name: 'spread', passed: snapshot.spread <= config.maxSpread, value: snapshot.spread, threshold: config.maxSpread },
    { name: 'liquidity', passed: snapshot.liquidity >= config.minLiquidity, value: snapshot.liquidity, threshold: config.minLiquidity },
    // ... all 12 checks
  ];

  const passed = checks.filter(c => c.passed);
  const failed = checks.filter(c => !c.passed);

  return {
    isAPlus: failed.length === 0,
    passedCriteria: passed,
    rejectedCriteria: failed,
    acceptedCriteriaJson: JSON.stringify(passed.map(c => c.name)),
    rejectedCriteriaJson: JSON.stringify(failed.map(c => ({ name: c.name, value: c.value, threshold: c.threshold }))),
  };
}
```

---

### R1.5 — Market Loop (Continuous Scanner)

```
Every 5 minutes:
  1. Check mode === PAPER
  2. Scan Polymarket (paginated, cursor-based)
  3. Scan Kalshi (paginated, cursor-based)
  4. For each market:
    a. Upsert by venue+externalId
    b. Create MarketSnapshot
    c. Update Market.lastSeenAt, lastSnapshotAt, latestPrice, latestSpread, latestLiquidity
  5. Create ScanRun record with metrics
  6. Score all new/updated candidates
  7. For candidates with score >= 70:
    a. Create TRIAGE job
  8. Log scan completion
```

Job types created automatically by market loop:

```
SCAN_VENUE → UPSERT_MARKETS → SCORE_CANDIDATES → TRIAGE_MARKET (auto) → RESEARCH_MARKET (score >= 85) → JUDGE_MARKET → A+_GATE → PAPER_EXECUTE (if A+) → RESOLUTION_CHECK
```

---

### R1.6 — Brier Score & ROI Dashboard

#### Brier Score Calculation

```typescript
function calculateBrierScore(predictions: PaperBet[]): number {
  const resolved = predictions.filter(p => p.actualOutcome !== null);
  if (resolved.length === 0) return 0;
  
  const sum = resolved.reduce((acc, bet) => {
    const actual = bet.actualOutcome === 'YES' ? 1 : bet.actualOutcome === 'NO' ? 0 : null;
    if (actual === null) return acc;
    return acc + Math.pow(bet.predictedProb - actual, 2);
  }, 0);
  
  return sum / resolved.length;
}

function calculateRollingBrier(predictions: PaperBet[], window: number = 50): number[] {
  // Return rolling window Brier scores
}

function calculateROI(predictions: PaperBet[]): number {
  const totalStake = predictions.reduce((s, b) => s + (b.stake || 0), 0);
  const totalPnl = predictions.reduce((s, b) => s + (b.pnl || 0), 0);
  return totalStake > 0 ? (totalPnl / totalStake) * 100 : 0;
}
```

#### Dashboard Metrics

```
Calibration Page shows:
  - Overall Brier score
  - Rolling 50-bet Brier
  - Rolling 100-bet Brier
  - A+ bucket win rate
  - A+ bucket ROI
  - Category-wise Brier (politics, sports, crypto, science)
  - Calibration chart (predicted prob buckets 50-60%, 60-70%, 70-80%, 80-90%, 90-100%)
  - PnL chart (cumulative paper PnL over time)
  - Bet count and sample size warning if < 50 bets
```

---

### R1.7 — Explanation Layer

Every decision (SKIP, WATCH, RESEARCH, A+, RISK_BLOCK, EXECUTE) must produce:

```typescript
interface DecisionExplanation {
  decision: 'SKIP' | 'WATCH' | 'RESEARCH' | 'A_PLUS' | 'BUY' | 'RISK_BLOCKED';
  marketTitle: string;
  venue: string;
  category: string;
  
  // Scoring
  candidateScore: number;
  scoreBreakdown: Record<string, number>;  // e.g. { liquidityScore: 25, spreadScore: 20, ... }
  
  // A+ Gate
  passedCriteria: string[];
  rejectedCriteria: Array<{ name: string; value: number; threshold: number }>;
  
  // Probability
  marketPrice: number;
  ourProbability: number;
  rawEdge: number;
  adjustedEdge: number;
  
  // Risk
  maxStake: number;
  tailRiskScore: number;
  correlationExposure: number;
  
  // Timing
  nextEligibleAt: Date | null;
  cooldownReason: string | null;
  
  // Summary
  summaryText: string;  // Human-readable one-liner
}
```

---

## R1 Acceptance Criteria (Definition of Done)

```
✓ PAPER mode scans real Polymarket/Kalshi data every 5 minutes
✓ Market deduplication by venue+externalId works (duplicate rate < 1%)
✓ Market freshness visible (lastSeenAt, snapshotAge)
✓ Candidate score shows for every market with full breakdown
✓ A+ gate evaluates all 12 criteria, stores accepted/rejected
✓ Paper orders follow ORDERBOOK_DEPTH_AWARE fill model
✓ Paper orders have full lifecycle (PLANNED → SUBMITTED → FILLED/EXPIRED/CANCELLED)
✓ Paper PnL includes spread cost, slippage, and fees
✓ WATCH never creates an order
✓ Brier score calculates correctly after market resolution
✓ ROI tracks paper PnL vs total stake
✓ Zero DEMO rows appear in PAPER dashboard
✓ Every decision has an explanation (why skipped, why A+, why risk blocked)
✓ Dashboard clearly shows mode, data source, and execution mode
```

---

## E2E Test Matrix (R1)

| Test Case | Input | Expected Output | Verification |
|-----------|-------|----------------|--------------|
| Real scan creates markets | Run scan against real Polymarket | Markets created with REAL dataSource, venue=POLYMARKET | Check DB: count > 0, externalId not starting with 'live_' |
| Duplicate market not recreated | Run scan twice | Second scan updates existing market, no new row | DB: same venue+externalId has 2 snapshots, 1 market row |
| DEMO mode never pollutes PAPER | Set mode=DEMO, run scan | Fake markets created with mode=DEMO | Switch to PAPER, verify DEMO markets filtered out |
| WATCH never creates order | Candidate score 50-69, decision=WATCH | Watchlist entry created, zero Order rows | DB: Watchlist has entry, Order count unchanged |
| A+ creates paper order | Score 90+, all gates pass | Decision=BUY, Order created with lifecycleStatus=PLANNED | DB: Order row exists, PaperBet row exists |
| A+ blocked by spread | Score 90+, spread=8% | Decision=SKIP, rejectedCriteria includes SPREAD_TOO_WIDE | DB: Decision row with reason, no Order |
| Paper fill respects orderbook | Order submitted, orderbook has depth | Fill partial or full based on depth | DB: Fill rows match orderbook depth |
| Expired order marked correctly | Order age > expirySec, unfilled | lifecycleStatus=EXPIRED | DB: Order status updated |
| Brier calculates after resolution | PaperBet with predictedProb=0.80, actualOutcome=YES | brierScore = (0.80-1)^2 = 0.04 | API: GET /api/paper-bets?id=X, check brierScore |
| Failed job retries | Job fails with error | Status becomes RETRYING, worker picks up | DB: Job status flow PENDING → RUNNING → FAILED → RETRYING → RUNNING |
| Stale lock releases | Job stuck in RUNNING for > maxRuntimeSec | Status becomes STALE_LOCK_RELEASED | DB: Job status updated, new job created |

---

## Security Plan (R1 Minimally)

R1 is single-operator, local/self-hosted. Minimal security:

```
- API routes: No auth required (localhost-only deployment)
- Credential encryption: Existing Credential.encryptedData field (AES-256-GCM with key from env)
- Kill switch: Global kill switch in Settings table (key="killSwitch", value="true"/"false")
- Audit log: Existing AuditLog model — log all settings changes and mode switches
- No LIVE execution possible without safety flags
```

Auth (JWT/OAuth) deferred to R5 when multi-operator needed.

---

## Observability Plan (R1)

```
- ScanRun records: Every scan cycle logged with venue, status, markets fetched/created/updated/skipped
- Job queue depth: Visible in SystemHealth page (existing)
- Worker health: Job heartbeat field checked, stale jobs flagged
- Alert rules (stored in Settings):
  - noScanIn10Min: Alert if no ScanRun in last 10 minutes
  - marketSnapshotsStale: Alert if any market lastSnapshotAt > 60 min ago
  - researchQueueStuck: Alert if RESEARCH job count > 20 and oldest > 30 min
  - providerOffline: Alert if venue adapter returns errors for > 3 consecutive scans
```

---

## Backup Plan (R1)

```
- Daily DB backup: Cron job (or start.sh watchdog) copies db/custom.db to db/backups/custom-YYYY-MM-DD.db
- Export buttons in UI: Export strategy config, export paper results, export prompts as JSON
- Restore script: `npm run db:restore -- db/backups/custom-YYYY-MM-DD.db`
- Retention: Keep last 30 daily backups
```

---

## Cost Control (R1)

```
Settings table defaults:
  dailyResearchBudget: 50            // max deep research runs per day
  maxTokensPerMarket: 2000           // max LLM tokens per market research
  cheapModelFallback: true           // fall back to cheap model if budget exceeded
  cooldownBeforeReResearch: 6        // hours before same market can be re-researched
  maxDeepResearchPerHour: 5          // throttle deep research
  cacheResearchByMarket: true         // reuse last research if price hasn't moved > 3%
```

---

## Model Registry (Deferred to R2, but schema ready)

Schema already has `EnsemblePrediction` model. Will use in R2:

```typescript
interface ModelRegistryEntry {
  modelName: string;
  version: string;
  provider: string;           // 'openai', 'deerflow', 'tradingagents', 'statistical', 'manual'
  category: string | null;    // null = all categories
  lastBrier: number | null;
  weight: number;             // ensemble weight (0.0-1.0)
  enabled: boolean;
  fallbackPriority: number;   // lower = higher priority
}
```

---

## Calibration Data Requirements (Deferred to R3)

```
Global Wang correction: minimum 1,000 resolved markets
Category correction: minimum 200 resolved markets per category
Correction model versioned: Every recalculation gets a version
Fallback: If category sample < 200, use global correction
Recalculation trigger: Every 100 new resolutions, or weekly
```

---

## Wallet Eligibility Rules (Deferred to R4)

```
Minimum requirements for wallet to be ranked:
  resolvedTrades >= 50
  activeDays >= 30
  profitFactor > 1.2
  positiveBrier (Brier < 0.25 baseline)
  notDependentOnOneTrade (single trade < 30% of total PnL)
  categorySpecialization required (at least 60% in one category)
  recentDecay (last 30 days weighted 2x over earlier)
```

---

## File Changes for R1

### New Files
```
src/lib/engine/market-loop.ts         — Continuous scanning loop
src/lib/engine/candidate-scoring.ts   — Score calculation
src/lib/engine/aplus-gate.ts          — A+ threshold evaluation
src/lib/engine/paper-execution.ts     — Orderbook-aware fill simulation
src/lib/engine/paper-order-lifecycle.ts — Order state machine
src/lib/engine/brier-calculator.ts    — Brier/ROI metrics
src/lib/venues/types.ts               — Normalized types, contracts
src/lib/venues/venue-validator.ts     — Data validation before DB write
src/app/api/market-loop/route.ts      — Start/stop scanning loop
src/app/api/paper-bets/route.ts       — Paper bet listing with Brier
src/app/api/calibration/route.ts      — Calibration metrics
src/components/trading/CalibrationDashboard.tsx — Brier/ROI UI
src/components/trading/AplusGatePanel.tsx       — A+ criteria display
```

### Modified Files
```
prisma/schema.prisma                  — Add mode to Market, cleanup
src/lib/engine/live-simulation.ts     — Remove MARKET_TEMPLATES, route to market-loop
src/lib/engine/scanner.ts             — Pagination, cursor support, ScanRun tracking
src/lib/engine/worker.ts              — Process RETRYING, create lifecycle jobs
src/lib/engine/pipeline.ts            — Split into stage functions
src/lib/engine/risk.ts                — Add A+ gate integration
src/lib/venues/polymarket.ts          — Full adapter with pagination, orderbook
src/lib/venues/kalshi.ts              — Full adapter with pagination, orderbook
src/store/trading-store.ts            — Mode enforcement from backend
src/app/page.tsx                      — Add CalibrationDashboard page
src/components/trading/StrategyHub.tsx — Mode switch, A+ threshold config
src/components/trading/LiveStatus.tsx  — Show real pipeline status
```

### Database Changes
```
ALTER TABLE Market ADD COLUMN mode TEXT NOT NULL DEFAULT 'PAPER';
UPDATE Market SET mode = 'DEMO' WHERE externalId LIKE 'live_%' OR externalId LIKE 'demo_%';
```

---

## Implementation Order (R1 Tasks)

| # | Task | Depends On | Category+Skills | Verification |
|---|------|------------|-----------------|--------------|
| 1 | Add `mode` column to Market, migrate existing data | None | quick | LSP clean, DB query shows correct modes |
| 2 | Fix venue adapters (pagination, orderbook, resolved) | None | deep | Test scan returns 500+ Polymarket markets |
| 3 | Build market-loop.ts (continuous scanner) | 1, 2 | deep | Scan creates ScanRun, markets, snapshots |
| 4 | Build venue-validator.ts (data normalization) | 2 | quick | All normalized markets pass type checks |
| 5 | Build candidate-scoring.ts | 4 | deep | Every candidate has score with breakdown |
| 6 | Build aplus-gate.ts | 5 | deep | A+ evaluation stores accepted/rejected JSON |
| 7 | Build paper-execution.ts + paper-order-lifecycle.ts | 6 | deep | Orders follow lifecycle, fills use orderbook |
| 8 | Build brier-calculator.ts | 7 | deep | Brier math verified against known test cases |
| 9 | Update worker.ts (RETRYING, lifecycle jobs) | 3 | deep | Worker processes RETRYING, creates cascading jobs |
| 10 | Update pipeline.ts (split into stages) | 9 | deep | Each stage can retry independently |
| 11 | Build API routes (market-loop, paper-bets, calibration) | 3, 7, 8 | deep | Routes return correct data |
| 12 | Build CalibrationDashboard.tsx | 11 | visual-engineering | Brier chart renders, ROI visible |
| 13 | Build AplusGatePanel.tsx | 6 | visual-engineering | Criteria show pass/fail with values |
| 14 | Update StrategyHub.tsx (mode switch, thresholds) | 1, 6 | visual-engineering | Mode toggle works, thresholds configurable |
| 15 | Update LiveStatus.tsx (real pipeline) | 9 | visual-engineering | Shows real pipeline not mock data |
| 16 | E2E testing — all 11 test cases | 1-15 | deep | All 11 test cases pass |
| 17 | Manually verify: run real scan, check dashboard | 1-16 | deep | Real markets appear, scores show, A+ gate works |

---

## Non-R1 Items (Explicitly Deferred)

```
✗ Wallet tracking (R4)
✗ Ensemble probability (R2)
✗ Causal trees (R3)
✗ Related-market scanner (R4)
✗ Wang/bias correction (R3)
✗ Backtesting (R5)
✗ Strategy optimizer (R5)
✗ Live execution (R6)
✗ API auth/JWT (R5)
✗ Postgres migration (post-R6, if needed)
✗ DeepLOB orderbook models (post-R6)
✗ Multi-operator support (R5)
✗ Compliance dashboard (R6)
✗ Load testing (post-R1, before R2)
✗ Test fixtures (R2)
```

---

## Summary

R1 delivers a **trustworthy PAPER-mode prediction market bot** using real Polymarket/Kalshi data with realistic paper execution, strict A+ filtering, and verifiable Brier/ROI metrics. Every decision is explainable. No fake data enters the PAPER pipeline. No live money is risked.

The 17 tasks are ordered by dependency, can be parallelized within waves, and produce verifiable acceptance criteria at each step. All advanced features (wallets, ensembles, causal trees, backtesting, live mode) are deferred to future releases with explicit gates before proceeding.
