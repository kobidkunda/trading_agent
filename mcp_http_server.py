import json
import os
import re
from typing import Any

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route


SERVICE_NAME = "agent-reach-mcp"


def _jsonrpc_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": code, "message": message},
    }


def _mcp_text_response(request_id: Any, payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "result": {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps(payload),
                }
            ]
        },
    }


def _fallback_queries(query: str) -> list[str]:
    simplified = re.sub(r"^(will|can|does|did|is|are)\s+", "", query, flags=re.IGNORECASE)
    simplified = re.sub(r"\?$", "", simplified).strip()
    keyword_query = " ".join(
        token
        for token in re.split(r"\W+", simplified)
        if len(token) > 2 and token.lower() not in {"the", "for", "and", "with", "that", "this", "will"}
    )
    queries = [query, simplified, keyword_query]
    unique: list[str] = []
    for candidate in queries:
        candidate = candidate.strip()
        if candidate and candidate not in unique:
            unique.append(candidate)
    return unique


async def _fetch_searxng_sources(query: str, max_results: int) -> tuple[list[dict[str, Any]], list[Any], str]:
    searxng_url = os.getenv("SEARXNG_URL", "http://searxng:8080").rstrip("/")
    last_unresponsive: list[Any] = []
    async with httpx.AsyncClient(timeout=30.0) as client:
        for candidate_query in _fallback_queries(query):
            response = await client.get(
                f"{searxng_url}/search",
                params={
                    "q": candidate_query,
                    "format": "json",
                    "language": "en",
                },
            )
            response.raise_for_status()
            data = response.json()
            last_unresponsive = data.get("unresponsive_engines", [])

            sources: list[dict[str, Any]] = []
            for result in data.get("results", [])[:max_results]:
                sources.append(
                    {
                        "title": result.get("title", ""),
                        "url": result.get("url", ""),
                        "snippet": result.get("content") or result.get("snippet", ""),
                        "score": result.get("score", 0.5),
                        "source": result.get("engine") or result.get("source") or "web",
                    }
                )
            if sources:
                return sources, last_unresponsive, candidate_query

    return [], last_unresponsive, query


async def _execute_tool(tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if tool_name == "get_status":
        channels = {
            "web": {"status": "ok", "message": "SearXNG-backed web research"},
            "research": {"status": "ok", "message": "MCP broad research available"},
        }
        return {
            "status": "healthy",
            "service": SERVICE_NAME,
            "channels": {
                ch_name: channel for ch_name, channel in channels.items()
            },
        }

    if tool_name != "research":
        raise ValueError(f"Unknown tool: {tool_name}")

    query = str(arguments.get("query") or "").strip()
    if not query:
        raise ValueError("Missing required argument: query")

    target_count = int(arguments.get("targetSourceCount") or 100)
    max_results = max(1, min(target_count, 100))
    sources, unresponsive_engines, query_used = await _fetch_searxng_sources(query, max_results)
    status = "completed" if sources else "failed"
    blocked = ", ".join(f"{name}: {reason}" for name, reason in unresponsive_engines[:4])
    empty_reason = f" Upstream search engines returned no usable results. Unresponsive engines: {blocked}" if not sources and blocked else ""
    return {
        "status": status,
        "summary": f"Agent-Reach MCP: Found {len(sources)} sources for '{query[:50]}...'.{empty_reason}",
        "sources": sources,
        "source_count": len(sources),
        "channels": ["web", "search"],
        "query_used": query_used,
        "unresponsive_engines": unresponsive_engines,
    }


async def health(_: Request) -> JSONResponse:
    return JSONResponse({"status": "healthy", "service": SERVICE_NAME})


async def research(request: Request) -> JSONResponse:
    body = await request.json()
    query = str(body.get("query") or "")
    target_count = int(body.get("targetSourceCount") or 100)
    try:
        result = await _execute_tool(
            "research",
            {"query": query, "targetSourceCount": target_count},
        )
        return JSONResponse(result)
    except Exception as exc:
        return JSONResponse({"status": "error", "message": str(exc)}, status_code=500)


async def mcp(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        return JSONResponse(_jsonrpc_error(None, -32700, "Parse error"), status_code=400)

    method = body.get("method", "")
    request_id = body.get("id")

    if method == "tools/list":
        return JSONResponse(
            {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "tools": [
                        {
                            "name": "research",
                            "description": "Run broad research and return normalized sources",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "query": {"type": "string"},
                                    "targetSourceCount": {"type": "integer", "default": 100},
                                },
                                "required": ["query"],
                            },
                        },
                        {
                            "name": "get_status",
                            "description": "Get Agent-Reach channel status",
                            "inputSchema": {"type": "object", "properties": {}},
                        },
                    ]
                },
            }
        )

    if method != "tools/call":
        return JSONResponse(_jsonrpc_error(request_id, -32601, "Method not found"))

    params = body.get("params", {}) or {}
    tool_name = str(params.get("name") or "")
    arguments = params.get("arguments", {}) or {}

    try:
        result = await _execute_tool(tool_name, arguments)
        return JSONResponse(_mcp_text_response(request_id, result))
    except Exception as exc:
        return JSONResponse(
            _jsonrpc_error(request_id, -32603, f"Internal error: {exc}")
        )


routes = [
    Route("/health", health, methods=["GET"]),
    Route("/research", research, methods=["POST"]),
    Route("/mcp", mcp, methods=["POST"]),
]

app = Starlette(debug=bool(os.environ.get("DEBUG")), routes=routes)


if __name__ == "__main__":
    port = int(os.getenv("AGENT_REACH_PORT", "6656"))
    uvicorn.run(app, host="0.0.0.0", port=port)
