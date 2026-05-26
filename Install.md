# Install and Deployment Guide

This guide covers local development and production deployment for the Trading Command Center.

The app is a Next.js 16 standalone SPA using Prisma with SQLite. Development runs with Bun/Next on port `6500`. Production runs the standalone Next server on port `6501` after release, backup, audit, test, and smoke gates pass.

## Current Deployment Status

As of the current worktree, production deploy is intentionally gated. The local tree is clean, but `npm run check:release` still blocks until these release-state items are handled:

- The branch is ahead of `origin/main`; publish or otherwise reconcile the release branch.
- Secret-looking tokens exist in git history in `opencode.json` and `scripts/run-pipeline-direct.ts`. Rotate the exposed credentials first, then either rewrite remote history or run with `ALLOW_ROTATED_SECRET_HISTORY=true` and `ROTATED_SECRET_HISTORY_AT=<UTC ISO-8601 timestamp>`.

Do not deploy until `npm run check:release` passes.

## Prerequisites

- macOS or Linux shell with Bash.
- Bun `1.3.11`.
- Node.js available for production standalone start. The production start script defaults to `node`.
- Docker and Docker Compose for optional sidecars.
- Python 3.11 or 3.13 for Python audit and TradingAgents checks.
- SQLite database file at the path configured by `DATABASE_URL`.

## Important Ports

| Service | Host URL | Container/Internal URL | Purpose |
| --- | --- | --- | --- |
| Next dev app | `http://localhost:6500` | n/a | Development UI/API |
| Next standalone app | `http://localhost:6501` | n/a | Production UI/API |
| Caddy reverse proxy | `http://localhost:6502` | proxies `localhost:6501` | Optional proxy |
| SearXNG | `http://localhost:8888` | `http://searxng:8080` | Search/research |
| TradingAgents | `http://localhost:6503` | `http://tradingagents:8100` | Multi-agent research API |
| Agent-Reach | `http://localhost:6504` | `http://agent-reach:6656` | MCP-style research bridge |
| Local OpenAI-compatible LLM default | `http://localhost:4444/v1` | `http://host.docker.internal:4444/v1` | LLM proxy/backend |
| Current local LLM route in `.env` | `https://9router.tail1ac290.ts.net/v1` | same externally reachable URL | Current configured OpenAI-compatible endpoint |

Sidecar ports in `docker-compose.yml` bind to `127.0.0.1` only. Keep them loopback-bound for production unless a separate trusted reverse proxy and auth layer is added.

## Environment Files

The scripts read env values in this order:

1. Existing shell environment variables.
2. `.env.production` if present.
3. `.env`.

Use `.env.example` as the template. Do not commit `.env` or `.env.production`.

### Current `.env.example`

```bash
DATABASE_URL=file:./db/custom.db
PORT=6501
LOCAL_DEV_AUTH_BYPASS=false
ENABLE_RESET_API=false
ENABLE_TEST_API=false
ENABLE_DBTEST_API=false
AUTO_START_PIPELINE_WORKER=false
PIPELINE_WORKER_INTERVAL_MS=5000

TRADINGAGENTS_URL=http://localhost:6503
TA_LLM_PROVIDER=openai
TA_DEEP_THINK_LLM=frontier_flash
TA_QUICK_THINK_LLM=frontier_lite

OPENAI_BASE_URL=http://localhost:4444/v1
TRADINGAGENTS_LLM_BACKEND_URL=http://host.docker.internal:4444/v1
LLM_BASE_URL=http://localhost:4444/v1
LITELLM_BASE_URL=http://localhost:4444/v1

OPENAI_API_KEY=
TRADINGAGENTS_LLM_API_KEY=
LLM_API_KEY=
LITELLM_API_KEY=

ANTHROPIC_API_KEY=
GOOGLE_API_KEY=
AZURE_OPENAI_API_KEY=
XAI_API_KEY=
DEEPSEEK_API_KEY=
DASHSCOPE_API_KEY=
DASHSCOPE_CN_API_KEY=
ZHIPU_API_KEY=
ZHIPU_CN_API_KEY=
MINIMAX_API_KEY=
MINIMAX_CN_API_KEY=
OPENROUTER_API_KEY=

OLLAMA_BASE_URL=http://localhost:11434/v1
MIROFISH_BASE_URL=
QDRANT_BASE_URL=
SEARXNG_BASE_URL=http://localhost:8888
SEARXNG_URL=http://localhost:8888
TA_SEARXNG_URL=http://localhost:8888
MEM0_BASE_URL=
```

### Current Local `.env` Values

The current local `.env` uses these non-secret values:

