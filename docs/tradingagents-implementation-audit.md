# TradingAgents Implementation Audit

Updated: 2026-05-28

Upstream reference: `TauricResearch/TradingAgents` main at `61522e103e61601c553b4544abcd53fa7ebf9f1d` (`v0.2.5`).

## Upstream v0.2.5 Requirement Coverage

| Upstream feature | Local evidence |
| --- | --- |
| Native `TradingAgentsGraph.propagate()` package API | `/analyze/native` calls the installed graph with ticker, date, and `asset_type`; fake-LLM smoke completes real upstream graph runs for BTC and `7203.T`. |
| Analyst, researcher, trader, risk, and portfolio-manager report shape | Native responses map fundamentals, sentiment, news, technical, bull/bear researcher, trader, risk manager, portfolio manager, final report, signal, confidence, and probability. |
| Grounded sentiment analyst | The app consumes upstream native `sentiment_report`; simple analysis also merges Reddit/X/Agent-Reach social evidence instead of fabricating social context. |
| Provider catalog and model coverage | `/models` loads the installed upstream model catalog and exposes OpenAI, Google, Anthropic, xAI, DeepSeek, Qwen, Qwen China, GLM, GLM China, MiniMax, MiniMax China, OpenRouter, Ollama, and Azure. |
| Dual-region provider API keys | Native contract covers provider-family key forwarding for every upstream provider key family and restores sensitive env vars after graph construction. |
| Remote/proxied LLM endpoint support | Next forwards configured LLM base URL/API key per request; bridge sets upstream `backend_url` and provider-specific env keys. Ollama can use `backend_url` or upstream `OLLAMA_BASE_URL`. Live proof completed through `https://9router.tail1ac290.ts.net/v1` with `free_pro`. |
| Debate/risk rounds, recursion, concurrency | Strategy Hub persists the controls; Next forwards them; bridge injects them into upstream config; contract and fake-LLM tests assert config passthrough. |
| Analyst selection | Strategy Hub persists selected market/sentiment/news/fundamentals analysts; Next forwards `selected_analysts`; bridge constructs `TradingAgentsGraph(selected_analysts=...)`; contract and fake-LLM tests assert passthrough. |
| Multi-language output | Strategy Hub persists output language; Next forwards it; fake-LLM smoke proves Spanish and Japanese prompts reach the upstream graph. |
| Checkpoint resume | Strategy Hub persists checkpoint enablement; fake-LLM smoke performs repeated checkpoint-enabled BTC runs; checkpoint DB files are created and cleared on success by upstream. |
| Checkpoint clearing | Native bridge accepts `clear_checkpoints` and invokes upstream `clear_all_checkpoints()` before graph construction; native contract test proves the helper receives the active data-cache directory. It is intentionally request-only instead of a persisted Strategy Hub toggle. |
| Persistent decision log | Container-backed memory-log test proves pending decision storage, resolved return/alpha/reflection update, and `get_past_context()` injection; bridge stores memory under the `/app/data` volume and forwards optional memory-log rotation cap. |
| Configurable news fetching | Strategy Hub persists ticker news limit, macro news limit, lookback days, and macro queries; Next/bridge forward them; fake-LLM smoke asserts the resulting config. |
| Non-US benchmark alpha | Strategy Hub persists explicit benchmark and benchmark-map overrides; fake-LLM smoke completes `7203.T` with `benchmark_ticker=^N225`; bridge merges map overrides with upstream regional defaults. |
| Provider-specific thinking controls | Strategy Hub persists OpenAI reasoning effort, Google thinking level, and Anthropic effort; Next/bridge forward them into upstream config; contract test asserts passthrough. |
| Data vendor/tool vendor config | Strategy Hub persists category data vendors and tool-level overrides; Next/bridge forward `data_vendors` and `tool_vendors`; contract test asserts passthrough. |
| Exchange-qualified ticker/path hardening | Native contract proves extraction preserves `AAPL`, `$TSLA`, and `7203.T`; upstream package handles path-safe cache/log components. |
| Host-date/future-window hardening | Runtime patch clamps upstream OHLCV downloads to the requested trade date and keeps future return resolution pending instead of querying unavailable future Yahoo windows. |
| Future upstream config drift | `scripts/test-tradingagents-upstream-config-coverage.py` introspects installed upstream `DEFAULT_CONFIG`, local `AnalyzeRequest`, and `StageServiceMapping` to fail if a new upstream user-facing config key lacks bridge/UI coverage classification. |

