#!/usr/bin/env python3
"""Contract-test the TradingAgents native bridge without a live LLM backend."""

import importlib.util
import os
import sys
import tempfile
import types
from contextlib import contextmanager
from pathlib import Path

from fastapi.testclient import TestClient
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
TA_SERVICE = ROOT / "ta-service"

sys.path.insert(0, str(TA_SERVICE))

captured: dict[str, object] = {}
graph_inits: list[dict[str, object]] = []


@contextmanager
def temporary_env(overrides: dict[str, str | None]):
    previous = {key: os.environ.get(key) for key in overrides}
    try:
        for key, value in overrides.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        yield
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


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
        captured["propagate_env"] = {
            "TRADINGAGENTS_LLM_REQUEST_TIMEOUT_SECONDS": os.environ.get("TRADINGAGENTS_LLM_REQUEST_TIMEOUT_SECONDS"),
            "TRADINGAGENTS_LLM_REQUEST_MAX_ATTEMPTS": os.environ.get("TRADINGAGENTS_LLM_REQUEST_MAX_ATTEMPTS"),
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

    normalized_frame = server._normalize_ohlcv_columns(
        pd.DataFrame(
            {
                "index": ["2026-05-26"],
                "Close": [195.0],
                "High": [196.0],
                "Low": [194.0],
                "Open": [194.5],
                "Volume": [1000],
            }
        )
    )
    assert "Date" in normalized_frame.columns, normalized_frame
    assert "index" not in normalized_frame.columns, normalized_frame
    assert "sk-[redacted]" in server._sanitize_upstream_error("failed key sk-testSECRET123"), "secret not redacted"
    assert "Bearer [redacted]" in server._sanitize_upstream_error("Bearer abc.def_123"), "bearer not redacted"

    with temporary_env(
        {
            "TRADINGAGENTS_LLM_REQUEST_TIMEOUT_SECONDS": "12.5",
            "TRADINGAGENTS_LLM_REQUEST_MAX_ATTEMPTS": "4",
        }
    ):
        assert server._env_float("TRADINGAGENTS_LLM_REQUEST_TIMEOUT_SECONDS", 45.0) == 12.5
        assert server._env_int("TRADINGAGENTS_LLM_REQUEST_MAX_ATTEMPTS", 2) == 4

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
        "llm_request_timeout_seconds": 88.5,
        "llm_request_max_attempts": 1,
        "native_timeout_seconds": 90,
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
    assert captured["propagate_env"] == {
        "TRADINGAGENTS_LLM_REQUEST_TIMEOUT_SECONDS": "88.5",
        "TRADINGAGENTS_LLM_REQUEST_MAX_ATTEMPTS": "1",
    }, captured
    assert os.environ.get("OPENAI_API_KEY") != "contract-secret"
    assert os.environ.get("TRADINGAGENTS_LLM_REQUEST_TIMEOUT_SECONDS") != "88.5"
    assert os.environ.get("TRADINGAGENTS_LLM_REQUEST_MAX_ATTEMPTS") != "1"

    with temporary_env(
        {
            "TRADINGAGENTS_NORMALIZE_LLM_RESPONSES": "true",
            "TRADINGAGENTS_LLM_BACKEND_URL": "http://upstream-router.invalid/v1",
            "TRADINGAGENTS_UPSTREAM_LLM_BACKEND_URL": "http://upstream-router.invalid/v1",
        }
    ):
        response = client.post(
            "/analyze/native",
            json={
                "query": "Will AAPL beat earnings?",
                "date": "2026-05-26",
                "asset_type": "stock",
                "llm_provider": "openai",
                "deep_think_llm": "proxy-deep",
                "quick_think_llm": "proxy-quick",
                "native_timeout_seconds": 90,
            },
        )
        body = response.json()
        assert response.status_code == 200, body
        assert graph_inits[-1]["config"]["backend_url"] == server.LOCAL_LLM_PROXY_BASE_URL, graph_inits[-1]

    parsed = server._parse_llm_response_payload(
        '{"id":"chatcmpl-x","object":"chat.completion","choices":[{"index":0,'
        '"finish_reason":"stop","message":{"role":"assistant","content":null,'
        '"reasoning_content":"fallback text"}}]}data: [DONE]\n\n'
    )
    normalized = server._normalize_chat_completion_payload(parsed)
    assert normalized["choices"][0]["message"]["content"] == "fallback text", normalized

    parsed_sse = server._parse_llm_response_payload(
        'data: {"id":"chatcmpl-y","object":"chat.completion.chunk","model":"m",'
        '"choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n'
        'data: {"id":"chatcmpl-y","object":"chat.completion.chunk","model":"m",'
        '"choices":[{"index":0,"delta":{"reasoning_content":"reasoned answer"},'
        '"finish_reason":"stop"}]}\n\n'
        "data: [DONE]\n\n"
    )
    assert parsed_sse["object"] == "chat.completion", parsed_sse
    assert parsed_sse["choices"][0]["message"]["content"] == "reasoned answer", parsed_sse

    chat_payload = server._responses_payload_to_chat_payload(
        {
            "model": "free_pro",
            "input": [
                {"role": "system", "content": "Be brief."},
                {"role": "user", "content": [{"type": "input_text", "text": "Say OK"}]},
            ],
            "max_output_tokens": 12,
            "text": {"format": {"type": "json_object"}},
        }
    )
    assert chat_payload["messages"] == [
        {"role": "system", "content": "Be brief."},
        {"role": "user", "content": "Say OK"},
    ], chat_payload
    assert chat_payload["max_tokens"] == 12, chat_payload
    assert chat_payload["response_format"] == {"type": "json_object"}, chat_payload

    tool_chat_payload = server._responses_payload_to_chat_payload(
        {
            "model": "free_pro",
            "input": [
                {"role": "user", "content": [{"type": "input_text", "text": "Fetch AAPL"}]},
                {
                    "type": "function_call",
                    "call_id": "call_get_stock_data",
                    "name": "get_stock_data",
                    "arguments": '{"ticker":"AAPL"}',
                },
                {
                    "type": "function_call_output",
                    "call_id": "call_get_stock_data",
                    "output": "AAPL close 195.00",
                },
            ],
            "tools": [
                {
                    "type": "function",
                    "name": "get_stock_data",
                    "description": "Fetch stock prices",
                    "parameters": {
                        "type": "object",
                        "properties": {"ticker": {"type": "string"}},
                        "required": ["ticker"],
                    },
                }
            ],
            "tool_choice": {"type": "function", "name": "get_stock_data"},
        }
    )
    assert tool_chat_payload["tools"] == [
        {
            "type": "function",
            "function": {
                "name": "get_stock_data",
                "description": "Fetch stock prices",
                "parameters": {
                    "type": "object",
                    "properties": {"ticker": {"type": "string"}},
                    "required": ["ticker"],
                },
            },
        }
    ], tool_chat_payload
    assert tool_chat_payload["tool_choice"] == {
        "type": "function",
        "function": {"name": "get_stock_data"},
    }, tool_chat_payload
    assert tool_chat_payload["messages"][1]["tool_calls"][0]["function"] == {
        "name": "get_stock_data",
        "arguments": '{"ticker":"AAPL"}',
    }, tool_chat_payload
    assert tool_chat_payload["messages"][2] == {
        "role": "tool",
        "content": "AAPL close 195.00",
        "tool_call_id": "call_get_stock_data",
    }, tool_chat_payload

    response_payload = server._chat_completion_to_responses_payload(
        {
            "id": "chatcmpl-z",
            "created": 1779800000,
            "model": "free_pro",
            "choices": [
                {"message": {"role": "assistant", "content": "OK"}, "finish_reason": "stop"}
            ],
            "usage": {"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4},
        },
        {"model": "free_pro"},
    )
    assert response_payload["object"] == "response", response_payload
    assert response_payload["output"][0]["content"][0]["text"] == "OK", response_payload
    assert response_payload["usage"]["input_tokens"] == 3, response_payload

    tool_response_payload = server._chat_completion_to_responses_payload(
        {
            "id": "chatcmpl-tool",
            "created": 1779800002,
            "model": "free_pro",
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_get_stock_data",
                                "type": "function",
                                "function": {
                                    "name": "get_stock_data",
                                    "arguments": '{"ticker":"AAPL"}',
                                },
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ],
            "usage": {"prompt_tokens": 9, "completion_tokens": 4, "total_tokens": 13},
        },
        {"model": "free_pro"},
    )
    assert tool_response_payload["output"][0] == {
        "id": "call_get_stock_data",
        "type": "function_call",
        "status": "completed",
        "call_id": "call_get_stock_data",
        "name": "get_stock_data",
        "arguments": '{"ticker":"AAPL"}',
    }, tool_response_payload
    assert tool_response_payload["output_text"] == "", tool_response_payload

    structured_response_payload = server._chat_completion_to_responses_payload(
        {
            "id": "chatcmpl-structured",
            "created": 1779800001,
            "model": "free_pro",
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "**Recommendation**: Buy\n\nStrong market case.",
                    },
                    "finish_reason": "stop",
                }
            ],
        },
        {
            "model": "free_pro",
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "ResearchPlan",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "recommendation": {"type": "string", "enum": ["Buy", "Overweight", "Hold", "Underweight", "Sell"]},
                            "rationale": {"type": "string"},
                            "strategic_actions": {"type": "string"},
                        },
                        "required": ["recommendation", "rationale", "strategic_actions"],
                    },
                }
            },
        },
    )
    structured_text = structured_response_payload["output"][0]["content"][0]["text"]
    structured_parsed = structured_response_payload["output"][0]["content"][0]["parsed"]
    structured_json = __import__("json").loads(structured_text)
    assert structured_json["recommendation"] == "Buy", structured_response_payload
    assert structured_parsed["recommendation"] == "Buy", structured_response_payload
    assert "Strong market case" in structured_json["rationale"], structured_response_payload

    structured_tool_response_payload = server._chat_completion_to_responses_payload(
        {
            "id": "chatcmpl-structured-tool",
            "created": 1779800003,
            "model": "free_pro",
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_structured",
                                "type": "function",
                                "function": {
                                    "name": "ResearchPlan",
                                    "arguments": '{"recommendation":"Buy","rationale":"Tool shaped rationale","strategic_actions":"Scale in gradually"}',
                                },
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ],
        },
        {
            "model": "free_pro",
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": "ResearchPlan",
                    "schema": {
                        "type": "object",
                        "properties": {
                            "recommendation": {"type": "string", "enum": ["Buy", "Overweight", "Hold", "Underweight", "Sell"]},
                            "rationale": {"type": "string"},
                            "strategic_actions": {"type": "string"},
                        },
                        "required": ["recommendation", "rationale", "strategic_actions"],
                    },
                }
            },
        },
    )
    assert structured_tool_response_payload["output"][0]["type"] == "message", structured_tool_response_payload
    assert structured_tool_response_payload["output"][0]["content"][0]["parsed"]["recommendation"] == "Buy", structured_tool_response_payload

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