```bash
DATABASE_URL="file:/Volumes/AppProjectStorage/application/project/tradingbot/tb/db/custom.db"
PORT=6501
LOCAL_DEV_AUTH_BYPASS=false
AUTO_START_PIPELINE_WORKER=false
ENABLE_TEST_API=false
ENABLE_DBTEST_API=false

TRADINGAGENTS_URL=http://localhost:6503
TA_LLM_PROVIDER=openai
TA_DEEP_THINK_LLM=free_pro
TA_QUICK_THINK_LLM=free_pro
OPENAI_BASE_URL=https://9router.tail1ac290.ts.net/v1
TRADINGAGENTS_LLM_BACKEND_URL=https://9router.tail1ac290.ts.net/v1
LLM_BASE_URL=https://9router.tail1ac290.ts.net/v1
LITELLM_BASE_URL=https://9router.tail1ac290.ts.net/v1
OPENAI_API_KEY=
TRADINGAGENTS_LLM_API_KEY=
LLM_API_KEY=
LITELLM_API_KEY=
ANTHROPIC_BASE_URL=
GEMINI_BASE_URL=

MIROFISH_BASE_URL=
OLLAMA_BASE_URL=
QDRANT_BASE_URL=
SEARXNG_BASE_URL=http://localhost:8888
SEARXNG_URL=http://localhost:8888
TA_SEARXNG_URL=http://localhost:8888
MEM0_BASE_URL=
AGENT_REACH_URL=http://localhost:6504
SEARXNG_SECRET_KEY=<set locally, redacted>
```

`SEARXNG_SECRET_KEY` is required for production and must be at least 32 characters. Generate it with:

```bash
openssl rand -hex 32
```

## Development Setup

1. Install dependencies:

```bash
bun install
```

2. Create local env:

```bash
cp .env.example .env
```

3. Set the database URL. For a repo-local SQLite DB:

```bash
DATABASE_URL=file:./db/custom.db
```

For the current absolute local path style:

```bash
DATABASE_URL="file:/Volumes/AppProjectStorage/application/project/tradingbot/tb/db/custom.db"
```

4. Generate Prisma client:

```bash
npm run db:generate
```

5. Push schema if the DB needs initialization:

```bash
npm run db:push
```

6. Start optional sidecars:

```bash
npm run docker:up
```

This starts SearXNG, TradingAgents, and Agent-Reach. Docker Compose requires `SEARXNG_SECRET_KEY` to be set.

7. Start the app:

```bash
npm run dev
```

Open `http://localhost:6500`.

## Development Without Docker

You can run the Next app without sidecars. In that case:

- Research providers that require SearXNG, TradingAgents, or Agent-Reach will degrade or be unavailable.
- Keep `TRADINGAGENTS_URL=http://localhost:6503` and `AGENT_REACH_URL=http://localhost:6504` as placeholders, or point them to separately running services.
- Use the Credential Manager UI for venue API keys instead of storing venue keys in `.env`.

Run:

```bash
bun install
npm run db:generate
npm run dev
```

## Local Sidecar Health Checks

After `npm run docker:up`, verify:

```bash
curl http://localhost:8888
curl http://localhost:6503/health
curl http://localhost:6504/health
```

TradingAgents bridge smoke:

```bash
npm run test:tradingagents
```

Container image smoke after building:

```bash
npm run check:containers
npm run smoke:tradingagents-image
```

## Production Environment

For production, create `.env.production` on the host and keep it out of git.

Minimum required production values:

```bash
DATABASE_URL=file:./db/custom.db
PORT=6501
LOCAL_DEV_AUTH_BYPASS=false
ENABLE_RESET_API=false
ENABLE_TEST_API=false
ENABLE_DBTEST_API=false
ALLOW_ANY_TARGET=false
AUTO_START_PIPELINE_WORKER=false
AUTO_START_PAPER_ORDER_LOOP=false
SEARXNG_SECRET_KEY=<random 32+ character secret>

TRADINGAGENTS_URL=http://localhost:6503
AGENT_REACH_URL=http://localhost:6504
SEARXNG_URL=http://localhost:8888
SEARXNG_BASE_URL=http://localhost:8888
TA_SEARXNG_URL=http://localhost:8888

TA_LLM_PROVIDER=openai
TA_DEEP_THINK_LLM=frontier_flash
TA_QUICK_THINK_LLM=frontier_lite
OPENAI_BASE_URL=http://localhost:4444/v1
TRADINGAGENTS_LLM_BACKEND_URL=http://host.docker.internal:4444/v1
LLM_BASE_URL=http://localhost:4444/v1
LITELLM_BASE_URL=http://localhost:4444/v1
OPENAI_API_KEY=<only if required by your LLM endpoint>
```

