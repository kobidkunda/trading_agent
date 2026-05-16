# AGENTS.md — Trading Command Center

> Quick-reference guide for coding agents. Read this first before making any changes.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (App Router, `output: 'standalone'`) |
| Language | TypeScript (strict, `noImplicitAny: false`) |
| Runtime | Bun (dev), Node.js (production) |
| Database | SQLite via Prisma ORM |
| UI | React 19 + Tailwind CSS v4 + shadcn/ui (new-york style) |
| Icons | `lucide-react` — always import from here |
| State | Zustand (`src/store/trading-store.ts`) — SPA routing, kill switch, dry-run |
| Forms | `react-hook-form` + `zod` v4 |
| Charts | `recharts` |
| Animations | `framer-motion` |
| Toasts | `sonner` |
| AI SDK | `z-ai-web-dev-sdk` (server-side only) |

---

## Architecture — Critical Facts

1. **This is an SPA** — not a multi-page app. `src/app/page.tsx` is the single entry point. Client-side routing via Zustand `activePage`. No `src/app/(dashboard)/` directory exists.

2. **Standalone build quirk** — `next.config.ts` has `output: 'standalone'`. Static assets must be manually copied after build:
   ```bash
   cp -r .next/static .next/standalone/.next/
   cp -r public .next/standalone/
   ```

3. **Port via env var** — Next.js standalone does NOT support `-p` flag. Use `PORT=6501` environment variable.

4. **TS build errors are ignored** — `ignoreBuildErrors: true` in next.config.ts. TypeScript errors won't block builds but will still cause IDE warnings.

5. **`reactStrictMode: false`** — Do not enable. The app uses polling/interval patterns that break with double-render.

6. **Dark-only theme** — The root `<div>` has class `dark` and `bg-gray-950`. No light mode toggle. All components use dark color tokens.

7. **Prisma singleton** — Always import `db` from `@/lib/db.ts`. Never create `new PrismaClient()` elsewhere.

---

## Project Structure

```
/home/z/my-project/
├── .env                          # DATABASE_URL=file:/home/z/my-project/db/custom.db
├── next.config.ts                # standalone output, ignoreBuildErrors
├── start.sh                      # Production: watchdog auto-restart on port 6501
├── docker-compose.yml            # Optional: Qdrant, Ollama, SearXNG, Mem0
├── Caddyfile                     # Reverse proxy port 6502 → 6501
├── prisma/
│   └── schema.prisma             # 16 models (SQLite)
├── db/
│   └── custom.db                 # SQLite database file
├── src/
│   ├── app/
│   │   ├── layout.tsx            # Root layout (fonts, Toaster)
│   │   ├── page.tsx              # SPA shell: TopBar + Sidebar + 8-page switcher
│   │   └── api/                  # 11 API routes (see below)
│   ├── components/
│   │   ├── trading/              # 8 domain page-components
│   │   └── ui/                   # 50+ shadcn/ui primitives (DO NOT edit manually)
│   ├── hooks/
│   │   ├── use-mobile.ts         # 768px breakpoint hook
│   │   └── use-toast.ts          # Toast state (shadcn pattern)
│   ├── lib/
│   │   ├── db.ts                 # Prisma singleton (globalThis pattern)
│   │   ├── utils.ts              # cn() helper (clsx + tailwind-merge)
│   │   ├── constants/index.ts    # Venues, categories, stage colors, defaults
│   │   ├── types/index.ts        # All TypeScript types & interfaces
│   │   └── engine/
│   │       ├── risk.ts           # Deterministic risk engine (10 checks, Kelly sizing)
│   │       ├── simulation.ts     # Batch simulation
│   │       └── live-simulation.ts# Continuous simulation loop (singleton)
│   └── store/
│       └── trading-store.ts      # Zustand: activePage, sidebarOpen, dryRunMode, killSwitch
├── public/
│   ├── logo.svg
│   └── robots.txt
└── download/                     # Generated output files go here
```

---

## Pages (Zustand Keys → Components)

| Key | Component | File | Purpose |
|-----|-----------|------|---------|
| `simulation` | `SimulationLab` | `src/components/trading/SimulationLab.tsx` | Live simulation dashboard (default) |
| `strategy` | `StrategyHub` | `src/components/trading/StrategyHub.tsx` | Venue toggles, risk params, prompt versions |
| `credentials` | `CredentialManager` | `src/components/trading/CredentialManager.tsx` | Service credential CRUD + testing |
| `triage` | `MarketTriage` | `src/components/trading/MarketTriage.tsx` | Market scanning & triage table |
| `research` | `ResearchLedger` | `src/components/trading/ResearchLedger.tsx` | Decisions & risk engine outputs |
| `prompts` | `PromptStudio` | `src/components/trading/PromptStudio.tsx` | Versioned prompt template editor |
| `live` | `LiveStatus` | `src/components/trading/LiveStatus.tsx` | Real-time agent pipeline (5s poll) |
| `health` | `SystemHealth` | `src/components/trading/SystemHealth.tsx` | System metrics & job queue (15s poll) |

