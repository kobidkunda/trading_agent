#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${TRADINGAGENTS_URL:-http://localhost:6503}"

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  if [[ -n "$body" ]]; then
    curl -sS -m 30 -X "$method" "$BASE_URL$path" \
      -H 'Content-Type: application/json' \
      -d "$body"
  else
    curl -sS -m 30 -X "$method" "$BASE_URL$path"
  fi
}

echo "Smoking TradingAgents bridge at $BASE_URL"

health="$(request GET /health)"
python3 - "$health" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
assert payload.get("status") == "healthy", payload
assert payload.get("service") == "tradingagents-api", payload
print(f"health ok: {payload.get('service')} v{payload.get('version')}")
PY

models="$(request GET /models)"
python3 - "$models" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
providers = {item.get("id") for item in payload.get("providers", [])}
models = {item.get("id") for item in payload.get("models", [])}
required_providers = {
    "openai", "google", "anthropic", "xai", "deepseek",
    "qwen", "qwen-cn", "glm", "glm-cn", "minimax",
    "minimax-cn", "openrouter", "ollama", "azure",
}
missing = sorted(required_providers - providers)
assert not missing, f"missing providers: {missing}"
assert models, "expected at least one model option"
print(f"models ok: providers={len(providers)} models={len(models)}")
if payload.get("warning"):
    print(f"models warning: {payload['warning']}")
PY

for endpoint in /analyze/all /analyze/native; do
  validation="$(request POST "$endpoint" '{}')"
  python3 - "$endpoint" "$validation" <<'PY'
import json
import sys

endpoint = sys.argv[1]
payload = json.loads(sys.argv[2])
detail = payload.get("detail", [])
assert any(item.get("loc") == ["body", "query"] for item in detail), payload
print(f"{endpoint} mounted: query validation ok")
PY
done

if [[ "${TA_SMOKE_LIVE:-0}" == "1" ]]; then
  request POST /analyze/native '{
    "query": "Will Bitcoin outperform SPY this week?",
    "date": "2026-05-26",
    "asset_type": "crypto",
    "llm_provider": "ollama",
    "deep_think_llm": "qwen3:latest",
    "quick_think_llm": "qwen3:latest",
    "max_debate_rounds": 1,
    "max_risk_discuss_rounds": 1
  }' | python3 -m json.tool
fi
