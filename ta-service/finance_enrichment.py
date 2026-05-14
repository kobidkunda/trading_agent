import os
from typing import Any

import httpx


async def fetch_finance_context(symbol: str) -> dict[str, Any]:
    alpha_vantage_api_key = os.getenv("ALPHA_VANTAGE_API_KEY", "").strip()
    finnhub_api_key = os.getenv("FINNHUB_API_KEY", "").strip()
    result: dict[str, Any] = {"alpha_vantage": None, "finnhub": None}

    if not symbol:
        return result

    async with httpx.AsyncClient(timeout=15.0) as client:
        if alpha_vantage_api_key:
            try:
                alpha_vantage_response = await client.get(
                    "https://www.alphavantage.co/query",
                    params={
                        "function": "GLOBAL_QUOTE",
                        "symbol": symbol,
                        "apikey": alpha_vantage_api_key,
                    },
                )
                if alpha_vantage_response.status_code == 200:
                    result["alpha_vantage"] = alpha_vantage_response.json()
                else:
                    result["alpha_vantage"] = {
                        "error": f"HTTP {alpha_vantage_response.status_code}"
                    }
            except Exception as exc:
                result["alpha_vantage"] = {"error": str(exc)}

        if finnhub_api_key:
            try:
                finnhub_response = await client.get(
                    "https://finnhub.io/api/v1/quote",
                    params={"symbol": symbol, "token": finnhub_api_key},
                )
                if finnhub_response.status_code == 200:
                    result["finnhub"] = finnhub_response.json()
                else:
                    result["finnhub"] = {"error": f"HTTP {finnhub_response.status_code}"}
            except Exception as exc:
                result["finnhub"] = {"error": str(exc)}

    return result
