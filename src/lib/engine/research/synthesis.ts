import { callLLMJson } from '@/lib/engine/llm-client';
import type { TransparencySourceRef } from '@/lib/types';

interface SourceFindings {
  source: string;
  findings: string[];
  contradictions: string[];
  confidence: number;
  raw: string;
}

export interface SynthesisResult {
  summary: string;
  keyFindings: string[];
  agreements: string[];
  disagreements: string[];
  consensusProbability: number;
  sourceComparison: Array<{ source: string; sentiment: string; confidence: number }>;
  finalAssessment: string;
  confidence: number;
}

/** Extended synthesis detail for transparency/reuse */
export interface SynthesisDetail extends SynthesisResult {
  /** Model used for synthesis */
  modelUsed: string | null;
  /** Provider that performed synthesis (e.g., 'system', 'openai') */
  provider: string | null;
  /** Service name that performed synthesis (e.g., 'synthesis') */
  serviceName: string;
  /** Raw research sources that went into synthesis */
  sources: Array<{
    name: string;
    findings: string[];
    contradictions: string[];
    confidence: number;
    raw: string;
  }>;
  /** Extracted references for source provenance */
  references: TransparencySourceRef[];
  /** Timing metadata */
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
}

const SYNTHESIS_SYSTEM_PROMPT = `You are a research synthesis agent for a prediction market trading system. You receive findings from MULTIPLE independent research sources and must produce a unified analysis that:

1. IDENTIFIES AGREEMENT: Where do all sources agree? What's the consensus?
2. IDENTIFIES DISAGREEMENT: Where do sources conflict? What are the opposing views?
3. WEIGHTS CREDIBILITY: Which sources are more reliable for this type of question?
4. PRODUCES A FINAL ASSESSMENT: A single coherent conclusion that accounts for all evidence

Be precise with probability estimates. Always respond with valid JSON.`;

const SYNTHESIS_USER_PROMPT = `Synthesize the following research findings about: "{{market_title}}"

Current Implied Probability: {{implied_probability}}%

== NEWS ANALYST FINDINGS ==
{{news_findings}}

== SENTIMENT ANALYST FINDINGS ==
{{sentiment_findings}}

== TECHNICAL ANALYST FINDINGS ==
{{technical_findings}}

== DEERFLOW DEEP RESEARCH ==
{{deerflow_findings}}

== AGENT REACH FINDINGS ==
{{agent_reach_findings}}

== WEB SEARCH FINDINGS ==
{{search_findings}}

== REDDIT ANALYSIS ==
{{reddit_findings}}

== X/TWITTER ANALYSIS ==
{{x_findings}}

Respond in JSON:
{
  "summary": "One-paragraph unified summary of all evidence",
  "keyFindings": ["finding1", "finding2", ...],
  "agreements": ["point where sources agree", ...],
  "disagreements": ["point where sources disagree", ...],
  "consensusProbability": 0.XX,
  "sourceComparison": [
    {"source": "News Analyst", "sentiment": "bullish/bearish/neutral", "confidence": 0.XX},
    {"source": "Sentiment Analyst", "sentiment": "bullish/bearish/neutral", "confidence": 0.XX},
    {"source": "Technical Analyst", "sentiment": "bullish/bearish/neutral", "confidence": 0.XX},
    {"source": "DeerFlow Research", "sentiment": "bullish/bearish/neutral", "confidence": 0.XX},
    {"source": "Agent Reach", "sentiment": "bullish/bearish/neutral", "confidence": 0.XX},
    {"source": "Web Search", "sentiment": "bullish/bearish/neutral", "confidence": 0.XX},
    {"source": "Reddit", "sentiment": "bullish/bearish/neutral", "confidence": 0.XX},
    {"source": "X/Twitter", "sentiment": "bullish/bearish/neutral", "confidence": 0.XX}
  ],
  "finalAssessment": "Clear directional call with reasoning",
  "confidence": 0.XX
}`;

