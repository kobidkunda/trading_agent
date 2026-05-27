"""Runtime compatibility patches for upstream TradingAgents.

These patches keep the upstream package on its real data path while smoothing
small version/data-shape differences we hit in the service container.
"""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any


def _normalize_ohlcv_columns(data: Any) -> Any:
    """Ensure Yahoo OHLCV frames expose the Date column TradingAgents expects."""
    if data is None or getattr(data, "empty", False):
        return data

    renamed = data.copy()
    if "Date" in renamed.columns:
        return renamed

    rename_candidates = {
        "date": "Date",
        "Datetime": "Date",
        "datetime": "Date",
        "index": "Date",
    }
    for source, target in rename_candidates.items():
        if source in renamed.columns:
            return renamed.rename(columns={source: target})

    index_name = getattr(renamed.index, "name", None)
    if index_name in {"Date", "Datetime", "date", "datetime"}:
        return renamed.reset_index().rename(columns={index_name: "Date"})

    if len(renamed.columns) >= 6:
        first_column = str(renamed.columns[0])
        price_columns = {str(column).lower() for column in renamed.columns[1:]}
        if first_column.startswith("Unnamed") and {"close", "high", "low", "open"}.issubset(price_columns):
            return renamed.rename(columns={renamed.columns[0]: "Date"})

    return renamed


def apply_tradingagents_runtime_patches() -> None:
    try:
        from tradingagents.dataflows import stockstats_utils
    except Exception:
        return

    if getattr(stockstats_utils, "_tcc_runtime_patched", False):
        return

    original_clean_dataframe = stockstats_utils._clean_dataframe
    original_load_ohlcv = stockstats_utils.load_ohlcv

    def patched_clean_dataframe(data):
        return original_clean_dataframe(_normalize_ohlcv_columns(data))

    def patched_load_ohlcv(symbol: str, curr_date: str):
        pd = stockstats_utils.pd
        yf = stockstats_utils.yf
        curr_date_dt = pd.to_datetime(curr_date)
        safe_symbol = stockstats_utils.safe_ticker_component(symbol)
        config = stockstats_utils.get_config()

        end_date = min(pd.Timestamp.today().normalize(), curr_date_dt.normalize() + pd.DateOffset(days=1))
        start_date = end_date - pd.DateOffset(years=5)
        start_str = start_date.strftime("%Y-%m-%d")
        end_str = end_date.strftime("%Y-%m-%d")

        os.makedirs(config["data_cache_dir"], exist_ok=True)
        data_file = os.path.join(
            config["data_cache_dir"],
            f"{safe_symbol}-YFin-data-{start_str}-{end_str}.csv",
        )

        if os.path.exists(data_file):
            data = pd.read_csv(data_file, on_bad_lines="skip", encoding="utf-8")
        else:
            data = stockstats_utils.yf_retry(lambda: yf.download(
                symbol,
                start=start_str,
                end=end_str,
                multi_level_index=False,
                progress=False,
                auto_adjust=True,
            ))
            data = data.reset_index()
            data.to_csv(data_file, index=False, encoding="utf-8")

        data = patched_clean_dataframe(data)
        return data[data["Date"] <= curr_date_dt]

    stockstats_utils._clean_dataframe = patched_clean_dataframe
    stockstats_utils.load_ohlcv = patched_load_ohlcv

    try:
        from tradingagents.dataflows import y_finance

        y_finance.load_ohlcv = patched_load_ohlcv
    except Exception:
        pass

    stockstats_utils._tcc_original_load_ohlcv = original_load_ohlcv

    try:
        from tradingagents.graph.trading_graph import TradingAgentsGraph

        if not getattr(TradingAgentsGraph, "_tcc_fetch_returns_patched", False):
            original_fetch_returns = TradingAgentsGraph._fetch_returns

            def patched_fetch_returns(self, ticker: str, trade_date: str, holding_days: int = 5, benchmark: str = "SPY"):
                start = datetime.strptime(trade_date, "%Y-%m-%d")
                if start.date() >= datetime.now().date():
                    return None, None, None
                return original_fetch_returns(self, ticker, trade_date, holding_days, benchmark)

            TradingAgentsGraph._fetch_returns = patched_fetch_returns
            TradingAgentsGraph._tcc_original_fetch_returns = original_fetch_returns
            TradingAgentsGraph._tcc_fetch_returns_patched = True
    except Exception:
        pass

    stockstats_utils._tcc_runtime_patched = True
