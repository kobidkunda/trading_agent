# Market Detail & Full Audit Page Design

## Goal
Create a comprehensive drill-down page accessible from Market Triage, Research Ledger, and Simulation Lab that displays ALL information without skipping anything.

## Page: `/market/[id]/detail` or `/research/[runId]/full`

## Sections

### 1. Market Header
- Market title, description, venue, status
- Implied probability, spread, liquidity
- Resolution criteria and timeline
- External links (Polymarket, Kalshi, etc.)

### 2. Pipeline Execution Timeline
- Every single stage with timestamps
- Who/what ran at each stage
- Duration for each stage
- Status (started, running, completed, failed, skipped)
- Service name, provider, model used
- Full error messages if failed

### 3. Complete Source Inventory (500-600 sources)
**Group by Provider:**

#### DeerFlow Sources
- All search results (50-100)
- All extracted content
- Iteration details
- Model used at each step
- Queries issued

#### TradingAgents Sources  
- News reports (full content)
- Sentiment analysis (full content)
- Technical analysis (full content)
- Reddit posts (all 20-100 posts with full content)
  - Subreddit, score, comments, title, selftext
  - URL, permalink
- X/Twitter posts (all 20-100 tweets with full content)
  - Author, content, URL
- Fundamentals (full content)

#### Agent-Reach Sources
- All 100-300 sources
- MCP tool used
- Timestamp of fetch
- Content, URL, title, snippet

#### SearXNG Sources
- All 50 web results
- Domain, title, snippet, URL
- Engine that found it
- Recency/quality scores

### 4. Synthesis & Analysis
- Full synthesis text
- All findings (no truncation)
- All contradictions
- Consensus probability
- Agreements and disagreements
- Source-by-source comparison
- Confidence breakdown

### 5. Debate & Judge
- Full bull debate output
- Full bear debate output  
- Full contradiction output
- Full judge output
- Decision reasoning
- Model used for each
- Timestamp of each

### 6. Risk Engine
- All 10 risk checks
- Kelly calculation details
- Position sizing math
- Edge calculation
- Why BID/WATCH/SKIP was chosen
- Full reasoning

### 7. Decision & Execution
- Final decision (BID/WATCH/SKIP)
- Predicted probability
- Predicted side (YES/NO)
- Entry price
- Stake size
- Edge at time of decision
- Confidence level
- Full decision rationale

### 8. Paper Bet & Resolution (if resolved)
- Paper bet details
- Stake, entry price, predicted outcome
- Actual outcome (YES/NO)
- Resolved probability
- PnL calculation
- Brier score
- Direction accuracy
- When resolved
- How resolved (which venue, API response)

### 9. All Agent Outputs (Raw)
- Every single agent output stored
- Role, stage, provider, model
- Full output (not truncated)
- Raw output
- Summary
- References JSON
- Timing info

### 10. Audit Log
- Every action taken on this market
- Who/what triggered it
- When it happened
- What changed

## Navigation
- Click market in Market Triage → Opens this page
- Click decision in Research Ledger → Opens this page
- Click stage in Simulation Lab → Opens this page
- Back button returns to previous view

## UI Design
- Tabbed interface or collapsible sections
- Dark theme
- Copy button for raw JSON
- Export button for full report
- Search within the page
- Filter by provider
- Show/hide sections