export async function synthesizeFindings(
  marketTitle: string,
  impliedProbability: number,
  news: SourceFindings | null,
  sentiment: SourceFindings | null,
  technical: SourceFindings | null,
  deerflow: SourceFindings | null,
  agentReach: SourceFindings | null,
  search: SourceFindings | null,
  reddit: SourceFindings | null = null,
  x: SourceFindings | null = null,
  model?: string,
): Promise<SynthesisResult> {
  const prompt = SYNTHESIS_USER_PROMPT
    .replace('{{market_title}}', marketTitle)
    .replace('{{implied_probability}}', String((impliedProbability * 100).toFixed(1)))
    .replace('{{news_findings}}', news ? formatSource(news) : 'No news analyst data available')
    .replace('{{sentiment_findings}}', sentiment ? formatSource(sentiment) : 'No sentiment analyst data available')
    .replace('{{technical_findings}}', technical ? formatSource(technical) : 'No technical analyst data available')
    .replace('{{deerflow_findings}}', deerflow ? formatSource(deerflow) : 'No DeerFlow research available')
    .replace('{{agent_reach_findings}}', agentReach ? formatSource(agentReach) : 'No Agent-Reach research available')
    .replace('{{search_findings}}', search ? formatSource(search) : 'No web search data available')
    .replace('{{reddit_findings}}', reddit ? formatSource(reddit) : 'No Reddit data available')
    .replace('{{x_findings}}', x ? formatSource(x) : 'No X/Twitter data available');

  try {
    const { data } = await callLLMJson<SynthesisResult>(prompt, SYNTHESIS_SYSTEM_PROMPT, model);

    return {
      summary: data.summary || 'Synthesis completed',
      keyFindings: data.keyFindings || [],
      agreements: data.agreements || [],
      disagreements: data.disagreements || [],
      consensusProbability: typeof data.consensusProbability === 'number' ? data.consensusProbability : impliedProbability,
      sourceComparison: data.sourceComparison || buildDefaultComparison(news, sentiment, technical, deerflow, agentReach, search, reddit, x),
      finalAssessment: data.finalAssessment || data.summary || 'No assessment',
      confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
    };
  } catch (e) {
    console.error('[Synthesis] LLM call failed, using fallback:', e);

    const allFindings: string[] = [];
    if (news) allFindings.push(...news.findings);
    if (sentiment) allFindings.push(...sentiment.findings);
    if (technical) allFindings.push(...technical.findings);
    if (deerflow) allFindings.push(...deerflow.findings);
    if (agentReach) allFindings.push(...agentReach.findings);
    if (search) allFindings.push(...search.findings);
    if (reddit) allFindings.push(...reddit.findings);
    if (x) allFindings.push(...x.findings);

    return {
      summary: allFindings.slice(0, 5).join('; ') || 'No research data available',
      keyFindings: allFindings.slice(0, 10),
      agreements: [],
      disagreements: [],
      consensusProbability: impliedProbability,
      sourceComparison: buildDefaultComparison(news, sentiment, technical, deerflow, agentReach, search, reddit, x),
      finalAssessment: allFindings.length > 0 ? 'Mixed signals - insufficient data for strong conclusion' : 'No data available',
      confidence: 0.3,
    };
  }
}

function formatSource(source: SourceFindings): string {
  const lines: string[] = [`[${source.source}] Confidence: ${(source.confidence * 100).toFixed(0)}%`];
  if (source.findings.length > 0) {
    lines.push('Findings:');
    source.findings.forEach((f) => lines.push(`  - ${f}`));
  }
  if (source.contradictions.length > 0) {
    lines.push('Contradictions:');
    source.contradictions.forEach((c) => lines.push(`  - ${c}`));
  }
  if (source.raw.length > 0) {
    lines.push(`Raw summary: ${source.raw.slice(0, 1000)}`);
  }
  return lines.join('\n');
}