---

## API Routes

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
| `/api/prompts` | GET, POST, PUT | Prompt templates: list/create (auto-version)/update |

---

## Database Schema (16 Models)

```
Market → MarketSnapshot[], TradeCandidate[], ResearchRun[], Decision[], Order[], Position[], Outcome[], Postmortem[]
TradeCandidate → Decision[], ResearchRun[]
ResearchRun → ResearchSource[], AgentOutput[]
Order → Fill[]
PromptTemplate (unique on [name, version])
Credential (service, label, encryptedData, maskedPreview, serviceUrl)
Settings (key-value store)
AuditLog (action, actor, entityType, entityId)
Job (type, status, priority, payload, result)
```

**Key enums** (stored as strings in SQLite):
- Venues: `POLYMARKET | KALSHI | SX_BET | MANIFOLD`
- Pipeline stages: `SCANNED → TRIAGED → RESEARCHING → JUDGED → DECIDED → EXECUTED → SETTLED`
- Agent roles: `TRIAGE | BULL | BEAR | CONTRADICTION | JUDGE`
- Job types: `SCAN | TRIAGE | RESEARCH | JUDGE | RISK | EXECUTE | SETTLE`
- Decision actions: `BUY | SKIP`

---

## Key Files to Edit by Task Type

| Task | Files to Edit |
|------|---------------|
| Add a new page | `src/components/trading/NewPage.tsx`, `src/app/page.tsx` (add to NAV_ITEMS + PageContent switch), `src/store/trading-store.ts` (add PageView type) |
| Add a new API route | `src/app/api/new-route/route.ts` |
| Modify database | `prisma/schema.prisma` → `npx prisma db push` |
| Change risk engine | `src/lib/engine/risk.ts` |
| Change simulation logic | `src/lib/engine/simulation.ts` or `live-simulation.ts` |
| Change types/interfaces | `src/lib/types/index.ts` |
| Change constants | `src/lib/constants/index.ts` |
| Add shadcn/ui component | Use CLI: `npx shadcn@latest add <component>` — do NOT hand-edit `src/components/ui/` |

---

## Coding Rules

1. **Icons** — Always import from `lucide-react`. Every icon used in JSX must be in the import block (missing imports cause client-side crashes).

2. **API routes** — All server-side. Import `db` from `@/lib/db`. Import types from `@/lib/types`. Use `NextRequest`/`NextResponse` from `next/server`.

3. **Components** — All trading components are `'use client'`. Use `useState`/`useEffect` for data fetching with `fetch('/api/...')`.

4. **Styling** — Tailwind utility classes. Dark theme only. Primary accent: `emerald-400/500/600`. Danger: `red-400/500/600`. Warning: `amber-400/500/600`. Background: `gray-950`. Surface: `gray-900`. Border: `gray-800`.

5. **No `@radix-ui` direct imports** — Import from `@/components/ui/` wrappers, never from `@radix-ui/*` directly.

6. **z-ai-web-dev-sdk** — Server-side only. Never import in client components.

7. **State** — For cross-component UI state, add to `trading-store.ts`. For local component state, use `useState`.

8. **Path alias** — Use `@/` for all imports (mapped to `./src/*`).

---

## Commands

```bash
# Development
npm run dev              # Start dev server on port 6500
npx prisma db push       # Sync schema to database
npx prisma generate      # Regenerate Prisma client

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
```

---

## Common Pitfalls

- **Missing icon import** → Client-side crash. Always check that every `lucide-react` icon used in JSX is in the import statement.
- **Editing `src/components/ui/*` manually** → Will be overwritten. Use `npx shadcn@latest add` instead.
- **Using `-p` flag with standalone** → Won't work. Use `PORT=6501` env var.
- **Forgetting to copy static files after build** → CSS/JS 404. The `build` script handles this, but manual builds need: `cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/`.
- **Creating `new PrismaClient()` outside `db.ts`** → Connection leaks. Always use `import { db } from '@/lib/db'`.
- **Importing z-ai-web-dev-sdk in client components** → Build error. Only use in API routes.


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

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
<!-- SPECKIT END -->
