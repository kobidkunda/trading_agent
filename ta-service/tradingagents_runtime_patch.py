"""Runtime compatibility patches for upstream TradingAgents.

These patches keep the upstream package on its real data path while smoothing
small version/data-shape differences we hit in the service container.
"""

from __future__ import annotations

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

    def patched_clean_dataframe(data):
        return original_clean_dataframe(_normalize_ohlcv_columns(data))

    stockstats_utils._clean_dataframe = patched_clean_dataframe
    stockstats_utils._tcc_runtime_patched = True
