#!/usr/bin/env python3
"""Test Agent-Reach connection directly"""

import asyncio
import os

# Set environment variables
os.environ["AGENT_REACH_URL"] = "http://localhost:6656"
os.environ["AGENT_REACH_API_KEY"] = ""

from agent_reach import fetch_agent_reach_research

async def test():
    print("Testing Agent-Reach connection...")
    print(f"AGENT_REACH_URL: {os.getenv('AGENT_REACH_URL')}")
    
    result = await fetch_agent_reach_research("Bitcoin price 2026", target_source_count=10)
    
    print(f"\nResult:")
    print(f"  Status: {result.get('status')}")
    print(f"  Source count: {result.get('source_count')}")
    print(f"  Error: {result.get('error', 'None')}")
    
    if result.get('sources'):
        print(f"\n  First source: {result['sources'][0].get('title', 'N/A')[:50]}...")

if __name__ == "__main__":
    asyncio.run(test())
