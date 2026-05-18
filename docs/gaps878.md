# Paper Mode Verification — gaps878.md

**Date**: 2026-05-18  
**System**: Trading Command Center  
**Mode**: PAPER (live Kalshi via Netlify proxy)

---

## ✅ Infrastructure Fixes Applied

| Fix | Status | Details |
|-----|--------|---------|
| Market dedup (in-cycle) | ✅ | `scanner.ts` — `Set<titleHash>` per scan |
| Market dedup (cross-cycle) | ✅ | `scanner-upsert.ts` — titleHash fallback |
| Orders API mismatch | ✅ | `lifecycleStatus` only, removed legacy `status` |
| Missing API routes | ✅ | `/api/mode`, `/api/operator`, `/api/positions`, `/api/market-loop` |
| AGENTS.md accuracy | ✅ | Route list, model count, Known Issues |
| DB duplication cleanup | ✅ | 4836→120 markets, 4259 TradeCandidate rows purged |
| Netlify proxy deployed | ✅ | `market-venue-proxy.netlify.app` — Polymarket + Kalshi |
| Kalshi URL | ✅ | `external-api.kalshi.com` (recommended) |
| Proxy Settings in DB | ✅ | `polymarket_proxy_url`, `kalshi_proxy_url` |
| Dynamic venue base URL | ✅ | `getPolymarketBaseUrl()`, `getKalshiBaseUrl()` |
| Typecheck | ✅ | `tsc --noEmit` — 0 errors |

---

## ⚠️ Remaining Issues

| Issue | Severity | Root Cause |
|-------|----------|------------|
| **Scanner returns 0 markets** | 🔴 Critical | `paperMarketLoop` in simulation uses different scan path from `runScanner`. Proxy URL loaded but scan cycle not triggering fetch. Needs deep debugging in `src/lib/engine/simulation.ts` / worker. |
| **Polymarket DNS blocked** | 🟡 Medium | `clob.polymarket.com` NXDOMAIN from this network. Netlify proxy resolves it from US CDN — verified working externally. |
| **1 stale market in DB** | 🟢 Low | "Will a sitting US Senator switch parties" — pre-existing before proxy fix. |
| **Server port instability** | 🟡 Medium | Dev server on port 6500 drops connection after ~2min under load. |

---

## GUI Verification

| Page | Console Errors | Status |
|------|----------------|--------|
| Simulation Lab | 0 | ✅ PAPER badge, START/STOP |
| Strategy Hub | 0 | ✅ Configuration loaded |
| Credentials | 0 | ✅ 12 credentials |
| Market Triage | 0 | ✅ (1 stale market) |
| Outcomes | 0 | ✅ "No resolved outcomes" |
| Paper Bets | 0 | ✅ "No paper bets" |
| Paper Orders | 0 | ✅ |
| Risk | 0 | ✅ |
| Live Status | 0 | ✅ Agent monitoring |
| System Health | 0 | ✅ DB UP, services listed |
| Pipeline | 0 | ✅ |
| Prompt Studio | 0 | ✅ 7 templates |
| Research Ledger | 0 | ✅ |
| Backtests | 0 | ✅ |
| Calibration | 0 | ✅ |

**Total console errors**: 0 across all pages

---

## Pipeline Stages

| Stage | Status | Notes |
|-------|--------|-------|
| SCAN | ⚠️ | 0 markets — scanner path mismatch with proxy |
| TRIAGE | ⚠️ | Blocked by SCAN |
| RESEARCH | ⚠️ | Blocked by SCAN |
| JUDGE | ⚠️ | Blocked by SCAN |
| RISK | ⚠️ | Blocked by SCAN |
| EXECUTE | ⚠️ | Blocked by SCAN |

---

## Proxy Verification

| Venue | Direct Test | Proxy Test | Status |
|-------|-------------|------------|--------|
| Kalshi | ✅ JSON returned | ✅ Via Netlify | ✅ Working |
| Polymarket | ❌ DNS NXDOMAIN | ✅ Via Netlify | ✅ Proxy resolves |
| SearXNG | — | Pending | Redirects added |
| Firecrawl | — | Pending | Redirects added |

---

## Action Items

1. 🔴 **Debug scanner loop** — `src/lib/engine/simulation.ts` → `paperMarketLoop()` → trace why `runScanner` not called or proxy URL not loaded
2. 🟡 **Enable Kalshi scanner** — Verify strategy config loads from DB correctly into scanner
3. 🟡 **Add Polymarket proxy test** — Verify `/clob/markets` returns fresh data
4. 🟢 **Wire SearXNG/Firecrawl through proxy** — Settings keys exist, adapters need update
5. 🟢 **Fix dev server stability** — `reactStrictMode: false` polling patterns may cause memory pressure

---

## Test Commands

```bash
# Trigger manual scan
curl -X POST http://localhost:6500/api/market-loop -d '{"venues":["KALSHI"]}'

# Check proxy
curl https://market-venue-proxy.netlify.app/kalshi/markets?limit=2

# Check simulation
curl http://localhost:6500/api/simulation

# Check mode
curl http://localhost:6500/api/mode

# Typecheck
npx tsc --noEmit

# Health
curl http://localhost:6500/api/health
```