function buildDefaultComparison(
  news: SourceFindings | null,
  sentiment: SourceFindings | null,
  technical: SourceFindings | null,
  deerflow: SourceFindings | null,
  agentReach: SourceFindings | null,
  search: SourceFindings | null,
  reddit: SourceFindings | null = null,
  x: SourceFindings | null = null,
): Array<{ source: string; sentiment: string; confidence: number }> {
  const result: Array<{ source: string; sentiment: string; confidence: number }> = [];
  if (news) result.push({ source: 'News Analyst', sentiment: 'neutral', confidence: news.confidence });
  if (sentiment) result.push({ source: 'Sentiment Analyst', sentiment: 'neutral', confidence: sentiment.confidence });
  if (technical) result.push({ source: 'Technical Analyst', sentiment: 'neutral', confidence: technical.confidence });
  if (deerflow) result.push({ source: 'DeerFlow Research', sentiment: 'neutral', confidence: deerflow.confidence });
  if (agentReach) result.push({ source: 'Agent Reach', sentiment: 'neutral', confidence: agentReach.confidence });
  if (search) result.push({ source: 'Web Search', sentiment: 'neutral', confidence: search.confidence });
  if (reddit) result.push({ source: 'Reddit', sentiment: 'neutral', confidence: reddit.confidence });
  if (x) result.push({ source: 'X/Twitter', sentiment: 'neutral', confidence: x.confidence });
  return result;
}

export function formatDeerFlowAsSource(result: {
  summary: string;
  keyFindings: string[];
  contradictions: string[];
  confidenceAssessment: number;
  sourceQuality: number;
}): SourceFindings {
  return {
    source: 'DeerFlow Research',
    findings: result.keyFindings,
    contradictions: result.contradictions,
    confidence: result.confidenceAssessment,
    raw: result.summary,
  };
}

export function formatSearchAsSource(results: Array<{ title: string; snippet: string }>): SourceFindings {
  return {
    source: 'Web Search (SearXNG)',
    findings: results.slice(0, 5).map((r) => `${r.title}: ${r.snippet}`),
    contradictions: [],
    confidence: 0.6,
    raw: results.map((r) => `${r.title}: ${r.snippet}`).join('\n').slice(0, 2000),
  };
}

export function formatAgentReachAsSource(result: {
  summary: string;
  sources: Array<{ title: string; url: string; snippet: string }>;
}): SourceFindings {
  return {
    source: 'Agent Reach',
    findings: result.sources.slice(0, 5).map((source) => `${source.title}: ${source.snippet}`),
    contradictions: [],
    confidence: result.sources.length > 0 ? 0.65 : 0.4,
    raw: [result.summary, ...result.sources.map((source) => `${source.title}: ${source.snippet}`)].join('\n').slice(0, 2000),
  };
}

export function formatTradingAgentsAsSource(
  result: {
    news_report?: Record<string, unknown> | null;
    sentiment_report?: Record<string, unknown> | null;
    technical_report?: Record<string, unknown> | null;
    fundamentals_report?: Record<string, unknown> | null;
    reddit_report?: Record<string, unknown> | null;
    x_report?: Record<string, unknown> | null;
    newsReport?: Record<string, unknown> | null;
    sentimentReport?: Record<string, unknown> | null;
    technicalReport?: Record<string, unknown> | null;
    fundamentalsReport?: Record<string, unknown> | null;
    redditReport?: Record<string, unknown> | null;
    xReport?: Record<string, unknown> | null;
    error?: string | null;
  },
  role: string,
): SourceFindings {
  const raw = JSON.stringify(result, null, 2).slice(0, 2000);
  const findings: string[] = [];
  let confidence = 0.5;

  if (result.error) {
    return { source: `TradingAgents ${role}`, findings: [`Error: ${result.error}`], contradictions: [], confidence: 0.2, raw };
  }

  const report = result.newsReport || result.sentimentReport || result.technicalReport || result.fundamentalsReport || result.news_report || result.sentiment_report || result.technical_report || result.fundamentals_report;
  if (report && typeof report === 'object') {
    for (const [key, value] of Object.entries(report)) {
      if (typeof value === 'string') findings.push(`${key}: ${value.slice(0, 200)}`);
      else if (typeof value === 'number') findings.push(`${key}: ${value}`);
    }
    confidence = 0.7;
  }

  return { source: `TradingAgents ${role}`, findings, contradictions: [], confidence, raw };
}

