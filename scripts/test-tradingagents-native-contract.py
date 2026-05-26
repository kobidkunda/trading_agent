#!/usr/bin/env python3
"""Contract-test the TradingAgents native bridge without a live LLM backend."""

import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
TA_SERVICE = ROOT / "ta-service"

sys.path.insert(0, str(TA_SERVICE))

captured: dict[str, object] = {}
graph_inits: list[dict[str, object]] = []


class FakeTradingAgentsGraph:
    def __init__(self, debug: bool, config: dict, selected_analysts: list[str] | None = None):
        captured["debug"] = debug
        captured["config"] = config
        captured["selected_analysts"] = selected_analysts
        captured["forwarded_openai_key"] = os.environ.get("OPENAI_API_KEY")
        graph_inits.append(
            {
                "debug": debug,
                "config": config.copy(),
                "selected_analysts": selected_analysts,
                "env": {
                    key: os.environ.get(key)
                    for key in (
                        "OPENAI_API_KEY",
                        "ANTHROPIC_API_KEY",
                        "GOOGLE_API_KEY",
                        "AZURE_OPENAI_API_KEY",
                        "XAI_API_KEY",
                        "DEEPSEEK_API_KEY",
                        "DASHSCOPE_API_KEY",
                        "DASHSCOPE_CN_API_KEY",
                        "ZHIPU_API_KEY",
                        "ZHIPU_CN_API_KEY",
                        "MINIMAX_API_KEY",
                        "MINIMAX_CN_API_KEY",
                        "OPENROUTER_API_KEY",
                    )
                },
            }
        )

    def propagate(self, ticker: str, trade_date: str, asset_type: str = "stock"):
        captured["propagate"] = {
            "ticker": ticker,
            "trade_date": trade_date,
            "asset_type": asset_type,
        }
        return (
            {
                "fundamentals_report": "fundamentals ok",
                "sentiment_report": "sentiment ok",
                "news_report": "news ok",
                "market_report": "technical ok",
                "trader_investment_plan": "plan ok",
                "investment_debate_state": {
                    "bull_history": "bull ok",
                    "bear_history": "bear ok",
                },
                "risk_debate_state": {"history": "risk ok"},
                "final_trade_decision": "BUY",
            },
            "BUY",
        )


def install_fake_tradingagents() -> None:
    package = types.ModuleType("tradingagents")
    graph_package = types.ModuleType("tradingagents.graph")
    graph_module = types.ModuleType("tradingagents.graph.trading_graph")
    checkpointer_module = types.ModuleType("tradingagents.graph.checkpointer")
    default_config_module = types.ModuleType("tradingagents.default_config")

    graph_module.TradingAgentsGraph = FakeTradingAgentsGraph

    def clear_all_checkpoints(data_dir: str) -> int:
        captured["clear_checkpoints_data_dir"] = data_dir
        return 1

    checkpointer_module.clear_all_checkpoints = clear_all_checkpoints
    default_config_module.DEFAULT_CONFIG = {
        "llm_provider": "openai",
        "backend_url": "http://default.invalid/v1",
        "deep_think_llm": "default-deep",
        "quick_think_llm": "default-quick",
        "max_debate_rounds": 2,
        "max_risk_discuss_rounds": 2,
        "output_language": "English",
        "checkpoint_enabled": False,
        "benchmark_ticker": "SPY",
        "max_recur_limit": 100,
    }

    sys.modules["tradingagents"] = package
    sys.modules["tradingagents.graph"] = graph_package
    sys.modules["tradingagents.graph.trading_graph"] = graph_module
    sys.modules["tradingagents.graph.checkpointer"] = checkpointer_module
    sys.modules["tradingagents.default_config"] = default_config_module


