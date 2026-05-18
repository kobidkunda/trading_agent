# AGENTS.md — Trading Command Center (Trusted PAPER Mode v1)

> Quick-reference guide for coding agents. Read this first before making any changes.
> Updated: 2026-05-18 | 36 models · 26 SPA pages · 50+ API routes · 66 engine modules

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (App Router, `output: 'standalone'`) |
| Language | TypeScript (strict, `noImplicitAny: false`) |
| Runtime | Bun (dev), Node.js (production) |
| Database | **SQLite** via Prisma ORM — NOT Postgres |
| UI | React 19 + Tailwind CSS v4 + shadcn/ui (new-york style) |
| Icons | `lucide-react` — always import from here |
| State | Zustand (`src/store/trading-store.ts`) — SPA routing, kill switch, dry-run |
| Forms | `react-hook-form` + `zod` v4 |
| Charts | `recharts` |
| Animations | `framer-motion` |
| Toasts | `sonner` |
| AI SDK | `z-ai-web-dev-sdk` (server-side only) |
| Tests | `bun:test` — run via `bun test` |

---

## Architecture — Critical Facts

1. **Stack**: Next.js + Prisma + SQLite. No FastAPI, no Celery, no Postgres. Postgres migration is Phase 2/3 only.

2. **This is an SPA** — not a multi-page app. `src/app/page.tsx` is the single entry point. Client-side routing via Zustand `activePage`. No `src/app/(dashboard)/` directory exists.

3. **Three operating modes**: `DEMO` (mock data, instant fills), `PAPER` (real data, simulated execution), `LIVE` (real execution — hard-blocked until go/no-go checklist met).

4. **Market uniqueness**: `@@unique([venue, externalId])` enforces deduplication at database level.

5. **Standalone build quirk** — `next.config.ts` has `output: 'standalone'`. Static assets must be manually copied after build:
   ```bash
   cp -r .next/static .next/standalone/.next/
   cp -r public .next/standalone/
   ```

6. **Port via env var** — Next.js standalone does NOT support `-p` flag. Use `PORT=6501` environment variable.

7. **TS build errors are ignored** — `ignoreBuildErrors: true` in next.config.ts. Always run `npm run typecheck` before merging. CI gate `tsc --noEmit` is required.

8. **`reactStrictMode: false`** — Do not enable. The app uses polling/interval patterns that break with double-render.

9. **Dark-only theme** — The root `<div>` has class `dark` and `bg-gray-950`. No light mode toggle. All components use dark color tokens.

10. **Prisma singleton** — Always import `db` from `@/lib/db.ts`. Never create `new PrismaClient()` elsewhere.

---

## Project Structure

```
tb/
├── .env                          # DATABASE_URL=file:./db/custom.db
├── next.config.ts                # standalone output, ignoreBuildErrors
├── start.sh                      # Production: watchdog auto-restart on port 6501
├── docker-compose.yml            # Optional: Qdrant, Ollama, SearXNG, Mem0
├── Caddyfile                     # Reverse proxy
├── prisma/
│   └── schema.prisma             # 30 models (SQLite)
├── db/
│   ├── custom.db                 # SQLite database file
│   └── backups/                  # Timestamped backups
├── scripts/
│   └── backup-db.sh              # Database backup + SQL dump
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout (fonts, Toaster)
│   │   ├── page.tsx              # SPA shell: TopBar + Sidebar + 26-page switcher
│   │   └── api/                  # 36+ route directories (see API Routes below)
│   ├── components/
│   │   ├── trading/              # 26 domain page-components
│   │   └── ui/                   # 50+ shadcn/ui primitives (DO NOT edit manually)
│   ├── hooks/
│   │   ├── use-mobile.ts         # 768px breakpoint hook
│   │   └── use-toast.ts          # Toast state (shadcn pattern)
│   ├── lib/
│   │   ├── db.ts                 # Prisma singleton (globalThis pattern)
│   │   ├── utils.ts              # cn() helper (clsx + tailwind-merge)
│   │   ├── constants/index.ts    # Venues, categories, default prompts, configs
│   │   ├── types/index.ts        # All TypeScript types & interfaces
│   │   ├── engine/               # 66 modules — core trading pipeline
│   │   └── venues/               # Polymarket, Kalshi venue adapters
│   └── store/
│       └── trading-store.ts      # Zustand: activePage, sidebarOpen, dryRunMode, killSwitch
├── public/
│   ├── logo.svg
│   └── robots.txt
└── download/                     # Generated output files
```

---

## Database Schema (30 Models)

