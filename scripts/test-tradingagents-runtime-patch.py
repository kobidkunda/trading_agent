#!/usr/bin/env python3
"""Contract-test local runtime patches layered over upstream TradingAgents."""

from __future__ import annotations

import importlib
import os
import sys
import tempfile
import types
from pathlib import Path
from unittest.mock import patch

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
TA_SERVICE = ROOT / "ta-service"
sys.path.insert(0, str(TA_SERVICE))


def install_fake_stockstats() -> types.ModuleType:
    package = types.ModuleType("tradingagents")
    dataflows_package = types.ModuleType("tradingagents.dataflows")
    stockstats_utils = types.ModuleType("tradingagents.dataflows.stockstats_utils")
    y_finance = types.ModuleType("tradingagents.dataflows.y_finance")
    graph_package = types.ModuleType("tradingagents.graph")
    trading_graph = types.ModuleType("tradingagents.graph.trading_graph")

    class FakeTradingAgentsGraph:
        def _fetch_returns(self, ticker: str, trade_date: str, holding_days: int = 5, benchmark: str = "SPY"):
            return 0.1, 0.05, holding_days

    stockstats_utils.pd = pd
    stockstats_utils.yf = types.SimpleNamespace(download=lambda **_: pd.DataFrame())
    stockstats_utils.yf_retry = lambda fn: fn()
    stockstats_utils.safe_ticker_component = lambda symbol: symbol.replace("/", "_")
    stockstats_utils.get_config = lambda: {"data_cache_dir": tempfile.mkdtemp(prefix="ta-patch-cache-")}
    stockstats_utils._clean_dataframe = lambda data: data.assign(Date=pd.to_datetime(data["Date"]))
    stockstats_utils.load_ohlcv = lambda symbol, curr_date: pd.DataFrame()
    trading_graph.TradingAgentsGraph = FakeTradingAgentsGraph

    sys.modules["tradingagents"] = package
    sys.modules["tradingagents.dataflows"] = dataflows_package
    sys.modules["tradingagents.dataflows.stockstats_utils"] = stockstats_utils
    sys.modules["tradingagents.dataflows.y_finance"] = y_finance
    sys.modules["tradingagents.graph"] = graph_package
    sys.modules["tradingagents.graph.trading_graph"] = trading_graph
    return stockstats_utils


def main() -> None:
    stockstats_utils = install_fake_stockstats()
    runtime_patch = importlib.import_module("tradingagents_runtime_patch")
    runtime_patch.apply_tradingagents_runtime_patches()

    downloaded = pd.DataFrame(
        {
            "Date": ["2025-05-27", "2025-05-28", "2025-05-29"],
            "Open": [1.0, 2.0, 3.0],
            "High": [1.0, 2.0, 3.0],
            "Low": [1.0, 2.0, 3.0],
            "Close": [1.0, 2.0, 3.0],
            "Volume": [100, 200, 300],
        }
    )

    with patch.object(stockstats_utils.yf, "download", return_value=downloaded) as download_mock, \
        patch.object(os.path, "exists", return_value=False), \
        patch("tradingagents_runtime_patch.os.makedirs"):
        patched = stockstats_utils.load_ohlcv("AAPL", "2025-05-28")

    assert patched["Date"].max() <= pd.Timestamp("2025-05-28"), patched
    assert download_mock.call_args.kwargs["start"] == "2020-05-29", download_mock.call_args
    assert download_mock.call_args.kwargs["end"] == "2025-05-29", download_mock.call_args
    assert sys.modules["tradingagents.dataflows.y_finance"].load_ohlcv is stockstats_utils.load_ohlcv
    graph = sys.modules["tradingagents.graph.trading_graph"].TradingAgentsGraph()
    assert graph._fetch_returns("AAPL", "2099-01-01") == (None, None, None)
    assert graph._fetch_returns("AAPL", "2025-05-28") == (0.1, 0.05, 5)

    print("runtime patch ok: OHLCV downloads clamp to requested trade date and future returns stay pending")


if __name__ == "__main__":
    main()