def load_server_module():
    spec = importlib.util.spec_from_file_location("ta_contract_server", TA_SERVICE / "server.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load ta-service/server.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["ta_contract_server"] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    install_fake_tradingagents()
    server = load_server_module()
    client = TestClient(server.app)
    os.environ["TRADINGAGENTS_DATA_DIR"] = tempfile.mkdtemp(prefix="ta-contract-")

    assert server.extract_ticker("Will AAPL beat earnings?") == "AAPL"
    assert server.extract_ticker("Analyze 7203.T against the Nikkei") == "7203.T"
    assert server.extract_ticker("Will $TSLA outperform QQQ?") == "TSLA"

    payload = {
        "query": "Will Bitcoin outperform SPY this week?",
        "date": "2026-05-26",
        "asset_type": "crypto",
        "llm_provider": "openai",
        "deep_think_llm": "fast",
        "quick_think_llm": "fast",
        "llm_base_url": "http://litellm.local/v1",
        "llm_api_key": "contract-secret",
        "max_debate_rounds": 1,
        "max_risk_discuss_rounds": 1,
        "output_language": "Spanish",
        "checkpoint_enabled": True,
        "selected_analysts": ["market", "news", "fundamentals"],
        "benchmark_ticker": "QQQ",
        "benchmark_map": {".T": "^N225", "": "SPY"},
        "max_recur_limit": 60,
        "memory_log_max_entries": 25,
        "analyst_concurrency_limit": 1,
        "news_article_limit": 2,
        "global_news_article_limit": 3,
        "global_news_lookback_days": 4,
        "global_news_queries": ["bitcoin macro", "spy weekly"],
        "openai_reasoning_effort": "high",
        "google_thinking_level": "minimal",
        "anthropic_effort": "medium",
        "data_vendors": {
            "core_stock_apis": "alpha_vantage",
            "technical_indicators": "yfinance",
            "fundamental_data": "alpha_vantage",
            "news_data": "yfinance",
        },
        "tool_vendors": {
            "get_stock_data": "alpha_vantage",
        },
        "clear_checkpoints": True,
    }

    response = client.post("/analyze/native", json=payload)
    body = response.json()

    assert response.status_code == 200, body
    assert body["status"] == "completed", body
    assert body["ticker"] == "BTC", body
    assert body["asset_type"] == "crypto", body
    assert body["signal"] == "BUY", body
    assert body["probability"] == 0.65, body

    config = captured["config"]
    assert isinstance(config, dict), captured
    expected_config = {
        "llm_provider": "openai",
        "backend_url": "http://litellm.local/v1",
        "deep_think_llm": "fast",
        "quick_think_llm": "fast",
        "max_debate_rounds": 1,
        "max_risk_discuss_rounds": 1,
        "output_language": "Spanish",
        "checkpoint_enabled": True,
        "benchmark_ticker": "QQQ",
        "benchmark_map": {".T": "^N225", "": "SPY"},
        "max_recur_limit": 60,
        "memory_log_max_entries": 25,
        "analyst_concurrency_limit": 1,
        "news_article_limit": 2,
        "global_news_article_limit": 3,
        "global_news_lookback_days": 4,
        "global_news_queries": ["bitcoin macro", "spy weekly"],
        "openai_reasoning_effort": "high",
        "google_thinking_level": "minimal",
        "anthropic_effort": "medium",
        "data_vendors": {
            "core_stock_apis": "alpha_vantage",
            "technical_indicators": "yfinance",
            "fundamental_data": "alpha_vantage",
            "news_data": "yfinance",
        },
        "tool_vendors": {
            "get_stock_data": "alpha_vantage",
        },
    }
    for key, value in expected_config.items():
        assert config.get(key) == value, (key, config.get(key), value)
    assert captured["selected_analysts"] == ["market", "news", "fundamentals"], captured
    assert captured["clear_checkpoints_data_dir"] == config["data_cache_dir"], captured

    assert captured["forwarded_openai_key"] == "contract-secret", captured
    assert captured["propagate"] == {
        "ticker": "BTC",
        "trade_date": "2026-05-26",
        "asset_type": "crypto",
    }, captured
    assert os.environ.get("OPENAI_API_KEY") != "contract-secret"

    os.environ["TRADINGAGENTS_LLM_API_KEY"] = "generic-env-secret"
    response = client.post(
        "/analyze/native",
        json={
            "query": "Will AAPL beat earnings?",
            "date": "2026-05-26",
            "asset_type": "stock",
            "llm_provider": "openai",
            "deep_think_llm": "env-deep",
            "quick_think_llm": "env-quick",
        },
    )
    body = response.json()
    assert response.status_code == 200, body
    assert graph_inits[-1]["env"]["OPENAI_API_KEY"] == "generic-env-secret", graph_inits[-1]
    assert os.environ.get("OPENAI_API_KEY") != "generic-env-secret"
    os.environ.pop("TRADINGAGENTS_LLM_API_KEY", None)

    provider_families = [
        "openai",
        "anthropic",
        "google",
        "azure",
        "ollama",
        "openrouter",
        "xai",
        "deepseek",
        "qwen",
        "qwen-cn",
        "glm",
        "glm-cn",
        "minimax",
        "minimax-cn",
    ]
    sensitive_env_names = set(server.PROVIDER_API_KEY_ENV.values())
    for env_name in sensitive_env_names:
        os.environ.pop(env_name, None)

    graph_inits.clear()
    for provider in provider_families:
        secret = f"secret-{provider}"
        response = client.post(
            "/analyze/native",
            json={
                "query": "Will AAPL beat earnings?",
                "date": "2026-05-26",
                "asset_type": "stock",
                "llm_provider": provider,
                "deep_think_llm": f"{provider}-deep",
                "quick_think_llm": f"{provider}-quick",
                "llm_base_url": f"http://{provider}.invalid/v1",
                "llm_api_key": secret,
            },
        )
        body = response.json()
        assert response.status_code == 200, body
        assert body["status"] == "completed", body
        init = graph_inits[-1]
        init_config = init["config"]
        init_env = init["env"]
        assert isinstance(init_config, dict), init
        assert isinstance(init_env, dict), init
        assert init["selected_analysts"] == ["market", "social", "news", "fundamentals"], init
        assert init_config.get("llm_provider") == provider, init_config
        assert init_config.get("deep_think_llm") == f"{provider}-deep", init_config
        assert init_config.get("quick_think_llm") == f"{provider}-quick", init_config
        assert init_config.get("backend_url") == f"http://{provider}.invalid/v1", init_config

        env_name = server.PROVIDER_API_KEY_ENV.get(provider)
        if env_name:
            assert init_env.get(env_name) == secret, (provider, env_name, init_env)
        else:
            assert provider == "ollama", provider
            assert secret not in init_env.values(), init_env

        for env_name in sensitive_env_names:
            assert os.environ.get(env_name) != secret, (provider, env_name)

    print(
        "native contract ok: config passthrough, provider matrix, key forwarding, "
        "asset_type propagation"
    )


if __name__ == "__main__":
    main()
