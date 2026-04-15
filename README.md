# Trading Command Center

Production-grade autonomous prediction market trading system. Discover, research, evaluate, and execute trades with structured probability estimation and deterministic risk management across Polymarket, Kalshi, SX Bet, and Manifold.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Development Environment Setup](#development-environment-setup)
- [Production Environment Setup](#production-environment-setup)
- [Optional Docker Services](#optional-docker-services)
- [API Endpoints](#api-endpoints)
- [Database Schema](#database-schema)
- [Agent Pipeline](#agent-pipeline)
- [Risk Engine](#risk-engine)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

---

## Architecture Overview

The Trading Command Center follows a pipeline-based architecture where markets flow through sequential AI agent stages before any trade is executed. The system operates in two modes: **Dry-Run** (simulated orders, recorded in DB) and **Live** (real exchange execution).

```
Scan Markets --> Triage --> Research --> Judge --> Risk Check --> Execute --> Settle
```

Each stage is a background job tracked in the database, enabling pause/resume, retry on failure, and full audit history.

### Key Design Decisions

- **SQLite** for zero-dependency single-file database (no Postgres/Redis required to run)
- **Standalone Next.js build** for minimal Docker image footprint
- **Zustand** for lightweight client state (sidebar, toggles, active page)
- **Prisma ORM** with 16 models covering the entire trading lifecycle
- **Deterministic risk engine** with Kelly-inspired position sizing and 10 reason codes for trade rejection
- **Versioned prompt templates** for reproducible agent behavior

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| UI Library | React 19 + shadcn/ui (new-york) |
| Styling | Tailwind CSS 4 |
| Database | SQLite via Prisma ORM 6 |
| Client State | Zustand 5 |
| Server State | TanStack React Query 5 |
| Forms | React Hook Form 7 + Zod 4 |
| Charts | Recharts 2 |
| Icons | Lucide React |
| Runtime | Bun (dev), Node.js (production) |
| AI SDK | z-ai-web-dev-sdk |
| Reverse Proxy | Caddy (optional) |

---

## Project Structure

```
trading-command-center/
├── prisma/
│   └── schema.prisma          # 16-table database schema (SQLite)
├── public/
│   ├── logo.svg
│   └── robots.txt
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout (fonts, dark theme, Toaster)
│   │   ├── page.tsx            # Main SPA (sidebar + 8 pages)
│   │   ├── globals.css         # Tailwind + shadcn CSS variables
│   │   └── api/
│   │       ├── health/route.ts           # System health metrics
│   │       ├── jobs/route.ts             # Job queue management
│   │       ├── simulation/route.ts       # Live simulation control
│   │       ├── markets/route.ts          # Market data
│   │       ├── decisions/route.ts        # Trade decisions (BUY/SKIP)
│   │       ├── orders/route.ts           # Order management
│   │       ├── strategy/route.ts         # Strategy settings
│   │       ├── credentials/route.ts      # API key / credential CRUD
│   │       ├── credentials/test/route.ts # Credential connection testing
│   │       ├── prompts/route.ts          # Prompt template management
│   │       └── research/route.ts         # Research run management
│   ├── components/
│   │   ├── trading/
│   │   │   ├── SimulationLab.tsx    # Live simulation dashboard (default page)
│   │   │   ├── StrategyHub.tsx      # Strategy configuration
│   │   │   ├── CredentialManager.tsx # Exchange & AI service credentials
│   │   │   ├── MarketTriage.tsx     # Market scanning & triage
│   │   │   ├── ResearchLedger.tsx   # Research run tracking
│   │   │   ├── PromptStudio.tsx     # Prompt template editor
│   │   │   ├── LiveStatus.tsx       # Real-time agent pipeline monitor
│   │   │   └── SystemHealth.tsx     # System health & job queue
│   │   └── ui/                     # 50+ shadcn/ui components
│   ├── lib/
│   │   ├── db.ts                   # Prisma client singleton
│   │   ├── utils.ts                # cn() helper, utilities
│   │   ├── types/index.ts          # TypeScript type definitions
│   │   ├── constants/index.ts      # Venues, categories, default prompts
│   │   └── engine/
│   │       ├── risk.ts             # Deterministic risk engine
│   │       ├── simulation.ts       # Trading simulation engine
│   │       └── live-simulation.ts  # Live simulation mode
│   ├── store/
│   │   └── trading-store.ts        # Zustand global state
│   └── hooks/
│       ├── use-toast.ts
│       └── use-mobile.ts
├── db/
│   └── custom.db                  # SQLite database file
├── docker-compose.yml             # Optional services (Qdrant, Ollama, SearXNG, Mem0)
├── Caddyfile                      # Reverse proxy config
├── start.sh                       # Production startup script
├── next.config.ts                 # Standalone build config
├── .env                           # Environment variables (DATABASE_URL)
├── package.json
├── tsconfig.json
└── README.md
```

---

## Development Environment Setup

### Prerequisites

- **Node.js** >= 18.17 (LTS recommended)
- **Bun** >= 1.0 (optional, for faster dev server)
- **Git**

### Step-by-Step Setup

```bash
# 1. Clone the repository
git clone <repository-url>
cd trading-command-center

# 2. Install dependencies
npm install
# or: bun install

# 3. Set up environment variables
cp .env.example .env
# Edit .env and set your DATABASE_URL:
#   DATABASE_URL=file:./db/custom.db

# 4. Generate Prisma client and push schema to database
npx prisma generate
npx prisma db push

# 5. Start the development server
npm run dev
# Server starts at http://localhost:3000
```

### Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Next.js dev server on port 3000 |
| `npm run build` | Production build + copy static assets to standalone |
| `npm run start` | Start production server (requires `npm run build` first) |
| `npm run lint` | Run ESLint |
| `npm run db:push` | Push schema changes to SQLite database |
| `npm run db:generate` | Regenerate Prisma client from schema |
| `npm run db:migrate` | Create and apply Prisma migration |
| `npm run db:reset` | Reset database (drops all data) |

### Development Tips

- The dev server uses Turbopack by default (Next.js 16) for fast HMR
- TypeScript errors are ignored at build time (`ignoreBuildErrors: true`) for faster iteration
- React Strict Mode is disabled (`reactStrictMode: false`) to prevent double-render issues with polling intervals
- All components are client-side (`'use client'`) — the app is a single-page dashboard
- API routes run server-side and use the Prisma client from `src/lib/db.ts`

---

## Production Environment Setup

### Option A: Using the Start Script (Recommended)

```bash
# 1. Install dependencies and build
npm install
npm run build

# 2. Set environment variables
export DATABASE_URL=file:./db/custom.db

# 3. Run the startup script (includes auto-restart watchdog)
bash start.sh
```

The `start.sh` script handles:
- Killing any existing server on port 3000
- Copying static assets to the standalone build directory
- Starting the server with `PORT=3000` environment variable
- Auto-restarting on crash via a watchdog loop

### Option B: Manual Production Setup

```bash
# 1. Build the application
npm run build
# This runs: next build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/

# 2. Start the standalone server
cd .next/standalone
PORT=3000 NODE_ENV=production node server.js
```

### Option C: Docker Deployment

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
RUN corepack enable && bun install --frozen-lockfile

# Build
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Production
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/db ./db

EXPOSE 3000
CMD ["node", "server.js"]
```

Build and run:
```bash
docker build -t trading-command-center .
docker run -d -p 3000:3000 -v tcc-data:/app/db trading-command-center
```

### Option D: Caddy Reverse Proxy

A `Caddyfile` is included for production reverse proxy with automatic HTTPS:

```
# Start Caddy on port 81
caddy run --config Caddyfile
```

This proxies port 81 to the Next.js server on port 3000 with proper forwarding headers.

### Important Production Notes

1. **Port Configuration**: The standalone server uses `PORT` environment variable, NOT the `-p` flag. Use `PORT=3000 node server.js`.

2. **Static Assets**: Standalone builds do NOT include static files. You must manually copy them:
   ```bash
   cp -r .next/static .next/standalone/.next/
   cp -r public .next/standalone/
   ```

3. **Database**: The SQLite database file is at `db/custom.db`. Mount this as a volume in Docker for persistence.

4. **Environment Variables**: Only `DATABASE_URL` is required. Set it in `.env` or via environment.

---

## Optional Docker Services

The `docker-compose.yml` provides optional self-hosted services for enhanced AI capabilities. These are **not required** for basic operation — the system gracefully handles their absence.

```bash
# Start all optional services
docker compose --profile services up -d

# Start specific services only
docker compose --profile services up -d qdrant ollama

# Stop all services
docker compose --profile services down
```

| Service | Port | Purpose |
|---------|------|---------|
| **Qdrant** | 6333, 6334 | Vector database for RAG memory and semantic search |
| **Ollama** | 11434 | Local LLM inference server for research agents |
| **SearXNG** | 8888 | Privacy-focused metasearch engine for web research |
| **Mem0** | 8000 | Long-term memory layer for agent conversations |

Configure service URLs in the **Credentials** page of the UI. The system reports service health status in **Live Status** and **System Health** pages.

---

## API Endpoints

All endpoints are under `/api/`. The server is the Next.js App Router.

### Health & Monitoring

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | System health metrics (queue depth, API health, DB status, uptime) |
| GET | `/api/jobs` | List background jobs (supports `?limit=N`, `?type=SCAN`, `?status=RUNNING`) |

### Trading Pipeline

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/simulation` | Get current simulation state |
| POST | `/api/simulation` | Start/stop/configure simulation (`{ action: "start" \| "stop" \| "config" }`) |
| GET | `/api/markets` | List all markets (supports `?venue=POLYMARKET`, `?status=ACTIVE`) |
| GET | `/api/decisions` | List trade decisions (BUY/SKIP with edge, confidence, urgency) |
| GET | `/api/orders` | List orders (supports `?limit=N`) |
| GET | `/api/research` | List research runs |

### Configuration

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/strategy` | Get current strategy settings |
| PUT | `/api/strategy` | Update strategy settings |
| GET | `/api/credentials` | List all credentials |
| POST | `/api/credentials` | Create/update credential |
| POST | `/api/credentials/test` | Test credential connection (URL reachability + latency) |
| GET | `/api/prompts` | List prompt templates |
| POST | `/api/prompts` | Create/update prompt template |

---

## Database Schema

The system uses **16 Prisma models** with SQLite:

| Model | Description |
|-------|-------------|
| `Market` | Core entity — prediction markets across 4 venues |
| `MarketSnapshot` | Price/liquidity snapshots per market |
| `TradeCandidate` | Pipeline stage tracker (SCANNED through SETTLED) |
| `ResearchRun` | AI research execution runs |
| `ResearchSource` | Fetched URLs/content for research |
| `AgentOutput` | LLM agent outputs (TRIAGE, BULL, BEAR, CONTRADICTION, JUDGE roles) |
| `Decision` | Trade decisions (BUY/SKIP) with edge, confidence, urgency |
| `Order` | Trade orders with fills |
| `Fill` | Individual order fills with fees |
| `Position` | Open/closed positions with P&L tracking |
| `Outcome` | Market resolution results |
| `Postmortem` | Trade analysis and lessons learned |
| `PromptTemplate` | Versioned prompt templates for agent roles |
| `Credential` | Encrypted credentials for exchanges and AI services |
| `Settings` | Key-value application settings |
| `AuditLog` | Action audit trail |
| `Job` | Background job queue (SCAN, TRIAGE, RESEARCH, JUDGE, RISK, EXECUTE, SETTLE) |

### Supported Venues

| Venue | Value | Status |
|-------|-------|--------|
| Polymarket | `POLYMARKET` | Primary |
| Kalshi | `KALSHI` | Primary |
| SX Bet | `SX_BET` | Supported |
| Manifold | `MANIFOLD` | Supported |

---

## Agent Pipeline

The system uses a multi-agent AI architecture with role-based prompts:

1. **Scanner** — Discovers new markets across enabled venues
2. **Triage** — Classifies markets as RELEVANT, IRRELEVANT, or AMBIGUOUS
3. **Research** — Fetches web sources and runs deep analysis
4. **Judge** — Synthesizes bull/bear/contradiction arguments into a probability estimate
5. **Risk** — Applies deterministic risk checks and computes position sizing
6. **Executor** — Places orders (real or simulated based on mode)
7. **Settle** — Tracks market resolution and closes positions

Each agent role has a versioned prompt template editable in the **Prompt Studio** page.

### Agent Roles

| Role | Purpose |
|------|---------|
| **Bull** | Constructs strongest argument FOR the market outcome |
| **Bear** | Constructs strongest argument AGAINST the market outcome |
| **Contradiction** | Searches for disconfirming evidence and overlooked risks |
| **Judge** | Final arbiter — synthesizes all arguments into a structured probability estimate |

---

## Risk Engine

The risk engine is **fully deterministic** — no AI involvement. It applies 10 sequential checks before approving any trade:

| Check | Reason Code | Threshold |
|-------|------------|-----------|
| Minimum liquidity | `LOW_LIQUIDITY` | < $1,000 |
| Maximum spread | `WIDE_SPREAD` | > 5% |
| Minimum effective edge | `LOW_EDGE` | < 0 (negative after costs) |
| Minimum confidence | `LOW_CONFIDENCE` | < 0.40 |
| Maximum uncertainty | `HIGH_UNCERTAINTY` | > 0.35 |
| Daily exposure limit | `DAILY_LIMIT_REACHED` | >= $50,000 |
| Category exposure limit | `CORRELATED_RISK` | >= $10,000 |
| Catalyst proximity | `CATALYST_TOO_CLOSE` | < 2 hours |

**Position Sizing**: Kelly-inspired with 0.25x multiplier (quarter-Kelly) and confidence-based scaling (0.5x to 1.0x). Maximum position size: $5,000.

**Urgency Levels**:
| Level | Criteria |
|-------|----------|
| IMMEDIATE | Edge >= 15% AND Confidence >= 80% |
| HIGH | Edge >= 10% AND Confidence >= 70% |
| MEDIUM | Edge >= 5% |
| LOW | Below 5% edge |

---

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | SQLite file path (e.g., `file:./db/custom.db`) |
| `PORT` | No | 3000 | Server port (only for production standalone) |

### Strategy Settings

Configurable via the **Strategy Hub** page or `/api/strategy`:

| Setting | Default | Description |
|---------|---------|-------------|
| `enabledVenues` | POLYMARKET, KALSHI | Active trading venues |
| `enabledCategories` | politics, sports, crypto, science, entertainment | Market categories to trade |
| `minLiquidity` | $1,000 | Minimum market liquidity |
| `targetEdge` | 5% | Minimum edge to consider a trade |
| `maxSpread` | 5% | Maximum acceptable bid-ask spread |
| `maxExposurePerMarket` | $5,000 | Maximum position size per market |
| `maxDailyExposure` | $50,000 | Maximum total daily exposure |
| `maxCategoryExposure` | $10,000 | Maximum exposure per category |
| `dryRun` | true | Simulate orders without real execution |

---

## Troubleshooting

### Build fails with "FlaskConical is not defined"

Run a clean build after any icon import changes:
```bash
rm -rf .next
npm run build
```

### Static assets return 404 in production

Standalone builds do not include static files. Copy them manually:
```bash
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/
```
Or use the build script which handles this automatically:
```bash
npm run build
```

### Server starts but immediately exits

Ensure you are using `PORT` environment variable, not `-p` flag:
```bash
# Correct:
PORT=3000 node server.js

# Wrong (does not work with standalone):
node server.js -p 3000
```

### Database errors on first run

Ensure the database schema is pushed:
```bash
npx prisma generate
npx prisma db push
```

### Server process keeps dying in containers

Use the watchdog startup script for auto-restart:
```bash
bash start.sh
```

### Docker services showing UNCONFIGURED in UI

Optional services (Qdrant, Ollama, SearXNG, Mem0) need to be running and their URLs configured in the **Credentials** page. Start them with:
```bash
docker compose --profile services up -d
```