export function formatRedditAsSource(result: Record<string, unknown> | null): SourceFindings | null {
  if (!result) return null;
  const analysis = result.analysis as Record<string, unknown> | undefined;
  const posts = result.posts as Array<Record<string, unknown>> | undefined;
  const findings: string[] = [];
  let confidence = 0.55;

  if (analysis && typeof analysis === 'object') {
    if (typeof analysis.overall_sentiment === 'string') findings.push(`Reddit sentiment: ${analysis.overall_sentiment}`);
    if (typeof analysis.confidence === 'number') confidence = analysis.confidence;
    if (Array.isArray(analysis.key_themes)) findings.push(...(analysis.key_themes as string[]).slice(0, 3).map((t: string) => `Reddit theme: ${t}`));
    if (Array.isArray(analysis.contrarian_signals)) findings.push(...(analysis.contrarian_signals as string[]).slice(0, 2).map((s: string) => `Reddit contrarian: ${s}`));
  }

  if (posts && Array.isArray(posts)) {
    const topPosts = posts.slice(0, 5) as Array<Record<string, unknown>>;
    for (const p of topPosts) {
      findings.push(`r/${p.subreddit || 'unknown'} (${p.score || 0}pts): ${(p.title as string || '').slice(0, 100)}`);
    }
  }

  return {
    source: 'Reddit Analysis',
    findings,
    contradictions: [],
    confidence,
    raw: JSON.stringify(result).slice(0, 2000),
  };
}

export function formatXAsSource(result: Record<string, unknown> | null): SourceFindings | null {
  if (!result) return null;
  const analysis = result.analysis as Record<string, unknown> | undefined;
  const tweets = result.tweets as Array<Record<string, unknown>> | undefined;
  const findings: string[] = [];
  let confidence = 0.5;

  if (analysis && typeof analysis === 'object') {
    if (typeof analysis.overall_sentiment === 'string') findings.push(`X/Twitter sentiment: ${analysis.overall_sentiment}`);
    if (typeof analysis.confidence === 'number') confidence = analysis.confidence;
    if (Array.isArray(analysis.key_narratives)) findings.push(...(analysis.key_narratives as string[]).slice(0, 3).map((n: string) => `X narrative: ${n}`));
    if (Array.isArray(analysis.viral_signals)) findings.push(...(analysis.viral_signals as string[]).slice(0, 2).map((v: string) => `X viral: ${v}`));
  }

  if (tweets && Array.isArray(tweets)) {
    const topTweets = tweets.slice(0, 5) as Array<Record<string, unknown>>;
    for (const t of topTweets) {
      findings.push(`X: ${(t.title as string || '').slice(0, 100)}`);
    }
  }

  return {
    source: 'X/Twitter Analysis',
    findings,
    contradictions: [],
    confidence,
    raw: JSON.stringify(result).slice(0, 2000),
  };
}

/** Build a rich SynthesisDetail object for transparency/reuse */
export function buildSynthesisDetail(
  result: SynthesisResult,
  sources: SourceFindings[],
  options: {
    modelUsed?: string | null;
    provider?: string | null;
    serviceName?: string;
    startedAt?: string | null;
    endedAt?: string | null;
    references?: TransparencySourceRef[];
  } = {},
): SynthesisDetail {
  const started = options.startedAt ? Date.parse(options.startedAt) : Number.NaN;
  const ended = options.endedAt ? Date.parse(options.endedAt) : Number.NaN;

  return {
    ...result,
    modelUsed: options.modelUsed ?? null,
    provider: options.provider ?? 'system',
    serviceName: options.serviceName ?? 'synthesis',
    sources: sources.map((s) => ({
      name: s.source,
      findings: s.findings,
      contradictions: s.contradictions,
      confidence: s.confidence,
      raw: s.raw,
    })),
    references: options.references ?? [],
    startedAt: options.startedAt ?? null,
    endedAt: options.endedAt ?? null,
    durationMs: Number.isFinite(started) && Number.isFinite(ended) ? ended - started : null,
  };
}