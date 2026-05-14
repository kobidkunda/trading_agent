"""
Agent-Reach MCP Client for TradingAgents Service

Uses standard MCP (Model Context Protocol) via direct JSON-RPC POST to /mcp endpoint.
MCP endpoint: http://192.168.88.96:7234/mcp
"""

import os
import json
import uuid
import re
from typing import Any

import httpx


async def fetch_agent_reach_research(
    query: str,
    target_source_count: int = 500
) -> dict[str, Any]:
    """
    Fetch research from Agent-Reach MCP server using exa_search tool.
    
    Args:
        query: Search query
        target_source_count: Target number of sources (default: 500)
    
    Returns:
        Dict with sources, summary, status, and error info
    """
    agent_reach_url = os.getenv("AGENT_REACH_URL", "").strip()
    agent_reach_api_key = os.getenv("AGENT_REACH_API_KEY", "").strip()
    
    print(f"[Agent-Reach] Starting research for: {query}")
    print(f"[Agent-Reach] Target sources: {target_source_count}")
    print(f"[Agent-Reach] URL configured: {bool(agent_reach_url)}")
    
    if not agent_reach_url:
        error_msg = "AGENT_REACH_URL environment variable is not set"
        print(f"[Agent-Reach ERROR] {error_msg}")
        return {
            "error": error_msg,
            "sources": [],
            "summary": error_msg,
            "status": "failed",
            "source_count": 0,
        }

    try:
        print("[Agent-Reach] Calling exa_search via MCP...")
        result = await _call_mcp_method(
            agent_reach_url,
            "exa_search",
            {"query": query, "numResults": min(target_source_count, 100)},
            agent_reach_api_key,
        )
        
        sources = _normalize_sources(result.get("sources", result.get("results", [])))
        print(f"[Agent-Reach] MCP success: {len(sources)} sources returned")
        
        return {
            "sources": sources,
            "summary": result.get("summary", f"Agent-Reach: {len(sources)} sources found"),
            "status": "completed",
            "source_count": len(sources),
            "channels": result.get("channels", []),
        }
        
    except Exception as e:
        error_msg = f"Agent-Reach MCP failed: {e}"
        print(f"[Agent-Reach ERROR] {error_msg}")
        return {
            "error": str(e),
            "sources": [],
            "summary": error_msg,
            "status": "failed",
            "source_count": 0,
        }


async def _call_mcp_method(
    base_url: str,
    method: str,
    params: dict[str, Any],
    api_key: str = "",
) -> dict[str, Any]:
    """Call Agent-Reach via standard MCP tools/call protocol."""
    session_id = str(uuid.uuid4())
    mcp_url = f"{base_url.rstrip('/')}/mcp"
    
    print(f"[Agent-Reach MCP] Session: {session_id}")
    print(f"[Agent-Reach MCP] Endpoint: {mcp_url}")
    print(f"[Agent-Reach MCP] Tool: {method}")
    
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    
    try:
        request = {
            "jsonrpc": "2.0",
            "id": session_id,
            "method": "tools/call",
            "params": {
                "name": method,
                "arguments": params,
            },
        }
        
        print(f"[Agent-Reach MCP] Sending: {json.dumps(request)[:500]}")
        
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(mcp_url, json=request, headers=headers)
            
            if response.status_code != 200:
                raise Exception(
                    f"MCP POST failed: HTTP {response.status_code} - {response.text[:500]}"
                )
            
            response_data = response.json()
            print(f"[Agent-Reach MCP] Response: {json.dumps(response_data)[:500]}")
            
            if "error" in response_data:
                error = response_data["error"]
                raise Exception(f"MCP error {error.get('code')}: {error.get('message')}")
            
            result = response_data.get("result", {})
            
            # Extract text content from tools/call response
            if isinstance(result, dict) and "content" in result:
                content = result["content"]
                if isinstance(content, list) and len(content) > 0:
                    text = content[0].get("text", "")
                    if isinstance(text, str):
                        try:
                            return json.loads(text)
                        except json.JSONDecodeError:
                            return {"text": text}
            
            return result

    except httpx.TimeoutException as e:
        print(f"[Agent-Reach MCP] Timeout: {e}")
        raise Exception(f"MCP timeout: {e}")
    except Exception as e:
        print(f"[Agent-Reach MCP] Error: {e}")
        raise