## Covered In This App

- Native graph execution: `ta-service/server.py` exposes `/analyze/native` and calls `TradingAgentsGraph.propagate(ticker, date, asset_type)`.
- Installed upstream version: the rebuilt `tcc-tradingagents` container reports `tradingagents_version=0.2.5` from `/health`, matching upstream `pyproject.toml`.
- Current graph output shape: native responses include analyst reports, investment debate, trader plan, risk debate, portfolio decision, full report, signal, confidence, and probability.
- Stock/crypto routing: callers can send `asset_type`; Strategy Hub exposes asset type; the service infers stock vs crypto when not supplied.
- Provider/model routing: app-stage routing forwards provider, deep model, quick model, and debate rounds.
- v0.2.5 config passthrough: app-stage routing can forward risk rounds, output language, checkpoint flag, benchmark ticker, recursion limit, analyst concurrency, news limits, macro lookback, and macro query list.
- v0.2.5 config UI: Strategy Hub exposes risk rounds, output language, asset type, benchmark ticker, recursion limit, analyst concurrency, ticker/macro news limits, macro lookback, checkpoint resume, and macro query list.
- Per-request LLM credentials: the Next app forwards the configured LLM base URL and API key to the TradingAgents bridge, and the bridge maps provider keys to the env vars expected by upstream clients.
- Per-request LLM request tuning: `/analyze/native` accepts `llm_request_timeout_seconds` and `llm_request_max_attempts`; Strategy Hub and the live probe can tune slow routers without rebuilding the container.
- Model metadata: the bridge reads the upstream model catalog when installed and merges it with a live `/models` probe.
- Runtime smoke: `npm run test:tradingagents` verifies `/health`, `/models`, `/analyze/all`, and `/analyze/native` against the running bridge container, then runs the real upstream native graph against a deterministic OpenAI-compatible fake LLM.
- Native contract proof: `scripts/test-tradingagents-native-contract.py` fakes the upstream `TradingAgentsGraph` and proves `/analyze/native` passes provider/model/config controls, forwards the provider API key only for graph construction, sends `asset_type` into `propagate`, maps a BUY signal to confidence/probability, and extracts `AAPL`, `$TSLA`, and `7203.T` correctly.
- Runtime patch proof: `scripts/test-tradingagents-runtime-patch.py` proves local compatibility patches clamp OHLCV downloads to requested trade dates and keep future return resolution pending.
- Provider-family matrix proof: the native contract covers OpenAI-compatible, Anthropic, Google, Azure, Ollama, OpenRouter, xAI, DeepSeek, Qwen, Qwen China, GLM, GLM China, MiniMax, and MiniMax China provider ids; each mapped provider gets its per-request key in the upstream env var expected by TradingAgents, and Ollama correctly receives no API-key env injection.
- Native graph proof: `scripts/smoke-tradingagents-native-fake-llm.py` proves the installed upstream `TradingAgentsGraph` can complete through `/analyze/native`; latest run returned completed crypto and non-US stock analyses with `crypto_signal=Buy`, `non_us_signal=Buy`, and 45 fake LLM requests.
- Checkpoint/output-language/benchmark proof: the fake-LLM smoke performs two checkpoint-enabled BTC native graph runs plus a `7203.T` stock run with `benchmark_ticker=^N225`, `output_language=Japanese`, and custom macro queries; returned `full_report.config` values match the requests, and the fake LLM receives both Spanish and Japanese prompts.
- Persistent memory-log proof: `scripts/test-tradingagents-memory-log.py` runs inside the rebuilt upstream container and proves `TradingMemoryLog` stores a pending BTC decision, resolves it with raw return, alpha return, holding days, and reflection, then injects that resolved entry into `get_past_context("BTC")`.
- Upstream config coverage proof: `scripts/test-tradingagents-upstream-config-coverage.py` proves all 26 installed upstream `DEFAULT_CONFIG` keys are either bridge-managed path keys or covered by request/StageServiceMapping fields, and also checks non-config features `asset_type`, `selected_analysts`, and `clear_checkpoints`.
- Advanced controls persistence proof: Strategy Hub save/reload was verified in browser/API against `http://localhost:6500/strategy-hub`; stale custom model values and v0.2.5 controls persisted for provider, deep/quick models, selected analysts, debate/risk rounds, output language, asset type, benchmark ticker/map, memory cap, recursion/concurrency limits, news limits, macro lookback, macro query list, provider thinking controls, data vendors, and tool-vendor overrides.
- FULL research path: `runFullResearch` runs simple TradingAgents evidence plus native graph for financial/crypto markets and returns `tradingagentsNative`.
- QUICK/DEEP path: pipeline TradingAgents calls now pass the same routing config and persist native graph output as `AgentOutput`.