If using the current external LLM endpoint instead of a local proxy:

```bash
OPENAI_BASE_URL=https://9router.tail1ac290.ts.net/v1
TRADINGAGENTS_LLM_BACKEND_URL=https://9router.tail1ac290.ts.net/v1
LLM_BASE_URL=https://9router.tail1ac290.ts.net/v1
LITELLM_BASE_URL=https://9router.tail1ac290.ts.net/v1
TA_DEEP_THINK_LLM=free_pro
TA_QUICK_THINK_LLM=free_pro
```

If your endpoint requires authentication, set the matching key in the host environment or `.env.production`. Do not hardcode keys in source files.

## Production Preflight

Run these before building or starting production:

```bash
npm run check:release
npm run check:db-backup
bun audit --audit-level high
npm run typecheck
npm run lint
npm run test
```

Full predeploy:

```bash
npm run check:predeploy
```

`check:predeploy` also runs TradingAgents tests, Python dependency audit, production build, standalone smoke, Docker image build, and TradingAgents image smoke.

If Docker is unavailable and you intentionally want to skip compose image checks:

```bash
SKIP_COMPOSE_BUILD=true npm run check:predeploy
```

Use that only when the images are built and verified elsewhere.

## Database Backup

Create a backup before production start:

```bash
bash scripts/backup-db.sh
```

Verify backup freshness and SQLite integrity:

```bash
npm run check:db-backup
```

The backup checker expects a non-empty `db/backups/custom-*.db` backup that is newer than the active SQLite DB and not older than `DB_BACKUP_MAX_AGE_SECONDS` (default `86400`).

## Production Build

Build the standalone app:

```bash
npm run build
```

The build script:

- Runs `npx tsc --noEmit`.
- Runs `next build`.
- Copies `.next/static` into `.next/standalone/.next/static`.
- Copies `public` into `.next/standalone/public`.

## Production Start

Preferred production start:

```bash
npm run start
```

This runs `scripts/start-standalone.sh`, which:

1. Runs `npm run check:release`.
2. Runs `npm run check:db-backup`.
3. Verifies `.next/standalone/server.js`, `.next/static`, and `public`.
4. Copies static assets into the standalone directory.
5. Starts `server.js` with `NODE_ENV=production` and `PORT=6501`.

Legacy watchdog start:

```bash
./start.sh
```

`start.sh` also runs release and backup checks before touching the production port.

Manual standalone start after checks:

```bash
PORT=6501 NODE_ENV=production node .next/standalone/server.js
```

Use the script instead of manual start for real deployments.

## Standalone Smoke Test

After a build:

```bash
npm run smoke:standalone
```

The smoke test starts the standalone server on port `6502` by default and verifies:

- `/api` returns `200`.
- Dangerous endpoints `/api/reset`, `/api/dbtest`, `/api/test/sources`, and `/api/test/quick-sources` return `401`.
- Security headers are present.
- pipeline worker and paper loop auto-start logs show disabled by default.

## Optional Caddy Proxy

`Caddyfile` listens on `:6502` and proxies to `localhost:6501`.

Start Caddy from the repo root:

```bash
caddy run --config Caddyfile
```

Open:

```bash
http://localhost:6502
```

## External APIs and Credentials

Use the app Credential Manager for trading venue credentials. Do not store venue API keys in `.env`.

Environment variables for external APIs:

| Variable | Used by | Notes |
| --- | --- | --- |
| `OPENAI_BASE_URL` | Next app and TradingAgents | OpenAI-compatible endpoint |
| `OPENAI_API_KEY` | Next app and TradingAgents | Optional for local endpoints, required for hosted APIs |
| `TRADINGAGENTS_LLM_BACKEND_URL` | TradingAgents | Container-safe backend URL |
| `TRADINGAGENTS_LLM_API_KEY` | TradingAgents | Falls back to `OPENAI_API_KEY` in Compose |
| `LLM_BASE_URL` | LLM routing | OpenAI-compatible base URL |
| `LITELLM_BASE_URL` | LiteLLM routing | OpenAI-compatible base URL |
| `ANTHROPIC_API_KEY` | TradingAgents | Required only for Anthropic provider |
| `GOOGLE_API_KEY` | TradingAgents | Required only for Google provider |
| `AZURE_OPENAI_API_KEY` | TradingAgents | Required only for Azure provider |
| `XAI_API_KEY` | TradingAgents | Required only for xAI provider |
| `DEEPSEEK_API_KEY` | TradingAgents | Required only for DeepSeek provider |
| `DASHSCOPE_API_KEY` / `DASHSCOPE_CN_API_KEY` | TradingAgents | Qwen providers |
| `ZHIPU_API_KEY` / `ZHIPU_CN_API_KEY` | TradingAgents | GLM providers |
| `MINIMAX_API_KEY` / `MINIMAX_CN_API_KEY` | TradingAgents | MiniMax providers |
| `OPENROUTER_API_KEY` | TradingAgents | OpenRouter provider |
| `ALPHA_VANTAGE_API_KEY` | TradingAgents container | Optional finance data vendor |
| `FINNHUB_API_KEY` | TradingAgents container | Optional finance data vendor |
| `SEARXNG_SECRET_KEY` | Docker SearXNG | Required for production compose config |
| `AGENT_REACH_API_KEY` | TradingAgents to Agent-Reach | Optional if Agent-Reach is protected |

