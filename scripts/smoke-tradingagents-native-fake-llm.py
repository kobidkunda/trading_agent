#!/usr/bin/env python3
"""Run the real TradingAgents native graph against a local fake OpenAI backend."""

from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import json
import threading
import time
from urllib import error, request


class FakeOpenAIHandler(BaseHTTPRequestHandler):
    requests_seen = 0
    request_bodies: list[dict] = []

    def log_message(self, fmt: str, *args) -> None:
        return

    def _json(self, payload: dict, status: int = 200) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        if self.path.endswith("/models"):
            self._json({"object": "list", "data": [{"id": "contract-fast", "object": "model"}]})
            return
        self._json({"ok": True})

    def do_POST(self) -> None:
        FakeOpenAIHandler.requests_seen += 1
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(body.decode() or "{}")
        except Exception:
            payload = {}
        FakeOpenAIHandler.request_bodies.append(payload)

        model = payload.get("model") or "contract-fast"
        text = (
            "BUY\n"
            "Confidence: 0.61\n"
            "Rationale: deterministic contract response for TradingAgents bridge validation."
        )
        if self.path.endswith("/chat/completions"):
            self._json(
                {
                    "id": "chatcmpl-contract",
                    "object": "chat.completion",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": text},
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                }
            )
            return

        if self.path.endswith("/responses"):
            self._json(
                {
                    "id": "resp_contract",
                    "object": "response",
                    "created_at": int(time.time()),
                    "status": "completed",
                    "model": model,
                    "output": [
                        {
                            "id": "msg_contract",
                            "type": "message",
                            "status": "completed",
                            "role": "assistant",
                            "content": [{"type": "output_text", "text": text}],
                        }
                    ],
                    "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
                }
            )
            return

        self._json(
            {"error": {"message": f"unknown path {self.path}", "type": "invalid_request_error"}},
            status=404,
        )


def call_native_graph(port: int, payload_overrides: dict | None = None) -> dict:
    payload = {
        "query": "Will Bitcoin outperform SPY this week?",
        "date": "2026-05-26",
        "asset_type": "crypto",
        "llm_provider": "openai",
        "deep_think_llm": "contract-fast",
        "quick_think_llm": "contract-fast",
        "llm_base_url": f"http://host.docker.internal:{port}/v1",
        "llm_api_key": "contract-key",
        "max_debate_rounds": 1,
        "max_risk_discuss_rounds": 1,
        "output_language": "Spanish",
        "checkpoint_enabled": True,
        "selected_analysts": ["market", "social", "news", "fundamentals"],
        "benchmark_ticker": "QQQ",
        "benchmark_map": {".T": "^N225", "": "SPY"},
        "max_recur_limit": 80,
        "memory_log_max_entries": 50,
        "analyst_concurrency_limit": 1,
        "news_article_limit": 1,
        "global_news_article_limit": 1,
        "global_news_lookback_days": 1,
        "global_news_queries": ["bitcoin macro", "spy weekly"],
        "openai_reasoning_effort": "low",
        "data_vendors": {
            "core_stock_apis": "yfinance",
            "technical_indicators": "yfinance",
            "fundamental_data": "yfinance",
            "news_data": "yfinance",
        },
    }
    if payload_overrides:
        payload.update(payload_overrides)
    req = request.Request(
        "http://localhost:6503/analyze/native",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with request.urlopen(req, timeout=300) as response:
            return json.loads(response.read().decode())
    except error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        raise AssertionError(f"native graph HTTP {exc.code}: {body[:2000]}") from exc


def assert_completed(body: dict, expected: dict) -> None:
    assert body.get("status") == "completed", body
    assert body.get("ticker") == expected["ticker"], body
    assert body.get("asset_type") == expected["asset_type"], body
    assert body.get("signal"), body
    full_report = body.get("full_report")
    assert isinstance(full_report, dict) and full_report, body
    config = full_report.get("config")
    assert isinstance(config, dict), body
    for key, value in expected.get("config", {}).items():
        actual = config.get(key)
        if isinstance(value, dict):
            assert isinstance(actual, dict), (key, actual, value, body)
            for expected_key, expected_value in value.items():
                assert actual.get(expected_key) == expected_value, (key, actual, value, body)
        else:
            assert actual == value, (key, actual, value, body)


def main() -> None:
    FakeOpenAIHandler.requests_seen = 0
    FakeOpenAIHandler.request_bodies = []
    server = ThreadingHTTPServer(("0.0.0.0", 0), FakeOpenAIHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        crypto_first = call_native_graph(server.server_port)
        crypto_second = call_native_graph(server.server_port)
        non_us_stock = call_native_graph(
            server.server_port,
            {
                "query": "Analyze 7203.T against the Nikkei this week",
                "asset_type": "stock",
                "output_language": "Japanese",
                "benchmark_ticker": "^N225",
                "global_news_queries": ["Toyota Japan earnings", "Nikkei auto sector"],
            },
        )
    finally:
        server.shutdown()
        thread.join(timeout=5)

    assert_completed(
        crypto_first,
        {
            "ticker": "BTC",
            "asset_type": "crypto",
            "config": {
                "checkpoint_enabled": True,
                "benchmark_ticker": "QQQ",
                "output_language": "Spanish",
                "selected_analysts": ["market", "social", "news", "fundamentals"],
                "benchmark_map": {".T": "^N225", "": "SPY"},
                "memory_log_max_entries": 50,
                "global_news_queries": ["bitcoin macro", "spy weekly"],
                "openai_reasoning_effort": "low",
                "data_vendors": {
                    "core_stock_apis": "yfinance",
                    "technical_indicators": "yfinance",
                    "fundamental_data": "yfinance",
                    "news_data": "yfinance",
                },
            },
        },
    )
    assert_completed(
        crypto_second,
        {
            "ticker": "BTC",
            "asset_type": "crypto",
            "config": {
                "checkpoint_enabled": True,
                "benchmark_ticker": "QQQ",
                "output_language": "Spanish",
            },
        },
    )
    assert_completed(
        non_us_stock,
        {
            "ticker": "7203.T",
            "asset_type": "stock",
            "config": {
                "checkpoint_enabled": True,
                "benchmark_ticker": "^N225",
                "output_language": "Japanese",
                "global_news_queries": ["Toyota Japan earnings", "Nikkei auto sector"],
            },
        },
    )
    assert FakeOpenAIHandler.requests_seen > 0
    serialized_requests = json.dumps(FakeOpenAIHandler.request_bodies)
    assert "Spanish" in serialized_requests
    assert "Japanese" in serialized_requests
    print(
        "native graph fake-llm ok: "
        f"crypto_signal={crypto_first.get('signal')} "
        f"non_us_signal={non_us_stock.get('signal')} "
        f"requests={FakeOpenAIHandler.requests_seen}"
    )


if __name__ == "__main__":
    main()
