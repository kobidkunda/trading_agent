# TradingAgents LLM Env Configuration

Use env as the default source of truth for manual LLM configuration. UI credentials still work, but they override these env values when saved.

## Common Variables

```bash
TRADINGAGENTS_URL=http://localhost:6503

TA_LLM_PROVIDER=openai
TA_DEEP_THINK_LLM=frontier_flash
TA_QUICK_THINK_LLM=frontier_lite

OPENAI_BASE_URL=http://localhost:4444/v1
TRADINGAGENTS_LLM_BACKEND_URL=http://host.docker.internal:4444/v1
TRADINGAGENTS_UPSTREAM_LLM_BACKEND_URL=http://host.docker.internal:4444/v1
TRADINGAGENTS_NORMALIZE_LLM_RESPONSES=true
TRADINGAGENTS_NATIVE_TIMEOUT_SECONDS=360
TRADINGAGENTS_LLM_API_KEY=
```

Restart the Next dev server and recreate the TradingAgents container after changing `.env`.

```bash
docker compose up -d tradingagents
npm run dev
```

## LiteLLM

```bash
TA_LLM_PROVIDER=openai
TA_DEEP_THINK_LLM=frontier_flash
TA_QUICK_THINK_LLM=frontier_lite
OPENAI_BASE_URL=http://localhost:4444/v1
TRADINGAGENTS_LLM_BACKEND_URL=http://host.docker.internal:4444/v1
TRADINGAGENTS_LLM_API_KEY=your-litellm-key
```

`TRADINGAGENTS_NORMALIZE_LLM_RESPONSES=true` routes native upstream TradingAgents calls through the bridge's local OpenAI-compatible `/v1/chat/completions` proxy. The proxy forwards to `TRADINGAGENTS_UPSTREAM_LLM_BACKEND_URL` and normalizes common router quirks such as SSE-style bodies, trailing `data: [DONE]`, and `reasoning_content` without `content`.

`TRADINGAGENTS_NATIVE_TIMEOUT_SECONDS` bounds `/analyze/native` graph execution. Strategy Hub can override this per routing profile with the Native Timeout control.

## Ollama

```bash
TA_LLM_PROVIDER=ollama
TA_DEEP_THINK_LLM=qwen3:latest
TA_QUICK_THINK_LLM=qwen3:latest
OLLAMA_BASE_URL=http://host.docker.internal:11434/v1
```

## OpenRouter

```bash
TA_LLM_PROVIDER=openrouter
TA_DEEP_THINK_LLM=openai/gpt-5.5
TA_QUICK_THINK_LLM=openai/gpt-5.4-mini
OPENROUTER_API_KEY=your-openrouter-key
```

## Direct Provider

Set `TA_LLM_PROVIDER` to the provider id and use the matching key:

```bash
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
```

## Smoke Test

```bash
curl http://localhost:6503/health
npm run test:tradingagents
```

## Live Native Probe

The live native probe calls the configured LLM router and may run for several minutes:

```bash
npm run test:tradingagents:live
```

Useful overrides:

```bash
TA_LIVE_QUERY="Analyze AAPL for a short live TradingAgents probe."
TA_LIVE_SELECTED_ANALYSTS=market
TA_LIVE_NATIVE_TIMEOUT_SECONDS=420
TA_LIVE_MAX_RECUR_LIMIT=35
```
