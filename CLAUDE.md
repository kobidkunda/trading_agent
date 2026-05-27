# CLAUDE.md - Tradingbot Agent Operating Contract

<!-- AUTONOMY DIRECTIVE - DO NOT REMOVE -->
YOU ARE AN AUTONOMOUS CODING AGENT. EXECUTE TASKS TO COMPLETION WITHOUT ASKING FOR PERMISSION.
DO NOT STOP TO ASK "SHOULD I PROCEED?" - PROCEED. DO NOT WAIT FOR CONFIRMATION ON OBVIOUS NEXT STEPS.
IF BLOCKED, TRY AN ALTERNATIVE APPROACH. ONLY ASK WHEN TRULY AMBIGUOUS OR DESTRUCTIVE.
USE CODEX NATIVE SUBAGENTS FOR INDEPENDENT PARALLEL SUBTASKS WHEN THAT IMPROVES THROUGHPUT. THIS IS COMPLEMENTARY TO OMX TEAM MODE.
<!-- END AUTONOMY DIRECTIVE -->

This file is the Claude Code entrypoint for the Trading Command Center repository at `/Volumes/AppProjectStorage/application/project/tradingbot/tb`.

`AGENTS.md` remains the canonical cross-agent source of truth. Claude agents must read and obey `AGENTS.md` before changing code. If this file and `AGENTS.md` ever conflict, follow the more specific instruction and update the stale doc instead of silently choosing convenience.

## Operating Principles

- Solve the task directly when it is safe and clear.
- Delegate only when parallel work materially improves speed, quality, or correctness.
- Keep progress updates short, concrete, and evidence-based.
- Prefer evidence over assumption; verify before claiming completion.
- Use the lightest path that preserves quality: direct action, MCP/tooling, then delegation.
- Check official documentation before implementing with unfamiliar SDKs, frameworks, or APIs.
- Proceed automatically on clear, low-risk, reversible local edit-test-verify work.
- Ask only for destructive, irreversible, credential-gated, external-production, materially scope-changing, or truly ambiguous decisions.
- Treat newer user updates and newly supplied logs as the current source of truth.
- Do not ask a human to perform ordinary non-destructive local actions that the agent can run.

## Workflow And Delegation

- Default lane: solo execute.
- Use `$deep-interview` only for unclear intent, missing boundaries, or explicit "do not assume" requests.
- Use `$ralplan` when requirements are clear enough but architecture, tradeoffs, or test shape need review before implementation.
- Use `$team` only when coordinated parallel execution across lanes is worth the overhead.
- Use `$ralph` when an approved plan needs persistent single-owner completion and verification.
- In Codex App or plain Codex sessions without an attached OMX tmux runtime, treat runtime workflows such as `autopilot`, `ralph`, `ultrawork`, `ultraqa`, `team`, `swarm`, and `ecomode` as unavailable unless the user explicitly asks to launch OMX CLI.
- Outside active team/swarm runtime, do not spawn Worker-labeled helpers. Use role-appropriate child agents such as `explore`, `executor`, `debugger`, `test-engineer`, `verifier`, `researcher`, `dependency-expert`, `architect`, `critic`, or `writer`.
- Max 6 concurrent child agents. Delegated prompts must be bounded, verifiable, and scoped to the assigned files or facts.
- Leaders own integration, final verification, and user-facing status. Child agents report blockers upward and do not re-plan the whole task.
- Prefer repo-local lookup roles for current code facts, researcher roles for official docs and external API behavior, and dependency-expert roles for package or SDK decisions.
- If `ralph` is active, enforce ralplan-first: do not implement until both `.omx/plans/prd-*.md` and `.omx/plans/test-spec-*.md` exist.

## OMX And State

- OMX state lives under `.omx/`: `.omx/state/`, `.omx/notepad.md`, `.omx/project-memory.json`, `.omx/plans/`, and `.omx/logs/`.
- Runtime/team overlays are marker-bounded; preserve these markers when present:
  - `<!-- OMX:RUNTIME:START -->` / `<!-- OMX:RUNTIME:END -->`
  - `<!-- OMX:TEAM:WORKER:START -->` / `<!-- OMX:TEAM:WORKER:END -->`
- Treat hook-injected routing context as authoritative for the current turn.
- If `USE_OMX_EXPLORE_CMD` enables advisory routing, prefer `omx explore --prompt ...` for simple read-only repository lookups.
- Use `omx sparkshell` only for explicit opt-in noisy read-only shell summaries, bounded verification, repo-wide listing/search, or tmux-pane summaries.
- Do not manually duplicate hook-owned activation state unless recovering from missing or stale state.

## Cleanup And Refactor Rules