| Model | Description |
|-------|-------------|
| **Market** | Core entity — prediction markets. `@@unique([venue, externalId])` |
| MarketSnapshot | Price/liquidity snapshots per market |
| ScanRun | Venue scan metadata (cursorStart, cursorEnd, mode) |
| VenueCursor | Per-venue pagination cursor |
| HistoricalSnapshot | Time-series snapshots for backtesting |
| **TradeCandidate** | Pipeline stage tracker (SCANNED→SETTLED). 15 scoring factors |
| CandidateRun | Per-candidate scoring breakdown |
| **ResearchRun** | Research execution (QUICK, DEEP, DEERFLOW) |
| ResearchSource | Fetched URLs/content for research |
| **AgentOutput** | LLM agent outputs (11 roles: TRIAGE, BULL, BEAR, CONTRADICTION, JUDGE, etc.) |
| **Decision** | Trade decisions (BID, SKIP, WATCH) with edge/confidence |
| Watchlist | Watchlisted markets with target prices |
| **Order** | Trade orders with lifecycleStatus |
| Fill | Individual order fills |
| **Position** | Open/closed positions with P&L |
| **PaperBet** | Dry-run bet tracking with Brier scoring |
| Outcome | Market resolution results |
| Postmortem | Trade analysis and lessons learned |
| **Wallet** | Wallet intelligence — address, winRate, profitFactor, Brier |
| WalletTrade | Individual wallet trades |
| **EnsemblePrediction** | Per-source model predictions (Brier-weighted) |
| **CorrelationCluster** | Risk cluster exposure tracking |
| ClusterMarketLink | Market-to-cluster mapping |
| **OracleCheck** | Oracle risk assessment (source, ambiguity, cross-venue mismatch) |
| **CausalTreeNode** | Hierarchical causal analysis tree |
| **RelatedMarket** | Related market pairs with relationshipType |
| **StrategyConfigVersion** | Versioned strategy configs tied to backtests |
| BacktestRun | Backtest execution results |
| OrderbookSnapshot | Real-time orderbook microstructure |
| ResearchCheckpoint | Job heartbeat tracking |
| **PromptTemplate** | Versioned agent prompts |
| Credential | Encrypted API keys (AES-256-GCM) |
| Settings | Key-value config store |
| AuditLog | Action audit trail |
| **Job** | Background job queue (7 types: SCAN→EXECUTE→SETTLE) |

### Key Enums

- **TradingMode**: `DEMO | PAPER | LIVE`
- **DataSource**: `MOCK | REAL`
- **ExecutionMode**: `SIMULATED | REAL`
- **OrderLifecycle**: `PLANNED | SUBMITTED | PARTIALLY_FILLED | FILLED | CANCELLED | FAILED | EXPIRED`
- **RiskReasonCode** (15 codes): `LOW_LIQUIDITY | WIDE_SPREAD | LOW_EDGE | LOW_CONFIDENCE | HIGH_UNCERTAINTY | DAILY_LIMIT_REACHED | CORRELATED_RISK | CATALYST_TOO_CLOSE | MARKET_CLOSED | MARKET_RESOLVED | INSUFFICIENT_DATA | MAX_CONCENTRATION | HIGH_ORACLE_RISK | TAIL_RISK | LIVE_BLOCKED`
- **AgentRole** (11 roles): `TRIAGE | BULL | BEAR | CONTRADICTION | JUDGE | POSTMORTEM | SUMMARIZER | ORACLE | ENSEMBLE | WALLET | BIAS`
- **LivePipelineStage** (13 stages): `SCANNED → CANDIDATE_SCORED → DEDUPED → TRIAGED → DEERFLOW_RESEARCHED → FULL_RESEARCHED → DEBATED → POST_DEBATE_PREDICTED → ENSEMBLED → BIAS_CORRECTED → RISK_CHECKED → PAPER_EXECUTED → RESOLVED`

---

## Engine Modules (66 files in `src/lib/engine/`)

