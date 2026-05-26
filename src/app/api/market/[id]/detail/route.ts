import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

type LegacySource = {
  id: string;
  title?: string | null;
  url?: string | null;
  content?: string | null;
  sourceType?: string | null;
  provider?: string | null;
};

type LegacyAgentOutput = {
  role: string;
  output: string;
  summary?: string | null;
  provider?: string | null;
  modelUsed?: string | null;
  rawOutput?: string | null;
  referencesJson?: string | null;
  failureReason?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  confidence?: number | null;
  stage?: string | null;
  serviceName?: string | null;
};

type ProviderKey = 'deerflow' | 'reddit' | 'twitter' | 'agentReach' | 'searxng';

type StageTransition = {
  from: string;
  to: string;
  timestamp: string;
  reason?: string;
  jobId?: string;
};

const SOURCE_RELEVANCE_STOPWORDS = new Set([
  'will', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'market', 'markets',
  'prediction', 'predict', 'advance', 'before', 'after', 'over', 'under', 'yes',
  'win', 'wins', 'winner', 'score', 'points', 'primary', 'nominee', 'election',
  'between', 'margin', 'victory', 'target', 'price', 'picked', 'round', 'top',
  'republican', 'republicans', 'democratic', 'democrat', 'democrats', 'senate',
  'house', 'runoff', 'governor', 'texas',
]);

const GENERIC_SOURCE_TITLES = new Set([
  'twitter',
  'twitter it s what s happening twitter',
  'x twitter post',
  'reddit post',
]);

const WEAK_ENTITY_TOKENS = new Set([
  'china', 'india', 'russia', 'israel', 'iran', 'japan', 'google', 'spotify',
  'trump', 'biden', 'democrat', 'republican',
]);

function safeJsonParse<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function extractStructuredFailure(output: LegacyAgentOutput): string | null {
  const parsed = safeJsonParse<{ status?: string; error?: string; message?: string; summary?: string }>(output.output);
  if (parsed?.status && ['failed', 'error'].includes(String(parsed.status).toLowerCase())) {
    return parsed.summary || parsed.message || parsed.error || output.summary || output.rawOutput || output.output || null;
  }
  return output.failureReason || null;
}

