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
};

function safeJsonParse<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
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

    // Group sources by provider (handle both provider field and sourceType field)
    const sources = (latestResearch?.sources || []) as LegacySource[];
    
    // If provider is null, infer from sourceType or URL
    const sourcesWithProvider = sources.map((s) => {
      if (s.provider) return s;
      
      // Infer provider from sourceType or URL patterns
      let inferredProvider = s.provider;
      const url = s.url || '';
      const type = s.sourceType || '';
      
      if (type === 'REDDIT' || url.includes('reddit.com')) {
        inferredProvider = 'REDDIT';
      } else if (type === 'TWITTER' || type === 'X' || url.includes('twitter.com') || url.includes('x.com')) {
        inferredProvider = 'TWITTER';
      } else if (url.includes('deerflow') || type === 'CRAWL') {
        inferredProvider = 'DEERFLOW';
      } else if (url.includes('agent-reach') || url.includes('agentreach')) {
        inferredProvider = 'AGENT_REACH';
      } else if (type === 'SEARCH' || type === 'WEB') {
        inferredProvider = 'SEARXNG';
      }
      
      return { ...s, provider: inferredProvider };
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
      s.provider === 'SEARXNG' || s.sourceType === 'SEARXNG' || s.provider === 'WEB' || s.sourceType === 'SEARCH'
    );

    if (latestResearch?.agentOutputs?.length) {
      for (const output of latestResearch.agentOutputs) {
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

    deerflowSources = dedupeByUrl(deerflowSources);
    redditSources = dedupeByUrl(redditSources);
    twitterSources = dedupeByUrl(twitterSources);
    agentReachSources = dedupeByUrl(agentReachSources);

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
    if (includePaperBet && latestOutcome) {
      paperBet = {
        id: latestOutcome.id,
        stake: latestOutcome.stake || 0,
        entryPrice: latestOutcome.entryPrice || 0,
        predictedSide: latestOutcome.predictedSide as 'YES' | 'NO',
        actualOutcome: latestOutcome.actualOutcome as 'YES' | 'NO' | 'CANCELLED' | null,
        resolvedProb: latestOutcome.resolvedProb || null,
        pnl: latestOutcome.pnl || null,
        brierScore: latestOutcome.brierScore || null,
        directionCorrect: latestOutcome.directionCorrect || null,
        resolvedAt: latestOutcome.resolvedAt?.toISOString() || null,
      };
    }

    // Pipeline stages from transparency stages in research
    const pipeline = {
      stages: ((latestResearch?.transparencyStages as any[]) || []).map((stage: any) => ({
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
      })) || [],
    };

    // Agent outputs
    const agentOutputs = (latestResearch?.agentOutputs || []).map((a) => ({
      role: a.role,
      stage: a.role,
      serviceName: 'TradingAgents',
      provider: a.provider || '',
      modelUsed: a.modelUsed || '',
      output: a.output || '',
      rawOutput: a.rawOutput || '',
      summary: a.summary || null,
      referencesJson: a.referencesJson || null,
      failureReason: a.failureReason || null,
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
        searxng: searxngSources.map(s => ({
          title: s.title || '',
          url: s.url || '',
          snippet: s.content || '',
          engine: s.provider || 'SEARXNG',
        })),
      },
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