| Category | Files | Purpose |
|----------|-------|---------|
| **Pipeline Core** | `pipeline.ts`, `pipeline-decision-helpers.ts` | Full market → decision pipeline |
| **Scanner** | `scanner.ts`, `scanner-upsert.ts`, `market-loop.ts` | Venue scanning + upsert |
| **Candidate** | `candidate-scoring.ts`, `candidate-dedupe.ts`, `candidate-queue.ts`, `candidate-job-enqueuer.ts` | 15-factor scoring + deduplication |
| **Research** | `research/` (11 files) | DeerFlow, Full, Firecrawl, TradingAgents |
| **Agents** | `agents/triage.ts`, `agents/bull.ts`, `agents/bear.ts`, `agents/contradiction.ts`, `agents/judge.ts` | Role-based LLM agents |
| **Debate** | `debate-arena.ts`, `post-debate-prediction.ts` | Multi-round bull/bear debate |
| **Ensemble** | `ensemble-probability.ts` | Brier-weighted model ensemble |
| **Bias** | `bias-correction.ts` (Wang transform), `brier-calibration.ts` | Calibration + bias |
| **Causal** | `causal-tree.ts` | Hierarchical thesis decomposition |
| **Risk** | `risk.ts` (15 checks), `risk-exposure.ts`, `correlation-risk.ts` | Deterministic risk engine |
| **Execution** | `paper-execution.ts`, `paper-bets.ts`, `order-tracker.ts` | Paper execution + lifecycle |
| **Fill** | `orderbook-microstructure.ts` | CLOB depth, fill probability |
| **Wallet** | `wallet-ingestion.ts`, `wallet-signal.ts`, `wallet-cluster.ts`, `wallet-ranker.ts` | Wallet intelligence |
| **Related** | `related-market.ts`, `oracle-mismatch.ts` | Related markets + oracle risk |
| **Backtest** | `backtest-engine.ts`, `walk-forward.ts`, `parameter-sweep.ts` | Historical replay + optimization |
| **Config** | `mode.ts`, `trading-settings.ts`, `trading-config.ts` | Mode/config management |
| **Worker** | `worker.ts`, `worker-checkpoint.ts` | Job queue processor |
| **Services** | `service-routing.ts`, `research-gating.ts` | Model/research routing |
| **Health** | `health-check.ts`, `live-sim-events.ts` | Service health + activity |
| **View Models** | `pipeline-observability-view-model.ts`, `operator-dashboard-view-model.ts`, etc. | Dashboard data |
| **Infra** | `llm-client.ts`, `crypto.ts`, `model-discovery.ts`, `model-fallback.ts`, `demo-mode.ts`, `resolution-poller.ts`, etc. | Shared utilities |
| **Memory** | `memory/embed.ts`, `memory/qdrant.ts` | Vector search |
| **Venues** | `venues/polymarket.ts`, `venues/kalshi.ts` | Venue API adapters |

### Paper Execution Lifecycle

```
WATCH (watchlist) → decision: BID → PLANNED order → SUBMITTED → (fill) → PARTIALLY_FILLED → FILLED
                                                                → (no fill) → CANCELLED/EXPIRED
Position: OPEN only when FILLED. No position for WATCH/SUBMITTED/EXPIRED/CANCELLED.
```

### Fill Models

- `DEMO_INSTANT`: Full instant fill (demo mode only, not for performance metrics)
- `STRICT_LIMIT`: Fill only if order crosses book or book trades through price
- `BOOK_DEPTH_AWARE`: Fill based on available depth at price levels
- `CONSERVATIVE_PAPER`: Assume worse fill price and partial fill (use for all PAPER performance metrics)

---

## API Routes (36+ route directories)

### Core Pipeline
| Endpoint | Methods | Purpose |
|----------|---------|---------|
| `/api` | GET | Health check |
| `/api/health` | GET | DB status, queue depth, job metrics, uptime |
| `/api/jobs` | GET, POST, PUT | Job queue: list/create/update status |
| `/api/simulation` | GET, POST | Simulation state, start/stop/config/run |
| `/api/markets` | GET, POST | Markets: list with snapshots/candidates, create |
| `/api/decisions` | GET, POST | Decisions: list with joins, create (runs risk engine) |
| `/api/orders` | GET | Orders list with market join |
| `/api/research` | GET, POST | Research runs with sources/agent outputs |
| `/api/strategy` | GET, POST | Strategy settings get/upsert |
| `/api/credentials` | GET, POST, PUT, DELETE | Full CRUD with masked preview |
| `/api/prompts` | GET, POST, PUT | Prompt templates: list/create/update |

### Operational
| Endpoint | Methods | Purpose |
|----------|---------|---------|
| `/api/mode` | GET, PUT | Trading mode (DEMO/PAPER/LIVE) |
| `/api/operator` | GET | Operator dashboard view model |
| `/api/market-loop` | POST | Trigger market loop manually |
| `/api/settings` | GET, PUT | Key-value settings |
| `/api/backtest` | POST | Run backtest |
| `/api/strategy-config` | GET, POST | Versioned strategy configs |
| `/api/paper-bets` | GET | Paper bet dashboard |
| `/api/risk` | GET | Exposure graph + cluster dashboard |

---

## Key Files to Edit by Task Type