async def _call_rest_api(
    base_url: str,
    query: str,
    api_key: str = "",
    target_count: int = 500,
) -> dict[str, Any]:
    """Fallback: direct MCP POST when MCP client fails."""
    url = f"{base_url.rstrip('/')}/mcp"
    
    print(f"[Agent-Reach REST] Calling: {url}")
    print(f"[Agent-Reach REST] Query: {query}")
    
    headers: dict[str, str] = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                url,
                json={
                    "jsonrpc": "2.0",
                    "id": f"rest_{uuid.uuid4().hex[:12]}",
                    "method": "tools/call",
                    "params": {
                        "name": "web_read",
                        "arguments": {"query": query},
                    },
                },
                headers=headers or None,
            )
            
            print(f"[Agent-Reach REST] Status: {response.status_code}")
            
            if response.status_code != 200:
                error_text = response.text[:500]
                raise Exception(f"HTTP {response.status_code}: {error_text}")
            
            data = response.json()
            result = data.get("result", {})
            
            if isinstance(result, dict) and "content" in result:
                content = result["content"]
                if isinstance(content, list) and len(content) > 0:
                    text = content[0].get("text", "")
                    if isinstance(text, str):
                        try:
                            return json.loads(text)
                        except json.JSONDecodeError:
                            return {"text": text}
            
            return result
            
    except httpx.TimeoutException as e:
        print(f"[Agent-Reach REST] Timeout: {e}")
        raise Exception(f"REST API timeout: {e}")
    except Exception as e:
        print(f"[Agent-Reach REST] Error: {e}")
        raise


def _normalize_sources(sources: list[Any]) -> list[dict[str, str]]:
    """Normalize source data to consistent format. Handles both list and string inputs."""
    if isinstance(sources, str):
        # Parse text response from exa_search (Title: / URL: format)
        parsed = []
        entries = re.split(r'\n(?=Title:)', sources)
        for entry in entries:
            title_match = re.search(r'^Title:\s*(.+?)$', entry, re.MULTILINE)
            url_match = re.search(r'URL:\s*(\S+)', entry)
            highlights_match = re.search(r'Highlights:\s*\n(.+)', entry, re.DOTALL)
            if title_match or url_match:
                snippet = highlights_match.group(1).strip()[:2000] if highlights_match else entry[:2000]
                parsed.append({
                    "title": title_match.group(1).strip()[:200] if title_match else "",
                    "url": url_match.group(1)[:500] if url_match else "",
                    "snippet": snippet,
                })
        if parsed:
            print(f"[Agent-Reach] Parsed {len(parsed)} sources from text response")
            return parsed
        # Fallback: treat entire string as single source snippet
        return [{"title": "", "url": "", "snippet": sources[:2000]}]
    
    if not isinstance(sources, list):
        print(f"[Agent-Reach] Warning: sources is not a list: {type(sources)}")
        return []
    
    normalized = []
    for i, item in enumerate(sources):
        if not isinstance(item, dict):
            print(f"[Agent-Reach] Warning: source {i} is not a dict: {type(item)}")
            continue
        
        source = {
            "title": str(item.get("title", item.get("name", "")))[:200],
            "url": str(item.get("url", item.get("link", "")))[:500],
            "snippet": str(item.get("snippet", item.get("content", item.get("description", ""))))[:2000],
        }
        
        if source["title"] or source["url"] or source["snippet"]:
            normalized.append(source)
        else:
            print(f"[Agent-Reach] Warning: source {i} has no content")
    
    print(f"[Agent-Reach] Normalized {len(normalized)}/{len(sources)} sources")
    return normalized


async def test_agent_reach_connection() -> dict[str, Any]:
    """Test Agent-Reach connection and return status."""
    url = os.getenv("AGENT_REACH_URL", "").strip()
    api_key = os.getenv("AGENT_REACH_API_KEY", "").strip()
    
    print(f"[Agent-Reach] Testing connection to: {url}")
    
    if not url:
        return {
            "ok": False,
            "message": "AGENT_REACH_URL not configured",
            "sources": 0,
        }
    
    try:
        # Try MCP get_status first
        result = await _call_mcp_method(url, "get_status", {}, api_key)
        return {
            "ok": True,
            "message": f"MCP connected: {result.get('status', 'OK')}",
            "channels": result.get("channels", []),
            "sources": 0,
        }
    except Exception as e:
        print(f"[Agent-Reach] Connection test failed: {e}")
        return {
            "ok": False,
            "message": str(e),
            "sources": 0,
        }