- For cleanup, refactor, or deslop work, write a cleanup plan first.
- Lock behavior with regression tests before editing when coverage is missing.
- Prefer deletion, existing utilities, and existing patterns before adding abstractions.
- Add dependencies only when explicitly requested.
- Keep diffs small, reviewable, and reversible.
- Preserve writer/reviewer pass separation for cleanup plans and approvals.

## Repository Facts

- Framework: Next.js 16 App Router with `output: 'standalone'`.
- Language: TypeScript, strict config, `noImplicitAny: false`.
- Runtime: Bun for dev, Node.js for production.
- Database: Prisma ORM on SQLite only. Do not assume Postgres, Celery, or FastAPI.
- UI: React 19, Tailwind CSS v4, shadcn/ui new-york style, dark-only theme.
- Icons: always import icons from `lucide-react`.
- State: Zustand in `src/store/trading-store.ts`.
- Forms: `react-hook-form` plus `zod` v4.
- Charts: `recharts`.
- Animations: `framer-motion`.
- Toasts: `sonner`.
- AI SDK: `z-ai-web-dev-sdk`, server-side only.
- Tests: `bun:test`; use `bun test` or npm scripts that wrap it.

## Real App Facts

- The app is a Next.js SPA: `src/app/page.tsx` loads `TradingCommandCenterShell`.
- UI pages are defined in `src/lib/navigation/trading-pages.ts` and rendered from `src/components/trading/*`.
- API routes live under `src/app/api/*`.
- DB schema lives in `prisma/schema.prisma`.
- Always import DB from `src/lib/db.ts`; never create another Prisma client.
- Modes live in `src/lib/engine/mode.ts`:
  - `DEMO = MOCK + SIMULATED`
  - `PAPER = REAL + SIMULATED`
  - `LIVE = REAL + REAL`, but live execution remains hard-blocked.
- Main flow: market scan -> `TradeCandidate` -> research/agents -> `Decision` -> risk -> `Order`/`PaperBet` -> `Outcome`.
- Market/proxy requests flow through the proxy configuration under `apps/proxyapp`, deployed separately.
- Do not assume database rows exist just because WAL/SHM files or generated snapshots exist.

## Hard Agent Rules

- Do not guess. Verify from code, DB, API response, browser behavior, or logs.
- For any error, preserve and report the exact error/status/stack/file/route.
- No hardcoded data, fake rows, or silent fallback in `PAPER` or `LIVE`.
- Mock/demo data is allowed only in `DEMO` mode.
- Every `catch` must log the real error with `console.error`; persist `AuditLog` or `Job` failure when possible.
- For blank pages, trace separately: UI page -> API route -> Prisma query -> DB rows -> engine writer.
- Current blank or fragile areas to verify separately: Market Triage, Research Queue, Paper Orders, Paper Bets, Decisions, Outcomes.
- When reporting issues, name the exact broken file/function/model and the missing or wrong data.
- Do not skip modules when the user asks for complete coverage.
- Do not say "fixed" until typecheck/tests and direct API/DB/browser checks appropriate to the change pass.

## Architecture Constraints

- This is an SPA, not a multi-page app. Do not invent `src/app/(dashboard)/` routes unless the user explicitly changes architecture.
- Client-side navigation uses Zustand `activePage`.
- `@@unique([venue, externalId])` enforces market deduplication at the DB level.
- `next.config.ts` uses `output: 'standalone'`; production static assets must be copied after build:

```bash
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/
```

- Standalone Next.js does not support `-p`; use `PORT=6501`.
- TypeScript build errors are ignored by Next build. Always run `npm run typecheck` before merge-quality claims.
- Do not enable `reactStrictMode`; polling/interval flows rely on the current setting.
- Keep the dark-only theme. Do not add light mode unless explicitly requested.
- Prisma singleton is mandatory. Use `import { db } from '@/lib/db'`.

## Coding Rules

- API routes are server-side; import `db` from `@/lib/db` and shared types from `@/lib/types`.
- Trading components are client components. Use local `useState`/`useEffect` for component-local fetching and Zustand for cross-component UI state.
- Use Tailwind utilities and existing shadcn/ui wrappers.
- Do not import `@radix-ui/*` directly; import from `@/components/ui/*`.
- Do not hand-edit `src/components/ui/*`; use `npx shadcn@latest add <component>` for new primitives.
- Never import `z-ai-web-dev-sdk` in client components.
- Use `@/` path aliases for imports mapped to `./src/*`.
- Full fills return `FILLED`, not `PARTIALLY_FILLED`.
- `DEMO_INSTANT` fill is demo-only. Use `BOOK_DEPTH_AWARE` or `CONSERVATIVE_PAPER`; use `CONSERVATIVE_PAPER` for PAPER performance metrics.
- Polymarket spreads must be marked `estimatedSpread` when orderbook data is unavailable. Real spread requires best bid and best ask.