| Task | Files to Edit |
|------|---------------|
| Add a new page | `src/components/trading/NewPage.tsx`, `src/app/page.tsx` (add to NAV_ITEMS + PageContent switch), `src/store/trading-store.ts` (add PageView type) |
| Add a new API route | `src/app/api/new-route/route.ts` |
| Modify database | `prisma/schema.prisma` → `npx prisma db push` |
| Change risk engine | `src/lib/engine/risk.ts` |
| Change paper execution | `src/lib/engine/paper-execution.ts` |
| Change bias correction | `src/lib/engine/bias-correction.ts` |
| Change ensemble | `src/lib/engine/ensemble-probability.ts` |
| Change candidate scoring | `src/lib/engine/candidate-scoring.ts` |
| Change venue scanning | `src/lib/venues/polymarket.ts`, `src/lib/venues/kalshi.ts` |
| Change types/interfaces | `src/lib/types/index.ts` |
| Change constants | `src/lib/constants/index.ts` |
| Add shadcn/ui component | Use CLI: `npx shadcn@latest add <component>` — do NOT hand-edit `src/components/ui/` |

---

## Coding Rules

1. **Icons** — Always import from `lucide-react`. Every icon used in JSX must be in the import block.
2. **API routes** — All server-side. Import `db` from `@/lib/db`. Import types from `@/lib/types`.
3. **Components** — All trading components are `'use client'`. Use `useState`/`useEffect` for data fetching.
4. **Styling** — Tailwind utility classes. Dark theme only. Primary accent: `emerald-400/500/600`. Danger: `red-400/500/600`. Warning: `amber-400/500/600`. Background: `gray-950`. Surface: `gray-900`. Border: `gray-800`.
5. **No `@radix-ui` direct imports** — Import from `@/components/ui/` wrappers.
6. **z-ai-web-dev-sdk** — Server-side only. Never import in client components.
7. **State** — Cross-component UI state → `trading-store.ts`. Local state → `useState`.
8. **Path alias** — Use `@/` for all imports (mapped to `./src/*`).
9. **Fill lifecycle** — Full fills return `FILLED` not `PARTIALLY_FILLED`. Use `CONSERVATIVE_PAPER` for all PAPER performance metrics.
10. **Polymarket spread** — Mark as `estimatedSpread` when orderbook unavailable. Real spread from bestBid/bestAsk.

---

## Commands

```bash
# Development
npm run dev              # Start dev server on port 6500
npx prisma db push       # Sync schema to database
npx prisma generate      # Regenerate Prisma client
npm run typecheck        # TypeScript type checking (required before merge)

# Testing
npm run test             # Run all tests (bun:test)
npm run test:unit        # Unit tests only
npm run test:integration # Integration/e2e tests
npm run test:engine      # Engine module tests
npm run test:routes      # API route tests

# Production
npm run build            # Build + copy static assets
./start.sh               # Run with watchdog auto-restart
PORT=6501 node .next/standalone/server.js  # Custom port

# Linting
npm run lint             # ESLint check

# Database
npm run db:push          # Push schema changes
npm run db:generate      # Regenerate client
npm run db:reset         # Reset database (destructive)

# Backup
bash scripts/backup-db.sh  # Create timestamped DB backup + SQL dump
```

---

## Common Pitfalls

- **Missing icon import** → Client-side crash. Always check that every `lucide-react` icon used in JSX is in the import statement.
- **Editing `src/components/ui/*` manually** → Will be overwritten. Use `npx shadcn@latest add` instead.
- **Using `-p` flag with standalone** → Won't work. Use `PORT=6501` env var.
- **Forgetting to copy static files after build** → CSS/JS 404. The `build` script handles this.
- **Creating `new PrismaClient()` outside `db.ts`** → Connection leaks. Always use `import { db } from '@/lib/db'`.
- **Importing z-ai-web-dev-sdk in client components** → Build error. Only use in API routes.
- **Assuming FastAPI/Postgres** → Current stack is Next.js + SQLite ONLY. Postgres migration is future work.
- **Creating duplicate markets** → Database now enforces `@@unique([venue, externalId])`. Code-level dedupe is secondary.
- **Using INSTANT fill in PAPER mode** → INSTANT is demo-only. Use BOOK_DEPTH_AWARE or CONSERVATIVE_PAPER for performance metrics.
- **Trusting Polymarket spread without verification** → Spread is `estimatedSpread` when orderbook data unavailable.


<claude-mem-context>
# Memory Context

# claude-mem status

This project has no memory yet. The current session will seed it; subsequent sessions will receive auto-injected context for relevant past work.

Memory injection starts on your second session in a project.

`/learn-codebase` is available if the user wants to front-load the entire repo into memory in a single pass (~5 minutes on a typical repo, optional). Otherwise memory builds passively as work happens.

Live activity: http://localhost:37777
How it works: `/how-it-works`

This message disappears once the first observation lands.
</claude-mem-context>