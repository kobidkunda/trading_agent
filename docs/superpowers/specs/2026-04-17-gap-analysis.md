# Trading Command Center — Gap Analysis

**Date**: 2026-04-17
**Purpose**: Identify everything needed to make this app fully runnable and production-viable.

---

## Current State Summary

The app is a **Next.js 16 SPA** with SQLite/Prisma, a full UI shell (8 pages), working credential management, and a **simulated trading pipeline**. The simulation engine generates fake market data, fake agent outputs, and fake orders — it never touches real APIs or exchanges.

**What works (real):**
- UI shell: all 8 pages render, tab navigation, dark theme
- Credential CRUD + connection testing (Qdrant, Ollama, SearXNG, Mem0, LLM)
- Prisma/SQLite read/write for all 16 models
- Risk engine (`computeRisk`) — deterministic, production-ready
- Strategy settings CRUD
- Prompt template versioning
- Audit logging on credential and strategy changes
- Qdrant collection auto-discovery + wizard (just built)
- Kalshi market fetch (real API call, but schema mismatch on snapshot fields)

**What's fake/simulated:**
- ALL agent outputs (triage, bull, bear, contradiction, judge) — hardcoded random generators
- Market scanning — picks from 20 hardcoded templates, never hits Polymarket/Kalshi live
- Research sources — fake URLs like `https://news.example.com/article/`
- Orders — recorded as FILLED instantly, never submitted to any exchange
- Positions — opened with fake P&L, never tracked against real fills
- Settlement/postmortem — completely missing
- No real LLM calls anywhere in the pipeline

---

## Critical Gaps — Bare Minimum to Run

These are the things the app MUST have to function as described in the product spec.

### 1. Real Market Scanner

**Current**: Simulation picks from 20 hardcoded templates.
**Need**:
- Polymarket scanner: hit `https://clob.polymarket.com/markets` API, normalize, store
- Kalshi scanner: already exists (`src/lib/venues/kalshi.ts`) but has **schema mismatch** — `MarketSnapshot` model uses `impliedProb`/`liquidity`/`spread` but Kalshi code writes `bid`/`ask`/`lastPrice`/`volume`/`openInterest`
- Scanner scheduler: periodic fetch (not a one-time button press)
- Remove or clearly separate simulation templates from real market data

**Fix**: Add `src/lib/venues/polymarket.ts`, fix Kalshi snapshot schema mismatch, add scanner API route that triggers real fetches.

### 2. Real LLM Agent Pipeline

**Current**: All agents are `generateXxxOutput()` functions returning random data.
**Need**:
- An LLM client that calls OpenAI/Ollama/Custom endpoint with the prompt templates from the DB
- Triage agent: takes market title/description, calls LLM with triage prompt, parses structured JSON response
- Bull/Bear/Contradiction agents: call LLM with respective prompts and research context
- Judge agent: calls LLM with bull/bear/contradiction outputs, returns structured `JudgeOutput`
- Error handling, retries, rate limiting
- Token counting and latency tracking (currently faked)

**Fix**: Create `src/lib/engine/llm-client.ts` (server-side only), and `src/lib/engine/agents/` with triage.ts, bull.ts, bear.ts, contradiction.ts, judge.ts. Each reads prompt from DB, calls LLM, parses response.

### 3. Real Research Sources (SearXNG + Firecrawl)

**Current**: Fake URLs like `https://news.example.com/article/123`.
**Need**:
- SearXNG integration: query search engine, parse results, store as `ResearchSource`
- Firecrawl/content extraction: fetch page content from URLs
- Store real source content, recency scores, quality scores

**Fix**: Create `src/lib/engine/research/search.ts` (SearXNG client) and `src/lib/engine/research/extract.ts` (content extraction). These use credentials from DB.

### 4. Job Queue Worker

**Current**: Jobs are created in the DB but never processed. No worker loop. The `Job` model has status fields but nothing ever picks up a PENDING job and runs it.
**Need**:
- A worker loop that polls PENDING jobs and processes them
- Job type routing: SCAN → call scanner, TRIAGE → call triage agent, RESEARCH → call research pipeline, etc.
- Retry logic (maxRetries already in schema)
- Status tracking: PENDING → RUNNING → COMPLETED/FAILED
- This is the core runtime engine — without it, no pipeline runs

**Fix**: Create `src/lib/engine/worker.ts` with a `processJob()` function and a polling loop. Expose start/stop via API route.

### 5. Scanner/Auto-Scan Scheduler

**Current**: Markets only appear when simulation runs or manual `POST /api/markets` with `action: sync_kalshi`.
**Need**:
- Periodic scan: every N minutes, fetch new markets from enabled venues
- Store as SCANNED stage candidates
- Wire into job queue: SCAN job → scanner → creates markets + candidates

### 6. Decision API Must Run Risk Engine

**Current**: `POST /api/decisions` creates a decision but the risk engine call is stubbed/missing — it doesn't actually call `computeRisk()`.

**Fix**: The decisions POST route must accept judge output, construct `RiskEngineInput`, call `computeRisk()`, and store the result.