## UI Rules

- Dark theme tokens: background `gray-950`, surface `gray-900`, border `gray-800`.
- Primary accent: `emerald-400/500/600`.
- Danger: `red-400/500/600`.
- Warning: `amber-400/500/600`.
- Every JSX icon must have a matching `lucide-react` import.
- Preserve exact user-specified assets and URLs.
- When browser verification is requested, use the live browser and enumerate page-by-page findings.

## Paper And Live Mode Boundaries

- `DEMO` may use mock data and instant fills.
- `PAPER` must use real venue data with simulated execution.
- `LIVE` must use real venue data and real execution, but live execution is blocked until the go/no-go checklist is satisfied.
- Never let DEMO-only mocks leak into PAPER or LIVE.
- Do not hide PAPER/LIVE failures behind sample data or generic empty states.

## Execution Lifecycle

```text
WATCH (watchlist) -> decision: BID -> PLANNED order -> SUBMITTED -> fill -> PARTIALLY_FILLED -> FILLED
                                                               -> no fill -> CANCELLED/EXPIRED
```

Positions open only when an order is `FILLED`. Do not create positions for `WATCH`, `SUBMITTED`, `EXPIRED`, or `CANCELLED`.

## Key Files By Task

- Add a page: `src/components/trading/NewPage.tsx`, `src/app/page.tsx`, `src/store/trading-store.ts`.
- Add an API route: `src/app/api/new-route/route.ts`.
- Modify database: `prisma/schema.prisma`, then `npx prisma db push` when appropriate.
- Risk engine: `src/lib/engine/risk.ts`.
- Paper execution: `src/lib/engine/paper-execution.ts`.
- Bias correction: `src/lib/engine/bias-correction.ts`.
- Ensemble: `src/lib/engine/ensemble-probability.ts`.
- Candidate scoring: `src/lib/engine/candidate-scoring.ts`.
- Venue scanning: `src/lib/venues/polymarket.ts`, `src/lib/venues/kalshi.ts`.
- Types/interfaces: `src/lib/types/index.ts`.
- Constants: `src/lib/constants/index.ts`.

## Commands

```bash
# Development
npm run dev
npx prisma db push
npx prisma generate
npm run typecheck

# Testing
npm run test
npm run test:unit
npm run test:integration
npm run test:engine
npm run test:routes

# Production
npm run build
./start.sh
PORT=6501 node .next/standalone/server.js

# Linting
npm run lint

# Database
npm run db:push
npm run db:generate
npm run db:reset

# Backup
bash scripts/backup-db.sh
```

`npm run db:reset` is destructive. Do not run destructive commands unless explicitly requested.

## Verification Contract

Before claiming completion:

- Define the exact claim and success criteria.
- Run the smallest validation that can prove the claim.
- Prefer targeted tests for changed behavior, then typecheck/lint/build/smoke checks as applicable.
- For UI changes, use browser verification when behavior or layout matters.
- For API/data changes, verify direct API output and DB state when relevant.
- If validation fails, iterate.
- If validation cannot run, report why and use the next-best check.
- Final reports must name changed files, verification evidence, and remaining risks.

## Lore Commit Protocol

Every commit message must be a concise decision record:

```text
<intent line: why the change was made, not what changed>

<optional concise body: constraints and approach rationale>

Constraint: <external constraint that shaped the decision>
Rejected: <alternative considered> | <reason for rejection>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Directive: <forward-looking warning for future modifiers>
Tested: <what was verified>
Not-tested: <known gaps in verification>
```

Use trailers only when they add decision context.

## Common Pitfalls

- Missing `lucide-react` import causes client crashes.
- Hand-editing `src/components/ui/*` is wrong; use shadcn CLI.
- Standalone server port must use `PORT=...`, not `-p`.
- Next build can hide TypeScript errors because build errors are ignored.
- Creating `new PrismaClient()` outside `src/lib/db.ts` leaks connections.
- Importing `z-ai-web-dev-sdk` in client code breaks builds.
- Assuming FastAPI/Postgres is wrong for this repo.
- Duplicate markets are blocked by DB uniqueness; code-level dedupe is secondary.
- Using instant fills in PAPER corrupts performance metrics.
- Trusting Polymarket spread without orderbook verification is wrong.

## Claude-Mem Note

The AGENTS guidance currently says `claude-mem` is not fully seeded for this project and `/learn-codebase` is optional. Do not claim memory coverage exists unless it is verified in the current session.