function parseStageTransitions(value: string | null | undefined): StageTransition[] {
  const parsed = safeJsonParse<unknown>(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is StageTransition => {
    const row = item as Partial<StageTransition>;
    return typeof row.from === 'string' && typeof row.to === 'string' && typeof row.timestamp === 'string';
  });
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function normalizeRelevanceText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripSourceDiagnostics(value: string): string {
  return value
    .replace(/\bMissing:\s*[^"'\n.]+/gi, ' ')
    .replace(/\bShow results with:\s*[^"'\n.]+/gi, ' ');
}

function marketNamedTokens(marketTitle: string): string[] {
  return Array.from(new Set(
    marketTitle
      .replace(/['']/g, '')
      .split(/[^A-Za-z0-9]+/)
      .filter((token) =>
        /^[A-Z][A-Za-z0-9]{2,}$/.test(token) &&
        !SOURCE_RELEVANCE_STOPWORDS.has(token.toLowerCase()) &&
        !['Will', 'Game'].includes(token)
      )
      .map((token) => token.toLowerCase()),
  ));
}

function sourceMatchesMarket(marketTitle: string, sourceText: string): boolean {
  const haystack = normalizeRelevanceText(stripSourceDiagnostics(sourceText));
  if (!haystack || GENERIC_SOURCE_TITLES.has(haystack)) return false;

  const tokens = normalizeRelevanceText(marketTitle)
    .split(' ')
    .filter((token) => /[a-z]/.test(token) && token.length >= 4 && !SOURCE_RELEVANCE_STOPWORDS.has(token));
  const namedTokens = marketNamedTokens(marketTitle);
  const namedHits = namedTokens.filter((token) => haystack.includes(token)).length;
  const strongNamedHits = namedTokens.filter((token) => !WEAK_ENTITY_TOKENS.has(token) && haystack.includes(token)).length;
  const tokenHits = tokens.filter((token) => haystack.includes(token)).length;
  const adjacentHit = tokens.some((token, index) => {
    const next = tokens[index + 1];
    return next ? haystack.includes(`${token} ${next}`) : false;
  });

  if (namedTokens.length > 0) {
    const requiredHits = tokens.length <= 2 ? 1 : Math.min(3, tokens.length);
    const weakEntityFullMatch = tokenHits >= Math.min(4, Math.max(3, tokens.length));
    const hasReliableEntityMatch = strongNamedHits > 0 || namedHits >= 2 || weakEntityFullMatch;
    return hasReliableEntityMatch && (tokenHits >= requiredHits || adjacentHit);
  }
  return tokenHits >= Math.min(2, tokens.length);
}

function filterSourcesForMarket<T extends LegacySource>(marketTitle: string, items: T[]): T[] {
  return items.filter((source) =>
    sourceMatchesMarket(
      marketTitle,
      [source.title, source.content, source.url].filter(Boolean).join(' '),
    ),
  );
}

function filterSourcesForMarketWithFallback<T extends LegacySource>(marketTitle: string, items: T[]): T[] {
  return filterSourcesForMarket(marketTitle, items);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const includePaperBet = searchParams.get('paperBet') !== 'false';

    // Fetch market with all related data
    const market = await db.market.findUnique({
      where: { id },
      include: {
        snapshots: { orderBy: { timestamp: 'desc' } },
        tradeCandidates: { orderBy: { updatedAt: 'desc' } },
        researchRuns: {
          orderBy: { startedAt: 'desc' },
          include: {
            sources: true,
            agentOutputs: true,
          },
        },
        decisions: {
          orderBy: { createdAt: 'desc' },
        },
        outcomes: {
          orderBy: { resolvedAt: 'desc' },
        },
        paperBets: {
          orderBy: { updatedAt: 'desc' },
          take: 1,
        },
        postmortems: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 });
    }

    const marketAny = market as typeof market & Record<string, any>;
    const latestSnapshot = marketAny.snapshots[0];
    const latestCandidate = marketAny.tradeCandidates[0] as Record<string, any> | undefined;
    const latestResearch = marketAny.researchRuns[0] as (Record<string, any> & {
      sources?: LegacySource[];
      agentOutputs?: LegacyAgentOutput[];
    }) | undefined;
    const latestDecision = marketAny.decisions[0] as Record<string, any> | undefined;
    const latestOutcome = marketAny.outcomes[0] as Record<string, any> | undefined;
    const latestPaperBet = marketAny.paperBets[0] as Record<string, any> | undefined;

    const researchRuns = (marketAny.researchRuns || []) as Array<Record<string, any> & {
      sources?: LegacySource[];
      agentOutputs?: LegacyAgentOutput[];
    }>;

    // Group sources by provider (handle both provider field and sourceType field)
    const sources = researchRuns.flatMap((run) => (run.sources || []) as LegacySource[]);
    const allAgentOutputs = researchRuns.flatMap((run) => (run.agentOutputs || []) as LegacyAgentOutput[]);
    
    // If provider is null, infer from sourceType or URL
    const sourcesWithProvider = sources.map((s) => {
      if (s.provider) return { ...s, provider: String(s.provider).toUpperCase() };
      
      // Infer provider from sourceType or URL patterns
      let inferredProvider = s.provider;
      const url = s.url || '';
      const type = (s.sourceType || '').toUpperCase();
      
      if (type === 'REDDIT' || url.includes('reddit.com')) {
        inferredProvider = 'REDDIT';
      } else if (type === 'TWITTER' || type === 'X' || url.includes('twitter.com') || url.includes('x.com')) {
        inferredProvider = 'TWITTER';
      } else if (url.includes('deerflow') || type === 'CRAWL') {
        inferredProvider = 'DEERFLOW';
      } else if (type === 'AGENT_REACH' || url.includes('agent-reach') || url.includes('agentreach')) {
        inferredProvider = 'AGENT_REACH';
      } else if (type === 'SEARCH' || type === 'WEB') {
        inferredProvider = 'SEARXNG';
      }
      
      return { ...s, provider: inferredProvider ? String(inferredProvider).toUpperCase() : inferredProvider };
    });
    
    let deerflowSources = sourcesWithProvider.filter(s => 
      s.provider === 'DEERFLOW' || s.sourceType === 'DEERFLOW' || s.sourceType === 'CRAWL'
    );
    let redditSources = sourcesWithProvider.filter(s => 
      s.provider === 'REDDIT' || s.sourceType === 'REDDIT'
    );
    let twitterSources = sourcesWithProvider.filter(s => 
      s.provider === 'TWITTER' || s.provider === 'X' || s.sourceType === 'TWITTER' || s.sourceType === 'X'
    );
    let agentReachSources = sourcesWithProvider.filter(s => 
      s.provider === 'AGENT_REACH' || s.sourceType === 'AGENT_REACH'
    );
    const searxngSources = sourcesWithProvider.filter(s => 
      s.provider === 'SEARXNG' || s.sourceType === 'SEARXNG' || s.provider === 'WEB' || s.sourceType === 'SEARCH' || s.sourceType === 'WEB'
    );
    const rawProviderCounts = {
      deerflow: deerflowSources.length,
      reddit: redditSources.length,
      twitter: twitterSources.length,
      agentReach: agentReachSources.length,
      searxng: searxngSources.length,
    };

    if (allAgentOutputs.length) {
      for (const output of allAgentOutputs) {
        if (output.role === 'DEERFLOW') {
          const parsed = safeJsonParse<{ allSearchResults?: Array<{ title: string; url: string; snippet?: string }>; allExtractedContent?: Array<{ title: string; url: string; content?: string }> }>(output.output);
          if (parsed?.allSearchResults?.length) {
            deerflowSources = deerflowSources.concat(
              parsed.allSearchResults.map((source, index) => ({
                id: `deerflow-search-${index}`,
                provider: 'DEERFLOW',
                sourceType: 'DEERFLOW',
                title: source.title,
                url: source.url,
                content: source.snippet || '',
              }))
            );
          }
          if (parsed?.allExtractedContent?.length) {
            deerflowSources = deerflowSources.concat(
              parsed.allExtractedContent.map((source, index) => ({
                id: `deerflow-crawl-${index}`,
                provider: 'DEERFLOW',
                sourceType: 'CRAWL',
                title: source.title,
                url: source.url,
                content: source.content || '',
              }))
            );
          }
        }

        if (output.role === 'REDDIT_ANALYST') {
          const parsed = safeJsonParse<{ posts?: Array<Record<string, unknown>> }>(output.output);
          if (parsed?.posts?.length) {
            redditSources = redditSources.concat(
              parsed.posts.map((post, index) => ({
                id: `reddit-output-${index}`,
                provider: 'REDDIT',
                sourceType: 'REDDIT',
                title: String(post.title || ''),
                url: String(post.url || `https://reddit.com/r/${post.subreddit || 'unknown'}`),
                content: JSON.stringify(post),
              }))
            );
          }
        }

        if (output.role === 'X_ANALYST') {
          const parsed = safeJsonParse<{ tweets?: Array<Record<string, unknown>> }>(output.output);
          if (parsed?.tweets?.length) {
            twitterSources = twitterSources.concat(
              parsed.tweets.map((tweet, index) => ({
                id: `x-output-${index}`,
                provider: 'TWITTER',
                sourceType: 'X',
                title: String(tweet.title || ''),
                url: String(tweet.url || 'https://x.com'),
                content: JSON.stringify(tweet),
              }))
            );
          }
        }

        if (output.role === 'AGENT_REACH') {
          const parsed = safeJsonParse<{ sources?: Array<{ title?: string; url?: string; snippet?: string }> }>(output.output);
          if (parsed?.sources?.length) {
            agentReachSources = agentReachSources.concat(
              parsed.sources.map((source, index) => ({
                id: `agent-reach-output-${index}`,
                provider: 'AGENT_REACH',
                sourceType: 'AGENT_REACH',
                title: source.title || '',
                url: source.url || '',
                content: source.snippet || '',
              }))
            );
          }
        }
      }
    }

    const dedupeByUrl = <T extends { url?: string | null }>(items: T[]) => {
      const seen = new Set<string>();
      return items.filter((item) => {
        const key = item.url || JSON.stringify(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    deerflowSources = dedupeByUrl(filterSourcesForMarketWithFallback(market.title, deerflowSources));
    redditSources = dedupeByUrl(filterSourcesForMarketWithFallback(market.title, redditSources));
    twitterSources = dedupeByUrl(filterSourcesForMarketWithFallback(market.title, twitterSources));
    agentReachSources = dedupeByUrl(filterSourcesForMarketWithFallback(market.title, agentReachSources));
    const filteredSearxngSources = dedupeByUrl(filterSourcesForMarketWithFallback(market.title, searxngSources));

    const sourceErrors: Record<ProviderKey, Array<{ role: string; serviceName: string | null; message: string; modelUsed: string | null }>> = {
      deerflow: [],
      reddit: [],
      twitter: [],
      agentReach: [],
      searxng: [],
    };

    const providerKeyForOutput = (output: LegacyAgentOutput): ProviderKey | null => {
      const role = output.role.toUpperCase();
      const service = (output.serviceName || output.provider || '').toUpperCase();
      if (role.includes('DEERFLOW') || service.includes('DEERFLOW')) return 'deerflow';
      if (role.includes('REDDIT')) return 'reddit';
      if (role.includes('X_ANALYST') || role.includes('TWITTER') || service.includes('TWITTER')) return 'twitter';
      if (role.includes('AGENT_REACH') || service.includes('AGENT_REACH')) return 'agentReach';
      if (role.includes('SEARCH') || role.includes('SEARXNG') || service.includes('SEARXNG')) return 'searxng';
      return null;
    };

    for (const output of allAgentOutputs) {
      const key = providerKeyForOutput(output);
      if (!key) continue;
      const structuredFailure = extractStructuredFailure(output);
      const text = structuredFailure || output.summary || output.rawOutput || output.output || '';
      const failed = Boolean(structuredFailure) || /\bFAILED\b|\berror\b|unavailable|timeout|aborted/i.test(text);
      if (!failed) continue;
      sourceErrors[key].push({
        role: output.role,
        serviceName: output.serviceName || output.provider || null,
        message: text.slice(0, 1000),
        modelUsed: output.modelUsed || null,
      });
    }

    if (latestResearch?.status === 'FAILED') {
      const genericFailure = (() => {
        const failedOutput = (latestResearch.agentOutputs || []).find((output) => output.failureReason || output.summary || output.rawOutput);
        return failedOutput?.failureReason || failedOutput?.summary || failedOutput?.rawOutput || 'Research run failed before this provider produced sources.';
      })();
      const ensureFailure = (key: ProviderKey, hasSources: boolean) => {
        if (!hasSources && sourceErrors[key].length === 0) {
          sourceErrors[key].push({
            role: 'RESEARCH_FAILED',
            serviceName: key,
            message: genericFailure,
            modelUsed: null,
          });
        }
      };
      ensureFailure('reddit', redditSources.length > 0);
      ensureFailure('twitter', twitterSources.length > 0);
      ensureFailure('agentReach', agentReachSources.length > 0);
      ensureFailure('searxng', filteredSearxngSources.length > 0);
    }

    const explainFilteredSources = (key: ProviderKey, rawCount: number, usableCount: number) => {
      if (rawCount > 0 && usableCount === 0 && sourceErrors[key].length === 0) {
        sourceErrors[key].push({
          role: 'FILTERED_NOISY_SOURCES',
          serviceName: key,
          message: `${rawCount} raw source${rawCount === 1 ? '' : 's'} captured, but 0 matched this market after relevance filtering. Hidden to avoid noisy or duplicate research evidence.`,
          modelUsed: null,
        });
      }
    };
    explainFilteredSources('deerflow', rawProviderCounts.deerflow, deerflowSources.length);
    explainFilteredSources('reddit', rawProviderCounts.reddit, redditSources.length);
    explainFilteredSources('twitter', rawProviderCounts.twitter, twitterSources.length);
    explainFilteredSources('agentReach', rawProviderCounts.agentReach, agentReachSources.length);
    explainFilteredSources('searxng', rawProviderCounts.searxng, filteredSearxngSources.length);

    const explainEmptyProviderOutput = (
      key: ProviderKey,
      hasSources: boolean,
      matchingOutputs: LegacyAgentOutput[],
      itemLabel: string,
    ) => {
      if (hasSources || sourceErrors[key].length > 0 || matchingOutputs.length === 0) return;

      const providerOutput = matchingOutputs.find((output) => {
        const parsed = safeJsonParse<Record<string, unknown>>(output.output);
        if (!parsed) return false;
        if (['failed', 'error'].includes(String(parsed.status || '').toLowerCase())) return true;
        const possibleLists = ['posts', 'tweets', 'sources', 'results']
          .map((field) => parsed[field])
          .filter(Array.isArray) as unknown[][];
        return possibleLists.some((items) => items.length === 0);
      }) ?? matchingOutputs[0];
      const structuredFailure = extractStructuredFailure(providerOutput);

      sourceErrors[key].push({
        role: providerOutput.role,
        serviceName: providerOutput.serviceName || providerOutput.provider || key,
        message: structuredFailure || `${providerOutput.role} ran, but returned 0 usable ${itemLabel} for this market. The panel is empty because the provider output had no matching evidence to persist.`,
        modelUsed: providerOutput.modelUsed || null,
      });
    };

    explainEmptyProviderOutput(
      'reddit',
      redditSources.length > 0,
      allAgentOutputs.filter((output) => output.role.toUpperCase().includes('REDDIT')),
      'Reddit posts',
    );
    explainEmptyProviderOutput(
      'twitter',
      twitterSources.length > 0,
      allAgentOutputs.filter((output) => output.role.toUpperCase().includes('X_ANALYST') || output.role.toUpperCase().includes('TWITTER')),
      'X/Twitter posts',
    );
    explainEmptyProviderOutput(
      'agentReach',
      agentReachSources.length > 0,
      allAgentOutputs.filter((output) => output.role.toUpperCase().includes('AGENT_REACH') || (output.serviceName || '').toUpperCase().includes('AGENT_REACH')),
      'Agent-Reach sources',
    );

    if (deerflowSources.length === 0 && sourceErrors.deerflow.length === 0) {
      sourceErrors.deerflow.push({
        role: 'DEERFLOW_UNAVAILABLE',
        serviceName: 'deerflow',
        message: 'DeerFlow is unavailable/disabled in this environment, so the engine does not persist DeerFlow sources. The active FULL path uses SearXNG, TradingAgents, Agent-Reach, synthesis, debate, judge, and risk instead.',
        modelUsed: null,
      });
    }

    // Parse synthesis from latest research
    let synthesis: Record<string, unknown> | null = null;
    if (latestResearch?.synthesis) {
      try {
        const syn = typeof latestResearch.synthesis === 'string' 
          ? JSON.parse(latestResearch.synthesis)
          : latestResearch.synthesis;
        synthesis = {
          summary: syn.summary || '',
          findings: syn.findings || [],
          contradictions: syn.contradictions || [],
          consensusProbability: syn.consensusProbability || syn.consensusProb || 0,
          agreements: syn.agreements || [],
          disagreements: syn.disagreements || [],
          finalAssessment: syn.finalAssessment || '',
          confidence: syn.confidence || 0,
          sourceComparisons: syn.sourceComparisons || [],
        };
      } catch {
        synthesis = {
          summary: String(latestResearch.synthesis),
          findings: [],
          contradictions: [],
          consensusProbability: 0,
          agreements: [],
          disagreements: [],
          finalAssessment: '',
          confidence: 0,
          sourceComparisons: [],
        };
      }
    }

    // Parse debate from agent outputs (handle both old format 'BULL' and new format 'DEBATE_ROUND_1_BULL')
    // Pick the best/latest round - prefer ROUND_2 over ROUND_1 if available and has more content
    let debate: Record<string, unknown> | null = null;
    if (latestResearch?.agentOutputs) {
      // Find all bull/bear outputs and pick the one with most content
      const allBullOutputs = latestResearch.agentOutputs.filter((a) => 
        a.role === 'BULL' || a.role.includes('BULL')
      );
      const allBearOutputs = latestResearch.agentOutputs.filter((a) => 
        a.role === 'BEAR' || a.role.includes('BEAR')
      );
      const allContradictionOutputs = latestResearch.agentOutputs.filter((a) => 
        a.role === 'CONTRADICTION' || a.role.includes('CONTRADICTION')
      );
      const allJudgeOutputs = latestResearch.agentOutputs.filter((a) => 
        a.role === 'JUDGE' || a.role.includes('JUDGE') || a.role.includes('ARBITER')
      );
      
      // Pick the output with the most content (prefer real analysis over "unavailable" placeholders)
      const pickBestOutput = (outputs: typeof allBullOutputs) => {
        if (outputs.length === 0) return null;
        if (outputs.length === 1) return outputs[0];
        // Sort by output length descending
        return outputs.sort((a, b) => (b.output?.length || 0) - (a.output?.length || 0))[0];
      };
      
      const bullOutput = pickBestOutput(allBullOutputs);
      const bearOutput = pickBestOutput(allBearOutputs);
      const contradictionOutput = pickBestOutput(allContradictionOutputs);
      const judgeOutput = pickBestOutput(allJudgeOutputs);

      if (bullOutput || bearOutput || judgeOutput) {
        debate = {
          bullOutput: bullOutput?.output || '',
          bearOutput: bearOutput?.output || '',
          contradictionOutput: contradictionOutput?.output || '',
          judgeOutput: judgeOutput?.output || '',
          decision: judgeOutput ? parseJudgeDecision(judgeOutput.output) : '',
          confidence: judgeOutput?.confidence || 0,
        };
      }
    }

    // Parse risk from latest decision
    let risk: Record<string, unknown> | null = null;
    if (latestDecision) {
      try {
        const riskChecks = typeof latestDecision.riskChecks === 'string'
          ? JSON.parse(latestDecision.riskChecks)
          : latestDecision.riskChecks || [];
        risk = {
          checks: riskChecks,
          kellyFraction: latestDecision.kellyFraction || 0,
          positionSize: latestDecision.positionSize || 0,
          edge: latestDecision.edge || 0,
          finalDecision: latestDecision.action as 'BID' | 'WATCH' | 'SKIP',
        };
      } catch {
        risk = {
          checks: [],
          kellyFraction: 0,
          positionSize: 0,
          edge: latestDecision.edge || 0,
          finalDecision: latestDecision.action as 'BID' | 'WATCH' | 'SKIP',
        };
      }
    }

    // Decision data
    const decision = latestDecision ? {
      predictedProb: latestDecision.judgeProbability || latestDecision.predictedProbability || 0,
      predictedSide: (latestDecision.side || 'YES') as 'YES' | 'NO',
      entryPrice: latestDecision.entryPrice || 0,
      stake: latestDecision.stake || 0,
      confidence: latestDecision.confidence || 0,
      rationale: latestDecision.reason || '',
    } : null;

    // Paper bet data
    let paperBet: Record<string, unknown> | null = null;
    if (includePaperBet && latestPaperBet) {
      paperBet = {
        id: latestPaperBet.id,
        orderId: latestPaperBet.orderId || null,
        executionStatus: latestPaperBet.executionStatus || null,
        stake: latestPaperBet.stake || 0,
        entryPrice: latestPaperBet.entryPrice || 0,
        predictedProb: latestPaperBet.predictedProb || null,
        predictedSide: latestPaperBet.predictedSide as 'YES' | 'NO',
        actualOutcome: latestPaperBet.actualOutcome as 'YES' | 'NO' | 'CANCELLED' | null,
        resolvedProb: latestPaperBet.resolvedProb || null,
        pnl: latestPaperBet.pnl || null,
        brierScore: latestPaperBet.brierScore || null,
        directionCorrect: latestPaperBet.directionCorrect || null,
        createdAt: latestPaperBet.createdAt?.toISOString() || null,
        executedAt: latestPaperBet.executedAt?.toISOString() || null,
        resolvedAt: latestPaperBet.resolvedAt?.toISOString() || null,
      };
    }

    // Pipeline stages from transparency stages plus durable DB milestones.
    const explicitStages = ((latestResearch?.transparencyStages as any[]) || []).map((stage: any) => ({
        stage: stage.stage || 'UNKNOWN',
        status: stage.status || 'completed',
        startedAt: stage.startedAt || latestResearch?.startedAt?.toISOString(),
        endedAt: stage.endedAt || latestResearch?.completedAt?.toISOString(),
        duration: stage.duration || stage.latencyMs || 0,
        serviceName: stage.serviceName || '',
        provider: stage.provider || '',
        model: stage.model || '',
        message: stage.message || '',
        failureReason: stage.failureReason || null,
      }));
    const transitionStages = parseStageTransitions(latestCandidate?.reprocessReason).map((transition) => ({
      stage: transition.to,
      status: 'completed',
      startedAt: transition.timestamp,
      endedAt: transition.timestamp,
      duration: 0,
      serviceName: transition.jobId ? `job:${transition.jobId}` : 'worker',
      provider: 'system',
      model: '',
      message: `${transition.from} → ${transition.to}${transition.reason ? `: ${transition.reason}` : ''}`,
      failureReason: null,
    }));
    const derivedMilestones = [
      latestCandidate
        ? {
            stage: latestCandidate.stage || 'SCANNED',
            status: 'completed',
            startedAt: toIso(latestCandidate.createdAt) || toIso(latestCandidate.updatedAt),
            endedAt: toIso(latestCandidate.updatedAt),
            duration: 0,
            serviceName: 'candidate-engine',
            provider: 'system',
            model: '',
            message: latestCandidate.skipReason
              ? `Candidate stage ${latestCandidate.stage || 'SCANNED'}: ${latestCandidate.skipReason}`
              : `Candidate stage ${latestCandidate.stage || 'SCANNED'} with score ${latestCandidate.candidateScore ?? '—'}.`,
            failureReason: latestCandidate.lastError || null,
          }
        : null,
      latestResearch
        ? {
            stage: `RESEARCH_${latestResearch.depth || 'UNKNOWN'}`,
            status: latestResearch.status || 'UNKNOWN',
            startedAt: toIso(latestResearch.startedAt) || toIso(latestResearch.createdAt),
            endedAt: toIso(latestResearch.completedAt),
            duration: 0,
            serviceName: 'research-run',
            provider: 'system',
            model: '',
            message: latestResearch.status === 'FAILED'
              ? 'Research failed. See provider errors and agent outputs below.'
              : `Research status: ${latestResearch.status}; sources=${sources.length}; agentOutputs=${allAgentOutputs.length}.`,
            failureReason: latestResearch.status === 'FAILED' ? 'Research run failed before producing required sources/decision.' : null,
          }
        : null,
      latestDecision
        ? {
            stage: `DECISION_${latestDecision.action || 'UNKNOWN'}`,
            status: 'completed',
            startedAt: toIso(latestDecision.createdAt),
            endedAt: toIso(latestDecision.createdAt),
            duration: 0,
            serviceName: 'judge-risk',
            provider: 'system',
            model: '',
            message: `${latestDecision.action || 'UNKNOWN'} ${latestDecision.side || ''} edge=${latestDecision.edge ?? '—'} confidence=${latestDecision.confidence ?? '—'}. ${latestDecision.reason || ''}`.trim(),
            failureReason: latestDecision.reasonCode && latestDecision.action === 'SKIP' ? latestDecision.reasonCode : null,
          }
        : null,
      risk
        ? {
            stage: 'RISK_CHECKED',
            status: risk.finalDecision === 'SKIP' ? 'blocked' : 'completed',
            startedAt: toIso(latestDecision?.createdAt),
            endedAt: toIso(latestDecision?.createdAt),
            duration: 0,
            serviceName: 'risk-engine',
            provider: 'system',
            model: '',
            message: `Risk final decision: ${risk.finalDecision}; edge=${risk.edge ?? '—'}.`,
            failureReason: risk.finalDecision === 'SKIP' ? latestDecision?.reasonCode || latestDecision?.reason || null : null,
          }
        : null,
      latestPaperBet
        ? {
            stage: 'PAPER_EXECUTED',
            status: latestPaperBet.executionStatus || 'UNKNOWN',
            startedAt: toIso(latestPaperBet.createdAt),
            endedAt: toIso(latestPaperBet.executedAt) || toIso(latestPaperBet.updatedAt),
            duration: 0,
            serviceName: 'paper-execution',
            provider: 'system',
            model: '',
            message: `Paper bet ${latestPaperBet.executionStatus || 'UNKNOWN'} ${latestPaperBet.predictedSide || ''}; stake=${latestPaperBet.stake ?? '—'} entry=${latestPaperBet.entryPrice ?? '—'}.`,
            failureReason: ['FAILED', 'CANCELLED', 'EXPIRED'].includes(String(latestPaperBet.executionStatus || '').toUpperCase())
              ? String(latestPaperBet.actualOutcome || latestPaperBet.executionStatus || '')
              : null,
          }
        : null,
      latestOutcome
        ? {
            stage: 'RESOLVED',
            status: 'completed',
            startedAt: toIso(latestOutcome.resolvedAt),
            endedAt: toIso(latestOutcome.resolvedAt),
            duration: 0,
            serviceName: latestOutcome.source || 'resolution',
            provider: 'system',
            model: '',
            message: `Outcome resolved as ${latestOutcome.result || latestOutcome.outcome || 'UNKNOWN'}.`,
            failureReason: null,
          }
        : null,
    ].filter(Boolean) as Array<{
      stage: string;
      status: string;
      startedAt: string | null;
      endedAt: string | null;
      duration: number;
      serviceName: string;
      provider: string;
      model: string;
      message: string;
      failureReason: string | null;
    }>;
    const failureStages = latestResearch
      ? (latestResearch.agentOutputs || [])
          .filter((output) => extractStructuredFailure(output) || /\bFAILED\b|\berror\b|unavailable|timeout|aborted/i.test(output.summary || output.rawOutput || output.output || ''))
          .map((output) => ({
            stage: output.stage || output.role || 'AGENT_OUTPUT',
            status: 'FAILED',
            startedAt: toIso(output.startedAt) || toIso(latestResearch.startedAt) || toIso(latestResearch.createdAt),
            endedAt: toIso(output.endedAt) || toIso(latestResearch.completedAt),
            duration: 0,
            serviceName: output.serviceName || '',
            provider: output.provider || '',
            model: output.modelUsed || '',
            message: output.summary || output.rawOutput || output.output || '',
            failureReason: extractStructuredFailure(output) || output.summary || output.rawOutput || null,
          }))
      : [];
    const dedupeStages = (stages: typeof derivedMilestones) => {
      const seen = new Set<string>();
      return stages.filter((stage) => {
        const key = `${stage.stage}|${stage.startedAt || ''}|${stage.message || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const pipeline = {
      stages: dedupeStages([
        ...transitionStages,
        ...derivedMilestones,
        ...explicitStages,
        ...failureStages,
      ]).sort((a, b) => {
        const aTime = Date.parse(a.startedAt || a.endedAt || '') || 0;
        const bTime = Date.parse(b.startedAt || b.endedAt || '') || 0;
        return aTime - bTime;
      }),
    };

    // Agent outputs
    const agentOutputs = (latestResearch?.agentOutputs || []).map((a) => ({
      role: a.role,
      stage: a.role,
      serviceName: a.serviceName || a.provider || '',
      provider: a.provider || '',
      modelUsed: a.modelUsed || '',
      output: a.output || '',
      rawOutput: a.rawOutput || '',
      summary: a.summary || null,
      referencesJson: a.referencesJson || null,
      failureReason: extractStructuredFailure(a) || a.failureReason || null,
      startedAt: a.startedAt?.toISOString() || null,
      endedAt: a.endedAt?.toISOString() || null,
    }));

    // Audit log from market changes
    const auditLog = await db.auditLog.findMany({
      where: { entityType: 'Market', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const response = {
      market: {
        id: market.id,
        title: market.title,
        description: market.description || '',
        venue: market.venue,
        status: market.status,
        externalId: market.externalId,
        impliedProb: latestSnapshot?.impliedProb || 0,
        spread: latestSnapshot?.spread || 0,
        liquidity: latestSnapshot?.liquidity || 0,
        resolutionTime: market.resolutionTime?.toISOString() || null,
        resolutionCriteria: marketAny.resolutionCriteria || '',
        category: market.category,
      },
      candidate: latestCandidate
        ? {
            id: latestCandidate.id,
            stage: latestCandidate.stage || 'SCANNED',
            candidateScore: latestCandidate.candidateScore ?? null,
            triageStatus: latestCandidate.triageStatus ?? null,
            researchQueued: Boolean(latestCandidate.researchQueued),
            skipReason: latestCandidate.skipReason ?? null,
            lastProcessedAt: latestCandidate.lastProcessedAt?.toISOString() || null,
            updatedAt: latestCandidate.updatedAt?.toISOString() || null,
          }
        : null,
      counts: {
        researchRuns: marketAny.researchRuns.length,
        decisions: marketAny.decisions.length,
        outcomes: marketAny.outcomes.length,
        postmortems: marketAny.postmortems.length,
        orderbookSnapshots: await db.orderbookSnapshot.count({ where: { marketId: id } }),
      },
      researchRuns: researchRuns.map((run) => ({
        id: run.id,
        status: run.status,
        depth: run.depth,
        startedAt: toIso(run.startedAt),
        completedAt: toIso(run.completedAt),
        createdAt: toIso(run.createdAt),
        sourceCount: (run.sources || []).length,
        agentOutputCount: (run.agentOutputs || []).length,
      })),
      pipeline,
      sources: {
        deerflow: deerflowSources.map(s => ({
          title: s.title || '',
          url: s.url || '',
          snippet: s.content || '',
          sourceType: s.sourceType || 'DEERFLOW',
        })),
        reddit: redditSources.map(s => {
          const content = s.content || '';
          let parsed: any = {};
          try {
            parsed = JSON.parse(content);
          } catch {
            parsed = { title: content };
          }
          return {
            title: parsed.title || s.title || '',
            url: s.url || '',
            subreddit: parsed.subreddit || '',
            score: parsed.score || 0,
            numComments: parsed.numComments || 0,
            selftext: parsed.selftext || '',
            upvoteRatio: parsed.upvoteRatio || 0.5,
          };
        }),
        twitter: twitterSources.map(s => {
          const content = s.content || '';
          let parsed: any = {};
          try {
            parsed = JSON.parse(content);
          } catch {
            parsed = { content };
          }
          return {
            title: parsed.title || '',
            url: s.url || '',
            content: parsed.content || parsed.text || content || '',
            author: parsed.author || '',
          };
        }),
        agentReach: agentReachSources.map(s => ({
          title: s.title || '',
          url: s.url || '',
          snippet: s.content || '',
          provider: s.provider || 'AGENT_REACH',
        })),
        searxng: filteredSearxngSources.map(s => ({
          title: s.title || '',
          url: s.url || '',
          snippet: s.content || '',
          engine: s.provider || 'SEARXNG',
        })),
      },
      sourceErrors,
      synthesis,
      debate,
      risk,
      decision,
      paperBet,
      agentOutputs,
      auditLog: auditLog.map(log => ({
        action: log.action,
        timestamp: log.createdAt.toISOString(),
        actor: log.actor || 'system',
        details: log.details || '',
      })),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching market detail:', error);
    return NextResponse.json(
      { error: 'Failed to fetch market detail', details: String(error) },
      { status: 500 }
    );
  }
}

function parseJudgeDecision(output: string): string {
  try {
    const parsed = JSON.parse(output);
    return parsed.decision || parsed.verdict || parsed.action || 'UNKNOWN';
  } catch {
    // Try to extract from text
    const match = output.match(/(?:decision|verdict|action|outcome)[:\s]*([A-Z]+)/i);
    return match?.[1]?.toUpperCase() || 'UNKNOWN';
  }
}