### 7. Kalshi Schema Mismatch

**Current**: `kalshi.ts` writes `bid`, `ask`, `lastPrice`, `volume`, `openInterest` to `MarketSnapshot`, but the Prisma schema has `impliedProb`, `liquidity`, `spread`, `volume24h`, `bestBid`, `bestAsk`.

**Fix**: Either update the Kalshi code to map to existing fields, or update the Prisma schema to support both. Easiest: map Kalshi `yes_bid/100` → `bestBid`, `yes_ask/100` → `bestAsk`, `last_price/100` → `impliedProb`, `volume` → `volume24h`.

---

## Important Gaps — Robust Setup

These make the app production-quality but aren't strictly required for a first runnable version.

### 8. Qdrant Writeback (Research Memory)

**Current**: We added Qdrant collection discovery/creation, but nothing writes vectors.
**Need**:
- After research completes, embed the research output + market context
- Store in Qdrant `research_memory` collection
- On new research, query Qdrant for similar past markets (RAG retrieval)
- This is the "memory" loop — learn from past research

### 9. Polymarket Order Execution

**Current**: Orders are written to DB as FILLED instantly. No venue API calls.
**Need**:
- Polymarket CLOB client: authenticate with API key, submit limit/market orders
- Kalshi trading API: authenticate, submit orders
- Order status tracking: PENDING → SUBMITTED → FILLED/PARTIAL/CANCELLED/FAILED
- Fill sync: poll for fill updates

### 10. Settlement + Postmortem

**Current**: Completely missing. No code for market resolution, P&L calculation, or postmortem generation.
**Need**:
- Settlement agent: when market resolves, compute final P&L for all open positions
- Postmortem: feed resolved trade + original research to LLM for lessons learned
- Write results to `Outcome` and `Postmortem` models
- Save learnings to Qdrant/Mem0

### 11. Mem0 Integration

**Current**: Mem0 is a credential type, but no code calls Mem0.
**Need**:
- Store compact memory of past trades/patterns
- Retrieve context before research
- This is secondary to Qdrant but provides long-term compact memory

### 12. Credential Encryption

**Current**: `encryptedData` field stores JSON **as plaintext**. The field name says "encrypted" but nothing encrypts.
**Need**:
- Encrypt API keys before storing (AES-256-GCM with a server secret)
- Decrypt only when needed for API calls
- Rotate encryption key capability

### 13. Authentication / Multi-user

**Current**: No auth. Anyone who can reach port 3000 has full access.
**Need**:
- `next-auth` is in package.json but never configured
- Basic auth or API key gate for production

### 14. Setup Wizard

**Current**: `setup.sh` is a hardcoded start script for a specific machine (`/home/z/my-project`).
**Need**:
- Interactive setup: ask for service URLs, API keys, Docker choices
- Generate `.env` from answers
- Docker compose with profile selection
- Database initialization

### 15. Health Endpoint Must Check Real Services

**Current**: `GET /api/health` returns `vectorStatus: dbStatus` — it just mirrors SQLite. Never actually pings Qdrant/Ollama/SearXNG.
**Need**:
- Ping each connected service on health check
- Report real UP/DOWN per service

### 16. Live Simulation Mode vs Real Mode

**Current**: `live-simulation.ts` records orders with `dryRun: false` but it's all fake data. Confusing.
**Need**:
- Clear separation: simulation mode uses fake data, live mode uses real pipeline
- Kill switch must actually prevent order submission in live mode
- Dry-run mode: run full pipeline but skip order submission

---

## Priority Order for Implementation

**Phase 1 — Bare Minimum Runnable (do these first)**

| # | Gap | Effort | Impact |
|---|-----|--------|--------|
| 1 | Fix Kalshi schema mismatch | Small | Real market data flows |
| 2 | Add Polymarket scanner | Medium | Second venue live |
| 3 | LLM client + agent pipeline | Large | Core product works |
| 4 | Job queue worker | Large | Pipeline actually runs |
| 5 | Decision API runs risk engine | Small | Risk decisions are real |
| 6 | Scanner scheduler | Medium | Auto-fetch new markets |

**Phase 2 — Robust (do these next)**

| # | Gap | Effort | Impact |
|---|-----|--------|--------|
| 7 | SearXNG research integration | Medium | Real research sources |
| 8 | Qdrant writeback + RAG retrieval | Large | Memory loop works |
| 9 | Health checks real services | Small | Accurate monitoring |
| 10 | Credential encryption | Medium | Security baseline |
| 11 | Clear sim vs live separation | Medium | Prevent confusion |
| 12 | Setup wizard | Large | Onboarding |

**Phase 3 — Full Production**

| # | Gap | Effort | Impact |
|---|-----|--------|--------|
| 13 | Order execution (Polymarket/Kalshi) | Large | Real money trades |
| 14 | Settlement + postmortem | Medium | Learning loop |
| 15 | Mem0 integration | Medium | Compact long-term memory |
| 16 | Authentication | Medium | Multi-user safety |