## Runtime Proof Status

- End-to-end native graph execution with a production-grade reachable LLM backend is now proven. `npm run test:tradingagents:live` completed against the configured `9router` OpenAI-compatible endpoint with `free_pro`, returning `status=completed`, `ticker=AAPL`, `asset_type=stock`, `signal=Sell`, `confidence=0.6`, `probability=0.35`, and full report/technical/trader/portfolio-manager sections.

## Latest Verification Evidence

- `docker compose build --no-cache tradingagents` completed and installed `tradingagents==0.2.5`.
- `docker compose up -d tradingagents` recreated `tcc-tradingagents`.
- `curl http://localhost:6503/health` returned healthy service metadata with `tradingagents_version=0.2.5`.
- `docker compose build tradingagents && docker compose up -d tradingagents` rebuilt and recreated the bridge after ticker extraction changes.
- `docker compose build tradingagents && docker compose up -d tradingagents` rebuilt and recreated the bridge after provider-thinking and vendor-config passthrough changes.
- `docker compose build tradingagents && docker compose up -d tradingagents` rebuilt and recreated the bridge after selected-analyst, benchmark-map, memory-cap, and coverage-audit changes.
- `docker compose build tradingagents && docker compose up -d --force-recreate tradingagents` rebuilt and recreated the bridge after per-request LLM timeout controls and runtime future-window patches.
- `npm run test:tradingagents` passed, including route smoke, provider-family native contract test, real upstream native graph execution against a fake OpenAI-compatible LLM for BTC and `7203.T`, upstream memory-log pending/resolved/context proof, and upstream config coverage audit.
- `npm run test:tradingagents:live` passed against the configured `9router`/`free_pro` endpoint in 480.33s: HTTP 200, `status=completed`, `ticker=AAPL`, `asset_type=stock`, `signal=Sell`, `confidence=0.6`, `probability=0.35`, and required full-report sections present.
- `python3 -m py_compile ta-service/server.py scripts/test-tradingagents-native-contract.py scripts/smoke-tradingagents-native-fake-llm.py scripts/test-tradingagents-memory-log.py scripts/test-tradingagents-upstream-config-coverage.py` passed.
- `bun test src/lib/engine/__tests__/full-research.test.ts` passed.
- `npm run typecheck` passed.
- `git diff --check` passed.
- Playwright opened `http://localhost:6500/strategy-hub`; the page had no console warnings/errors and rendered the new OpenAI effort, Google thinking, Anthropic effort, data-vendor, and tool-vendor controls.
- Reversible `/api/strategy` persistence probe round-tripped the new advanced TradingAgents controls, then restored the original strategy settings.
- Playwright reopened `http://localhost:6500/strategy-hub`; the page had no console warnings/errors and rendered selected-analyst, benchmark-map, memory-cap, and tool-vendor controls.
- Reversible `/api/strategy` persistence probe round-tripped selected analysts, benchmark map, and memory cap, then restored the original strategy settings.
