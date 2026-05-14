"""
Mock Agent-Reach Server for Local Development
Returns sources from web search to simulate Agent-Reach functionality
"""

import os
import json
import asyncio
from typing import Any
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
import uvicorn
import httpx

app = FastAPI(title="Mock Agent-Reach Server")

async def fetch_searxng_sources(query: str, max_results: int = 50) -> list[dict]:
    """Fetch sources from SearXNG to simulate Agent-Reach"""
    try:
        # Use SearXNG as the source
        searxng_url = os.getenv("SEARXNG_URL", "http://192.168.88.97:7777")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{searxng_url}/search",
                params={
                    "q": query,
                    "format": "json",
                    "engines": "google,bing,duckduckgo",
                    "language": "en",
                }
            )
            
            if response.status_code != 200:
                return []
            
            data = response.json()
            results = data.get("results", [])
            
            # Convert to Agent-Reach format
            sources = []
            for result in results[:max_results]:
                sources.append({
                    "title": result.get("title", ""),
                    "url": result.get("url", ""),
                    "snippet": result.get("content", result.get("snippet", "")),
                    "score": result.get("score", 0.5),
                    "source": result.get("engine", "web"),
                })
            
            return sources
    except Exception as e:
        print(f"[Mock Agent-Reach] Error fetching from SearXNG: {e}")
        return []

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "mock-agent-reach"}

@app.post("/research")
async def research_endpoint(request: dict):
    """REST API endpoint for research"""
    query = request.get("query", "")
    target_count = request.get("targetSourceCount", 500)
    
    print(f"[Mock Agent-Reach] Research request: {query[:50]}...")
    print(f"[Mock Agent-Reach] Target count: {target_count}")
    
    # Fetch sources from web search
    sources = await fetch_searxng_sources(query, min(target_count, 100))
    
    result = {
        "sources": sources,
        "summary": f"Agent-Reach (mock): Found {len(sources)} sources for '{query[:50]}...'",
        "status": "completed",
        "source_count": len(sources),
        "channels": ["web", "news", "blogs"],
    }
    
    print(f"[Mock Agent-Reach] Returning {len(sources)} sources")
    return result

@app.get("/sse")
async def sse_endpoint():
    """SSE endpoint for MCP protocol"""
    # For now, just return a simple response
    return JSONResponse({"status": "ok", "message": "MCP SSE endpoint"})

@app.post("/messages")
async def messages_endpoint(request: dict):
    """MCP messages endpoint"""
    method = request.get("method", "")
    params = request.get("params", {})
    
    if method == "research":
        query = params.get("query", "")
        target_count = params.get("target_count", 500)
        
        sources = await fetch_searxng_sources(query, min(target_count, 100))
        
        return {
            "jsonrpc": "2.0",
            "id": request.get("id"),
            "result": {
                "sources": sources,
                "summary": f"Agent-Reach (mock): {len(sources)} sources",
                "status": "completed",
                "source_count": len(sources),
                "channels": ["web", "news", "blogs"],
            }
        }
    
    return {
        "jsonrpc": "2.0",
        "id": request.get("id"),
        "error": {"code": -32601, "message": "Method not found"}
    }

if __name__ == "__main__":
    port = int(os.getenv("AGENT_REACH_PORT", "6656"))
    print(f"[Mock Agent-Reach] Starting server on port {port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
