#!/usr/bin/env python3
"""Executable coverage audit for upstream TradingAgents config/features."""

import ast
import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTAINER = "tcc-tradingagents"

UPSTREAM_TO_REQUEST = {
    "llm_provider": "llm_provider",
    "deep_think_llm": "deep_think_llm",
    "quick_think_llm": "quick_think_llm",
    "backend_url": "llm_base_url",
    "google_thinking_level": "google_thinking_level",
    "openai_reasoning_effort": "openai_reasoning_effort",
    "anthropic_effort": "anthropic_effort",
    "checkpoint_enabled": "checkpoint_enabled",
    "output_language": "output_language",
    "max_debate_rounds": "max_debate_rounds",
    "max_risk_discuss_rounds": "max_risk_discuss_rounds",
    "max_recur_limit": "max_recur_limit",
    "analyst_concurrency_limit": "analyst_concurrency_limit",
    "news_article_limit": "news_article_limit",
    "global_news_article_limit": "global_news_article_limit",
    "global_news_lookback_days": "global_news_lookback_days",
    "global_news_queries": "global_news_queries",
    "data_vendors": "data_vendors",
    "tool_vendors": "tool_vendors",
    "benchmark_ticker": "benchmark_ticker",
    "benchmark_map": "benchmark_map",
    "memory_log_max_entries": "memory_log_max_entries",
}

BRIDGE_MANAGED_UPSTREAM_KEYS = {
    "project_dir",
    "results_dir",
    "data_cache_dir",
    "memory_log_path",
}

STAGE_ROUTING_FIELDS = {
    "llm_provider": "analystLlmProvider",
    "deep_think_llm": "analystDeepThinkLlm",
    "quick_think_llm": "analystQuickThinkLlm",
    "google_thinking_level": "analystGoogleThinkingLevel",
    "openai_reasoning_effort": "analystOpenAIReasoningEffort",
    "anthropic_effort": "analystAnthropicEffort",
    "checkpoint_enabled": "analystCheckpointEnabled",
    "output_language": "analystOutputLanguage",
    "max_debate_rounds": "analystMaxDebateRounds",
    "max_risk_discuss_rounds": "analystMaxRiskRounds",
    "max_recur_limit": "analystMaxRecurLimit",
    "analyst_concurrency_limit": "analystConcurrencyLimit",
    "news_article_limit": "analystNewsArticleLimit",
    "global_news_article_limit": "analystGlobalNewsArticleLimit",
    "global_news_lookback_days": "analystGlobalNewsLookbackDays",
    "global_news_queries": "analystGlobalNewsQueries",
    "data_vendors": [
        "analystCoreStockVendor",
        "analystTechnicalIndicatorsVendor",
        "analystFundamentalDataVendor",
        "analystNewsDataVendor",
    ],
    "tool_vendors": "analystToolVendorOverrides",
    "benchmark_ticker": "analystBenchmarkTicker",
    "benchmark_map": "analystBenchmarkMap",
    "memory_log_max_entries": "analystMemoryLogMaxEntries",
}

NON_CONFIG_REQUEST_FEATURES = {
    "asset_type",
    "selected_analysts",
    "clear_checkpoints",
}


def upstream_default_keys() -> set[str]:
    probe = (
        "from tradingagents.default_config import DEFAULT_CONFIG; "
        "import json; print(json.dumps(sorted(DEFAULT_CONFIG.keys())))"
    )
    completed = subprocess.run(
        ["docker", "exec", CONTAINER, "python", "-c", probe],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=60,
    )
    return set(json.loads(completed.stdout))


def analyze_request_fields() -> set[str]:
    tree = ast.parse((ROOT / "ta-service" / "server.py").read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "AnalyzeRequest":
            return {
                stmt.target.id
                for stmt in node.body
                if isinstance(stmt, ast.AnnAssign) and isinstance(stmt.target, ast.Name)
            }
    raise AssertionError("AnalyzeRequest class not found")


def stage_routing_fields() -> set[str]:
    text = (ROOT / "src" / "lib" / "types" / "index.ts").read_text(encoding="utf-8")
    match = re.search(r"export interface StageServiceMapping \{(?P<body>.*?)\n\}", text, re.S)
    if not match:
        raise AssertionError("StageServiceMapping interface not found")
    return set(re.findall(r"^\s*([A-Za-z0-9_]+)\??:", match.group("body"), re.M))


def main() -> None:
    upstream_keys = upstream_default_keys()
    request_fields = analyze_request_fields()
    routing_fields = stage_routing_fields()

    unexpected = upstream_keys - set(UPSTREAM_TO_REQUEST) - BRIDGE_MANAGED_UPSTREAM_KEYS
    assert not unexpected, f"upstream DEFAULT_CONFIG keys need coverage classification: {sorted(unexpected)}"

    missing_request = {
        upstream_key: request_key
        for upstream_key, request_key in UPSTREAM_TO_REQUEST.items()
        if request_key not in request_fields
    }
    assert not missing_request, f"AnalyzeRequest missing upstream config fields: {missing_request}"

    missing_non_config = sorted(NON_CONFIG_REQUEST_FEATURES - request_fields)
    assert not missing_non_config, f"AnalyzeRequest missing non-config upstream features: {missing_non_config}"

    missing_routing: dict[str, object] = {}
    for upstream_key, routing_key in STAGE_ROUTING_FIELDS.items():
        expected = routing_key if isinstance(routing_key, list) else [routing_key]
        absent = [field for field in expected if field not in routing_fields]
        if absent:
            missing_routing[upstream_key] = absent
    assert not missing_routing, f"StageServiceMapping missing upstream config fields: {missing_routing}"

    print(
        "upstream config coverage ok: "
        f"default_config_keys={len(upstream_keys)} "
        f"request_fields={len(request_fields)} "
        f"stage_routing_fields={len(routing_fields)}"
    )


if __name__ == "__main__":
    main()
