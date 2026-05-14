import os
import json
import re
import asyncio
import traceback
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, Any
import httpx

from agent_reach import fetch_agent_reach_research
from finance_enrichment import fetch_finance_context

app = FastAPI(title="TradingAgents API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyzeRequest(BaseModel):
    query: str
    date: Optional[str] = None
    depth: Optional[str] = "full"
    llm_provider: Optional[str] = None
    deep_think_llm: Optional[str] = None
    quick_think_llm: Optional[str] = None
    max_debate_rounds: Optional[int] = None


class AnalyzeResponse(BaseModel):
    status: str
    query: str
    news_report: Optional[dict] = None
    sentiment_report: Optional[dict] = None
    technical_report: Optional[dict] = None
    fundamentals_report: Optional[dict] = None
    reddit_report: Optional[dict] = None
    x_report: Optional[dict] = None
    bull_debate: Optional[str] = None
    bear_debate: Optional[str] = None
    decision: Optional[str] = None
    confidence: Optional[float] = None
    raw_output: Optional[dict] = None
    error: Optional[str] = None


def _extract_agent_reach_social_evidence(agent_reach_result: Any) -> dict[str, Any] | None:
    if not isinstance(agent_reach_result, dict) or not agent_reach_result:
        return None
    if "error" in agent_reach_result:
        return {"error": agent_reach_result["error"]}

    social_keys = {
        "social",
        "social_evidence",
        "sentiment",
        "reddit",
        "x",
        "twitter",
        "posts",
        "sources",
        "evidence",
        "findings",
        "summary",
    }
    social_context = {
        key: value
        for key, value in agent_reach_result.items()
        if key in social_keys and value not in (None, [], {})
    }
    return social_context or {"research": agent_reach_result}


def _merge_social_context(
    reddit_posts: list[dict],
    x_posts: list[dict],
    agent_reach_result: Any,
) -> dict[str, Any] | None:
    agent_reach_social = _extract_agent_reach_social_evidence(agent_reach_result)
    if not reddit_posts and not x_posts and not agent_reach_social:
        return None

    social_context: dict[str, Any] = {}
    if reddit_posts:
        social_context["reddit"] = {"posts": reddit_posts}
    if x_posts:
        social_context["x"] = {"posts": x_posts}
    if agent_reach_social is not None:
        social_context["agent_reach"] = agent_reach_social
    return social_context


def get_llm_config(req: AnalyzeRequest) -> dict:
    base_url = os.getenv("OPENAI_BASE_URL", "http://192.168.88.97:4444/v1").rstrip("/")
    api_key = os.getenv("OPENAI_API_KEY", "")
    deep_model = req.deep_think_llm or os.getenv("TA_DEEP_THINK_LLM", "paper_proglm")
    quick_model = req.quick_think_llm or os.getenv("TA_QUICK_THINK_LLM", "paper_lite")
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return {
        "base_url": base_url,
        "api_key": api_key,
        "deep_model": deep_model,
        "quick_model": quick_model,
        "headers": headers,
    }


def extract_ticker(query: str) -> str:
    q = query.upper()
    known = {
        "BITCOIN": "BTC",
        "BTC": "BTC",
        "ETHEREUM": "ETH",
        "ETH": "ETH",
        "APPLE": "AAPL",
        "TESLA": "TSLA",
        "GOOGLE": "GOOG",
        "AMAZON": "AMZN",
        "META": "META",
        "MICROSOFT": "MSFT",
        "NVIDIA": "NVDA",
        "SPY": "SPY",
        "NASDAQ": "QQQ",
        "S&P": "SPY",
        "CRYPTO": "BTC",
        "O SCAR": "MKT",
        "SENATE": "SPY",
        "NBA": "SPY",
        "POLITICS": "SPY",
        "ELECTION": "SPY",
    }
    for kw, ticker in known.items():
        if kw.upper() in q:
            return ticker
    words = re.findall(r"[A-Z]{2,6}", q)
    if words:
        return words[0][:5]
    return "MKT"


# ── Reddit Data Fetching ─────────────────────────────────────────────────────

REDDIT_CLIENT_ID = os.getenv("REDDIT_CLIENT_ID", "")
REDDIT_CLIENT_SECRET = os.getenv("REDDIT_CLIENT_SECRET", "")
REDDIT_USER_AGENT = os.getenv("REDDIT_USER_AGENT", "TradingBot/1.0")
REDDIT_USERNAME = os.getenv("REDDIT_USERNAME", "")
REDDIT_PASSWORD = os.getenv("REDDIT_PASSWORD", "")


async def get_reddit_token() -> Optional[str]:
    if not REDDIT_CLIENT_ID or not REDDIT_CLIENT_SECRET:
        return None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            auth = httpx.BasicAuth(REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET)
            data = (
                {
                    "grant_type": "password",
                    "username": REDDIT_USERNAME,
                    "password": REDDIT_PASSWORD,
                }
                if REDDIT_USERNAME
                else {"grant_type": "client_credentials"}
            )
            headers = {"User-Agent": REDDIT_USER_AGENT}
            resp = await client.post(
                "https://www.reddit.com/api/v1/access_token",
                auth=auth,
                data=data,
                headers=headers,
            )
            if resp.status_code == 200:
                return resp.json().get("access_token")
    except Exception as e:
        print(f"[Reddit] Token error: {e}")
    return None


async def fetch_reddit_posts(query: str, max_posts: int = 100) -> list[dict]:
    """Fetch Reddit posts with high-volume targeting (300-500 total sources across all providers)."""
    token = await get_reddit_token()
    
    # Multiple search strategies for comprehensive coverage
    search_strategies = [
        # Main search - relevance sorted
        {"q": query, "sort": "relevance", "t": "month", "limit": min(100, max_posts)},
        # Hot discussions
        {"q": query, "sort": "hot", "t": "week", "limit": min(50, max_posts // 2)},
        # Comment-heavy discussions
        {"q": f"{query} comments:", "sort": "comments", "t": "month", "limit": min(50, max_posts // 2)},
    ]
    
    posts = []
    seen_urls = set()
    
    for strategy in search_strategies:
        if len(posts) >= max_posts:
            break
            
        try:
            if token:
                search_url = f"https://oauth.reddit.com/search?q={strategy['q']}&sort={strategy['sort']}&t={strategy['t']}&limit={strategy['limit']}"
                headers = {"Authorization": f"Bearer {token}", "User-Agent": REDDIT_USER_AGENT}
            else:
                search_url = f"https://www.reddit.com/search.json?q={strategy['q']}&sort={strategy['sort']}&t={strategy['t']}&limit={strategy['limit']}"
                headers = {"User-Agent": REDDIT_USER_AGENT}
            
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.get(search_url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    children = data.get("data", {}).get("children", [])
                    for child in children:
                        post = child.get("data", {})
                        url = f"https://reddit.com{post.get('permalink', '')}"
                        if url not in seen_urls:
                            seen_urls.add(url)
                            posts.append(
                                {
                                    "title": post.get("title", ""),
                                    "subreddit": post.get("subreddit", ""),
                                    "score": post.get("score", 0),
                                    "num_comments": post.get("num_comments", 0),
                                    "created_utc": post.get("created_utc", 0),
                                    "selftext": (post.get("selftext", "") or "")[:1000],
                                    "url": url,
                                    "upvote_ratio": post.get("upvote_ratio", 0.5),
                                }
                            )
                            if len(posts) >= max_posts:
                                break
        except Exception as e:
            print(f"[Reddit] Strategy {strategy['sort']} error: {e}")
            continue

    # Expanded subreddit coverage for financial/political markets
    subreddits = [
        "wallstreetbets", "options", "stocks", "investing", "stockmarket",
        "cryptocurrency", "bitcoin", "ethereum", "defi",
        "politics", "politicaldiscussion", "news", "worldnews",
        "predictionmarket", "forex", "economy", "business",
        "technology", "technews", "futurology",
        "sportsbetting", "gambling", "fantasyfootball", "nba", "nfl",
    ]
    
    # Extract keywords for subreddit search
    keywords = [w.lower() for w in re.findall(r"[A-Za-z]+", query) if len(w) > 2]
    if not keywords:
        keywords = [query.lower()[:30]]
    
    # Search top subreddits
    for sub in subreddits[:10]:  # Increased from 3 to 10 subreddits
        if len(posts) >= max_posts:
            break
            
        try:
            sub_url = f"https://www.reddit.com/r/{sub}/search.json?q={'+'.join(keywords[:5])}&sort=hot&t=month&limit=10"
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(sub_url, headers={"User-Agent": REDDIT_USER_AGENT})
                if resp.status_code == 200:
                    for child in resp.json().get("data", {}).get("children", []):
                        post = child.get("data", {})
                        url = f"https://reddit.com{post.get('permalink', '')}"
                        if url not in seen_urls:
                            seen_urls.add(url)
                            posts.append(
                                {
                                    "title": post.get("title", ""),
                                    "subreddit": post.get("subreddit", sub),
                                    "score": post.get("score", 0),
                                    "num_comments": post.get("num_comments", 0),
                                    "created_utc": post.get("created_utc", 0),
                                    "selftext": (post.get("selftext", "") or "")[:1000],
                                    "url": url,
                                    "upvote_ratio": post.get("upvote_ratio", 0.5),
                                }
                            )
                            if len(posts) >= max_posts:
                                break
        except Exception as e:
            print(f"[Reddit] r/{sub} error: {e}")
            continue

    print(f"[Reddit] Fetched {len(posts)} posts (target: {max_posts})")
    return posts[:max_posts]


# ── X/Twitter Data Fetching via SearXNG ─────────────────────────────────────

SEARXNG_URL = os.getenv(
    "TA_SEARXNG_URL", os.getenv("SEARXNG_URL", "http://192.168.88.97:8888")
)


async def fetch_x_posts(query: str, max_results: int = 100) -> list[dict]:
    """Fetch X/Twitter posts via SearXNG with multiple search strategies for high-volume results."""
    posts = []
    seen_urls = set()
    
    # Multiple search strategies for comprehensive coverage
    search_strategies = [
        # Direct X/Twitter site search
        {
            "q": f"{query} site:x.com OR site:twitter.com",
            "categories": "general,news,social media",
            "limit": min(50, max_results),
        },
        # Hashtag variations
        {
            "q": f"#{query.replace(' ', '')} OR #{query.replace(' ', '_')} site:x.com",
            "categories": "social media",
            "limit": min(30, max_results // 2),
        },
        # Keywords without quotes for broader match
        {
            "q": f"{query} (breaking OR news OR update OR analysis) site:x.com",
            "categories": "news,social media",
            "limit": min(30, max_results // 2),
        },
        # Recent discussions
        {
            "q": f"{query} lang:en site:x.com",
            "categories": "social media",
            "time_range": "day",
            "limit": min(20, max_results // 3),
        },
    ]
    
    for i, strategy in enumerate(search_strategies):
        if len(posts) >= max_results:
            break
            
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                params = {
                    "q": strategy["q"],
                    "format": "json",
                    "categories": strategy["categories"],
                    "language": "en",
                }
                if "time_range" in strategy:
                    params["time_range"] = strategy["time_range"]
                if "limit" in strategy:
                    params["max_results"] = strategy["limit"]
                    
                resp = await client.get(
                    f"{SEARXNG_URL}/search",
                    params=params,
                    headers={"Accept": "application/json"},
                )
                
                if resp.status_code == 200:
                    data = resp.json()
                    results = data.get("results", [])
                    print(f"[X/SearXNG] Strategy {i+1}: {len(results)} raw results")
                    
                    for item in results:
                        url = item.get("url", "")
                        if ("x.com" in url or "twitter.com" in url) and url not in seen_urls:
                            seen_urls.add(url)
                            posts.append(
                                {
                                    "title": item.get("title", ""),
                                    "url": url,
                                    "content": (item.get("content", "") or "")[:1000],
                                    "engine": item.get("engine", "searxng"),
                                    "author": item.get("author", ""),
                                    "publishedDate": item.get("publishedDate", ""),
                                }
                            )
                            if len(posts) >= max_results:
                                break
        except Exception as e:
            print(f"[X/SearXNG] Strategy {i+1} error: {e}")
            continue
    
    print(f"[X/Twitter] Fetched {len(posts)} posts via SearXNG (target: {max_results})")
    return posts[:max_results]


# ── LLM Chat ────────────────────────────────────────────────────────────────


async def llm_chat(
    base_url: str,
    headers: dict,
    model: str,
    system: str,
    user: str,
    temperature: float = 0.3,
) -> Optional[dict]:
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "temperature": temperature,
                    "max_tokens": 1500,
                },
            )
            if resp.status_code == 200:
                data = resp.json()
                content = (
                    data.get("choices", [{}])[0].get("message", {}).get("content", "")
                )
                try:
                    return json.loads(content)
                except Exception:
                    return {"raw": content}
            return {"error": f"HTTP {resp.status_code}"}
    except Exception as e:
        return {"error": str(e)}


# ── Endpoints ────────────────────────────────────────────────────────────────


@app.get("/health")
async def health():
    return {"status": "healthy", "service": "tradingagents-api", "version": "2.0.0"}


@app.get("/models")
async def list_models():
    cfg = get_llm_config(AnalyzeRequest(query="test"))
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{cfg['base_url']}/models", headers=cfg["headers"])
            if resp.status_code == 200:
                data = resp.json()
                models = [m["id"] for m in data.get("data", [])]
                return {"models": models}
            return {"models": [], "error": f"HTTP {resp.status_code}"}
    except Exception as e:
        return {"models": [], "error": str(e)}


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    try:
        from tradingagents.graph.trading_graph import TradingAgentsGraph
        from tradingagents.default_config import DEFAULT_CONFIG
    except ImportError:
        return AnalyzeResponse(
            status="error", query=req.query, error="tradingagents not installed"
        )
    except Exception:
        traceback.print_exc()
        return AnalyzeResponse(
            status="error", query=req.query, error=traceback.format_exc()
        )

    try:
        data_dir = Path("/app/data")
        data_dir.mkdir(parents=True, exist_ok=True)
        config = DEFAULT_CONFIG.copy()
        config["data_cache_dir"] = str(data_dir / "cache")
        config["results_dir"] = str(data_dir / "logs")

        if req.llm_provider or os.getenv("TA_LLM_PROVIDER"):
            config["llm_provider"] = req.llm_provider or os.getenv("TA_LLM_PROVIDER")

        base_url = os.getenv("OPENAI_BASE_URL", "http://192.168.88.97:4444/v1").rstrip(
            "/"
        )
        config["backend_url"] = base_url
        config["deep_think_llm"] = req.deep_think_llm or os.getenv(
            "TA_DEEP_THINK_LLM", "paper_proglm"
        )
        config["quick_think_llm"] = req.quick_think_llm or os.getenv(
            "TA_QUICK_THINK_LLM", "paper_lite"
        )

        if req.max_debate_rounds:
            config["max_debate_rounds"] = req.max_debate_rounds

        ticker = extract_ticker(req.query)
        date = req.date or "2026-04-18"
        ta = TradingAgentsGraph(debug=False, config=config)

        finance_task = (
            asyncio.create_task(fetch_finance_context(ticker))
            if ticker and ticker != "MKT"
            else None
        )
        # High-volume social data fetching (300-500 sources target)
        reddit_task = asyncio.create_task(fetch_reddit_posts(req.query, max_posts=100))
        x_task = asyncio.create_task(fetch_x_posts(req.query, max_results=100))
        agent_reach_task = asyncio.create_task(fetch_agent_reach_research(req.query))
        propagate_task = asyncio.create_task(asyncio.to_thread(ta.propagate, ticker, date))

        _, decision = await propagate_task

        reddit_posts: Any = []
        try:
            reddit_posts = await asyncio.wait_for(reddit_task, timeout=30.0)
        except Exception as e:
            print(f"[Reddit] Failed to fetch: {e}")
            reddit_posts = []

        x_posts: Any = []
        try:
            x_posts = await asyncio.wait_for(x_task, timeout=30.0)
        except Exception as e:
            print(f"[X/Twitter] Failed to fetch: {e}")
            x_posts = []

        agent_reach_result: Any = {"error": "Agent-Reach enrichment timed out"}
        try:
            agent_reach_result = await asyncio.wait_for(agent_reach_task, timeout=60.0)
        except Exception as e:
            print(f"[Agent-Reach] Failed: {e}")
            agent_reach_result = {"error": f"Agent-Reach failed: {e}"}

        finance_context = None
        if finance_task is not None:
            try:
                finance_context = await asyncio.wait_for(finance_task, timeout=0.1)
            except Exception:
                finance_context = None

        if isinstance(reddit_posts, Exception):
            reddit_posts = []
        if isinstance(x_posts, Exception):
            x_posts = []
        if isinstance(agent_reach_result, Exception):
            agent_reach_result = {"error": str(agent_reach_result)}

        social_context = _merge_social_context(reddit_posts, x_posts, agent_reach_result)
        raw_output = {
            "ticker": ticker,
            "decision": str(decision),
            "agent_reach": agent_reach_result,
        }
        if finance_context is not None:
            raw_output["finance_context"] = finance_context
        if social_context is not None:
            raw_output["social_context"] = social_context

        sentiment_report = None
        if social_context is not None:
            sentiment_report = {"social_context": social_context}

        return AnalyzeResponse(
            status="completed",
            query=req.query,
            sentiment_report=sentiment_report,
            reddit_report={"posts": reddit_posts} if reddit_posts else None,
            x_report={"tweets": x_posts} if x_posts else None,
            decision=str(decision),
            raw_output=raw_output,
        )
    except Exception:
        tb = traceback.format_exc()
        traceback.print_exc()
        return AnalyzeResponse(status="error", query=req.query, error=tb)


@app.post("/analyze/reddit", response_model=AnalyzeResponse)
async def analyze_reddit(req: AnalyzeRequest):
    cfg = get_llm_config(req)
    posts = await fetch_reddit_posts(req.query, max_posts=10)

    if not posts:
        return AnalyzeResponse(
            status="completed",
            query=req.query,
            reddit_report={"posts": [], "summary": "No Reddit posts found"},
        )

    posts_text = "\n".join(
        f"- r/{p['subreddit']} (score:{p['score']}, comments:{p['num_comments']}): {p['title']}"
        f"\n  {p['selftext'][:200]}"
        for p in posts[:8]
    )

    result = await llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["quick_model"],
        system="You are a social sentiment analyst specializing in Reddit. Analyze the given Reddit posts for market-relevant insights. Respond ONLY with valid JSON.",
        user=f"Analyze these Reddit posts for: {req.query}\n\n{posts_text}\n\n"
        'Return JSON: {"overall_sentiment": "bullish/bearish/neutral", "confidence": 0.0-1.0, '
        '"key_themes": [...], "community_consensus": "...", "contrarian_signals": [...], '
        '"notable_posts": [{"title": "...", "insight": "..."}]}',
    )

    return AnalyzeResponse(
        status="completed" if result and "error" not in result else "error",
        query=req.query,
        reddit_report={"posts": posts, "analysis": result}
        if result and "error" not in result
        else {"posts": posts},
        error=str(result.get("error", "")) if result and "error" in result else None,
    )


@app.post("/analyze/x", response_model=AnalyzeResponse)
async def analyze_x(req: AnalyzeRequest):
    cfg = get_llm_config(req)
    tweets = await fetch_x_posts(req.query, max_results=10)

    if not tweets:
        return AnalyzeResponse(
            status="completed",
            query=req.query,
            x_report={"tweets": [], "summary": "No X/Twitter posts found"},
        )

    tweets_text = "\n".join(
        f"- {t['title']}\n  {t['content'][:200]}" for t in tweets[:8]
    )

    result = await llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["quick_model"],
        system="You are a social media analyst specializing in X/Twitter. Analyze tweets for market signals. Respond ONLY with valid JSON.",
        user=f"Analyze these X/Twitter posts for: {req.query}\n\n{tweets_text}\n\n"
        'Return JSON: {"overall_sentiment": "bullish/bearish/neutral", "confidence": 0.0-1.0, '
        '"key_narratives": [...], "viral_signals": [...], "influencer_opinions": [...]}',
    )

    return AnalyzeResponse(
        status="completed" if result and "error" not in result else "error",
        query=req.query,
        x_report={"tweets": tweets, "analysis": result}
        if result and "error" not in result
        else {"tweets": tweets},
        error=str(result.get("error", "")) if result and "error" in result else None,
    )


@app.post("/analyze/news", response_model=AnalyzeResponse)
async def analyze_news(req: AnalyzeRequest):
    cfg = get_llm_config(req)
    result = await llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["deep_model"],
        system="You are a financial news analyst. Respond ONLY with valid JSON.",
        user=f"News for: {req.query}\nDate: {req.date or '2026-04-18'}\nJSON: headlines[], sentiment, key_themes[], confidence (0-1)",
    )
    if result and "error" not in result:
        return AnalyzeResponse(status="completed", query=req.query, news_report=result)
    return AnalyzeResponse(
        status="error",
        query=req.query,
        error=str(result.get("error", "LLM call failed")),
    )


@app.post("/analyze/sentiment", response_model=AnalyzeResponse)
async def analyze_sentiment(req: AnalyzeRequest):
    cfg = get_llm_config(req)
    result = await llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["quick_model"],
        system="You are a market sentiment analyst. Respond ONLY with JSON.",
        user=f"Sentiment for: {req.query}\nJSON: overall_sentiment, key_themes[], community_views[], confidence (0-1)",
    )
    if result and "error" not in result:
        return AnalyzeResponse(
            status="completed", query=req.query, sentiment_report=result
        )
    return AnalyzeResponse(
        status="error",
        query=req.query,
        error=str(result.get("error", "LLM call failed")),
    )


@app.post("/analyze/technical", response_model=AnalyzeResponse)
async def analyze_technical(req: AnalyzeRequest):
    cfg = get_llm_config(req)
    result = await llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["quick_model"],
        system="You are a technical analyst. Respond ONLY with JSON.",
        user=f"Technical analysis for: {req.query}\nJSON: trend, key_levels, signals[], confidence (0-1)",
    )
    if result and "error" not in result:
        return AnalyzeResponse(
            status="completed", query=req.query, technical_report=result
        )
    return AnalyzeResponse(
        status="error",
        query=req.query,
        error=str(result.get("error", "LLM call failed")),
    )


@app.post("/analyze/all", response_model=AnalyzeResponse)
async def analyze_all(req: AnalyzeRequest):
    cfg = get_llm_config(req)
    date_str = req.date or "2026-04-18"

    news_task = llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["deep_model"],
        system="You are a financial news analyst. Respond ONLY with JSON.",
        user=f"News for: {req.query}\nDate: {date_str}\nJSON: headlines[], sentiment, key_themes[], confidence (0-1)",
    )
    sentiment_task = llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["quick_model"],
        system="You are a market sentiment analyst. Respond ONLY with JSON.",
        user=f"Sentiment for: {req.query}\nJSON: overall_sentiment, key_themes[], community_views[], confidence (0-1)",
    )
    technical_task = llm_chat(
        cfg["base_url"],
        cfg["headers"],
        cfg["quick_model"],
        system="You are a technical analyst. Respond ONLY with JSON.",
        user=f"Technical analysis for: {req.query}\nJSON: trend, key_levels, signals[], confidence (0-1)",
    )
    reddit_task = fetch_reddit_posts(req.query, max_posts=100)
    x_task = fetch_x_posts(req.query, max_results=100)

    results = await asyncio.gather(
        news_task,
        sentiment_task,
        technical_task,
        reddit_task,
        x_task,
        return_exceptions=True,
    )

    news = results[0] if isinstance(results[0], dict) else {"error": str(results[0])}
    sentiment = (
        results[1] if isinstance(results[1], dict) else {"error": str(results[1])}
    )
    technical = (
        results[2] if isinstance(results[2], dict) else {"error": str(results[2])}
    )
    reddit_posts = results[3] if isinstance(results[3], list) else []
    x_posts = results[4] if isinstance(results[4], list) else []

    reddit_analysis = None
    if reddit_posts:
        posts_text = "\n".join(
            f"- r/{p['subreddit']} ({p['score']}pts): {p['title']}"
            for p in reddit_posts[:8]
        )
        reddit_analysis = await llm_chat(
            cfg["base_url"],
            cfg["headers"],
            cfg["quick_model"],
            system="You are a social sentiment analyst. Analyze Reddit posts for market insights. Respond ONLY with valid JSON.",
            user=f"Reddit posts for: {req.query}\n\n{posts_text}\n\n"
            'Return JSON: {"overall_sentiment": "bullish/bearish/neutral", "confidence": 0.0-1.0, '
            '"key_themes": [...], "contrarian_signals": [...]}',
        )

    x_analysis = None
    if x_posts:
        tweets_text = "\n".join(
            f"- {t['title']}: {t.get('content', '')[:200]}" for t in x_posts[:8]
        )
        x_analysis = await llm_chat(
            cfg["base_url"],
            cfg["headers"],
            cfg["quick_model"],
            system="You are a social media analyst. Analyze X/Twitter posts for market signals. Respond ONLY with valid JSON.",
            user=f"X/Twitter posts for: {req.query}\n\n{tweets_text}\n\n"
            'Return JSON: {"overall_sentiment": "bullish/bearish/neutral", "confidence": 0.0-1.0, '
            '"key_narratives": [...], "viral_signals": [...]}',
        )

    errors = []
    for name, data in [
        ("news", news),
        ("sentiment", sentiment),
        ("technical", technical),
    ]:
        if isinstance(data, dict) and "error" in data:
            errors.append(f"{name}: {data['error']}")

    return AnalyzeResponse(
        status="completed",
        query=req.query,
        news_report=news if "error" not in news else None,
        sentiment_report=sentiment if "error" not in sentiment else None,
        technical_report=technical if "error" not in technical else None,
        reddit_report={"posts": reddit_posts, "analysis": reddit_analysis}
        if reddit_analysis
        else ({"posts": reddit_posts} if reddit_posts else None),
        x_report={"tweets": x_posts, "analysis": x_analysis}
        if x_analysis
        else ({"tweets": x_posts} if x_posts else None),
        error="; ".join(errors) or None,
    )


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("TA_PORT", "8100"))
    uvicorn.run(app, host="0.0.0.0", port=port)
