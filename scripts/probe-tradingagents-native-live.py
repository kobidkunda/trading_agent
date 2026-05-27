#!/usr/bin/env python3
"""Opt-in live probe for the TradingAgents native graph.

This intentionally stays out of the default test suite because it calls the
configured live LLM router and can take several minutes.
"""

from __future__ import annotations

import json
import os
import sys
import time
from urllib import error, request


def env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def env_list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return default
    values = [item.strip().lower() for item in raw.split(",") if item.strip()]
    return values or default


def call_json(url: str, payload: dict, timeout: int) -> tuple[int, dict]:
    req = request.Request(
        url,
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=timeout) as response:
            body = response.read().decode("utf-8", "replace")
            return response.status, json.loads(body)
    except error.HTTPError as exc:
        body = exc.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"error": body[:2000]}
        return exc.code, parsed
    except error.URLError as exc:
        return 0, {"status": "failed", "error": f"Connection failed: {exc.reason}"}


def main() -> int:
    base_url = os.getenv("TRADINGAGENTS_URL", "http://localhost:6503").rstrip("/")
    native_timeout = env_int("TA_LIVE_NATIVE_TIMEOUT_SECONDS", 900)
    client_timeout = env_int("TA_LIVE_CLIENT_TIMEOUT_SECONDS", native_timeout + 45)
    query = os.getenv("TA_LIVE_QUERY", "Analyze AAPL for a short live TradingAgents probe.")
    asset_type = os.getenv("TA_LIVE_ASSET_TYPE", "stock")

    payload = {
        "query": query,
        "date": os.getenv("TA_LIVE_DATE", "2025-05-28"),
        "asset_type": asset_type,
        "llm_provider": os.getenv("TA_LLM_PROVIDER", "openai"),
        "deep_think_llm": os.getenv("TA_DEEP_THINK_LLM", "free_pro"),
        "quick_think_llm": os.getenv("TA_QUICK_THINK_LLM", "free_pro"),
        "selected_analysts": env_list("TA_LIVE_SELECTED_ANALYSTS", ["market"]),
        "max_debate_rounds": env_int("TA_LIVE_MAX_DEBATE_ROUNDS", 1),
        "max_risk_discuss_rounds": env_int("TA_LIVE_MAX_RISK_ROUNDS", 1),
        "max_recur_limit": env_int("TA_LIVE_MAX_RECUR_LIMIT", 35),
        "analyst_concurrency_limit": env_int("TA_LIVE_ANALYST_CONCURRENCY", 1),
        "news_article_limit": env_int("TA_LIVE_NEWS_LIMIT", 1),
        "global_news_article_limit": env_int("TA_LIVE_GLOBAL_NEWS_LIMIT", 1),
        "global_news_lookback_days": env_int("TA_LIVE_GLOBAL_NEWS_LOOKBACK_DAYS", 1),
        "llm_request_timeout_seconds": env_int("TA_LIVE_LLM_REQUEST_TIMEOUT_SECONDS", 90),
        "llm_request_max_attempts": env_int("TA_LIVE_LLM_REQUEST_MAX_ATTEMPTS", 1),
        "native_timeout_seconds": native_timeout,
        "clear_checkpoints": os.getenv("TA_LIVE_CLEAR_CHECKPOINTS", "true").lower()
        not in {"0", "false", "no", "off"},
        "checkpoint_enabled": os.getenv("TA_LIVE_CHECKPOINT_ENABLED", "false").lower()
        in {"1", "true", "yes", "on"},
    }

    started = time.time()
    status, body = call_json(f"{base_url}/analyze/native", payload, client_timeout)
    elapsed = round(time.time() - started, 2)

    summary = {
        "http_status": status,
        "status": body.get("status"),
        "elapsed_seconds": elapsed,
        "ticker": body.get("ticker"),
        "asset_type": body.get("asset_type"),
        "signal": body.get("signal"),
        "confidence": body.get("confidence"),
        "probability": body.get("probability"),
        "error": body.get("error"),
        "has_full_report": isinstance(body.get("full_report"), dict),
        "has_technical": isinstance(body.get("technical"), dict),
        "has_trader": isinstance(body.get("trader"), dict),
        "has_portfolio_manager": isinstance(body.get("portfolio_manager"), dict),
    }
    print(json.dumps(summary, indent=2, sort_keys=True))

    if status != 200 or body.get("status") != "completed":
        return 1
    required = ("ticker", "asset_type", "signal", "full_report")
    missing = [key for key in required if not body.get(key)]
    if missing:
        print(json.dumps({"missing_required_fields": missing}, indent=2), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