## Trading Modes

Current mode behavior:

- `DEMO`: mock data, simulated execution.
- `PAPER`: real market data, simulated execution. This is the production target for now.
- `LIVE`: real data and real execution mode, but live execution remains blocked until explicit governance is approved.

Production should stay in `PAPER` mode. The release hardening blocks:

- direct `LIVE_EXECUTE` job creation,
- worker starts with `mode: "LIVE"`,
- legacy `dryRun: false` worker starts.

## Dangerous Endpoints

These endpoints are disabled unless explicitly enabled and authorized:

- `/api/reset`: requires `ENABLE_RESET_API=true`.
- `/api/dbtest`: requires `ENABLE_DBTEST_API=true`.
- `/api/test/sources` and `/api/test/quick-sources`: production check requires `ENABLE_TEST_API` not be true.

Keep all of these disabled in production except during controlled maintenance windows.

## Common Deployment Recipes

### Development, App Only

```bash
bun install
cp .env.example .env
npm run db:generate
npm run db:push
npm run dev
```

Open `http://localhost:6500`.

### Development, Full Local Services

```bash
export SEARXNG_SECRET_KEY="$(openssl rand -hex 32)"
bun install
npm run docker:up
npm run db:generate
npm run db:push
npm run dev
```

Open:

- App: `http://localhost:6500`
- SearXNG: `http://localhost:8888`
- TradingAgents: `http://localhost:6503/health`
- Agent-Reach: `http://localhost:6504/health`

### Production, Single Host

```bash
cp .env.example .env.production
# edit .env.production with production values
export SEARXNG_SECRET_KEY="$(openssl rand -hex 32)"

bun install --frozen-lockfile
npm run db:generate
npm run db:push
npm run docker:up
bash scripts/backup-db.sh
npm run check:predeploy
npm run start
```

Open `http://localhost:6501` or proxy through Caddy on `http://localhost:6502`.

### Production, Existing External LLM Endpoint

Use this when an OpenAI-compatible endpoint already exists at the current external route:

```bash
OPENAI_BASE_URL=https://9router.tail1ac290.ts.net/v1
TRADINGAGENTS_LLM_BACKEND_URL=https://9router.tail1ac290.ts.net/v1
LLM_BASE_URL=https://9router.tail1ac290.ts.net/v1
LITELLM_BASE_URL=https://9router.tail1ac290.ts.net/v1
TA_LLM_PROVIDER=openai
TA_DEEP_THINK_LLM=free_pro
TA_QUICK_THINK_LLM=free_pro
```

Then run the normal production preflight and start flow.

## Troubleshooting

### `check:release` fails on branch divergence

The release gate requires a clean branch with no ahead/behind divergence from upstream. Publish or reconcile the branch before deployment.

```bash
git status --short --branch
```

### `check:release` fails on historical secrets

Rotate the exposed credentials first. Then choose one:

- rewrite remote history to remove the secret-bearing commits, or
- document the rotation and run release with:

```bash
ALLOW_ROTATED_SECRET_HISTORY=true \
ROTATED_SECRET_HISTORY_AT=2026-05-26T00:00:00Z \
npm run check:release
```

Use the actual UTC rotation time.

### `check:production` fails on SearXNG secret

Set a real secret:

```bash
export SEARXNG_SECRET_KEY="$(openssl rand -hex 32)"
```

Or put it in `.env.production`.

### Standalone start fails with missing static assets

Run:

```bash
npm run build
```

The scripts copy static assets automatically, but the standalone build must exist first.

### Sidecars are unreachable from containers

Use container-internal hostnames inside Compose:

- `http://searxng:8080`
- `http://agent-reach:6656`
- `http://tradingagents:8100`

Use host URLs from the Next app:

- `http://localhost:8888`
- `http://localhost:6504`
- `http://localhost:6503`

### Direct URL proxy testing fails

`ALLOW_ANY_TARGET=true` is blocked by production checks. Use it only in local development if you understand the SSRF risk.
