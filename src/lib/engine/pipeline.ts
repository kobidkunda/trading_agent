import { db } from '@/lib/db';
import { computeRisk, computePositionSize } from '@/lib/engine/risk';
import { runTriageAgent } from '@/lib/engine/agents/triage';
import { runDebateArena } from '@/lib/engine/debate-arena';
import { searchSearXNG } from '@/lib/engine/research/search';
import { extractContent } from '@/lib/engine/research/extract';
import { runDeerFlowResearch } from '@/lib/engine/research/deerflow';
import { runTradingAgentsSimple } from '@/lib/engine/research/tradingagents-api';
import { runFullResearch } from '@/lib/engine/research/full-research';
import { synthesizeFindings, formatAgentReachAsSource, formatDeerFlowAsSource, formatSearchAsSource, formatTradingAgentsAsSource, formatRedditAsSource, formatXAsSource } from '@/lib/engine/research/synthesis';
import { writeResearchToQdrant, retrieveSimilarMarkets } from '@/lib/engine/memory/qdrant';
import { isTestMode, getTradingMode, getModeState } from '@/lib/engine/mode';
import { getStageRouting, getResearchDepth, getModelForStage } from '@/lib/engine/service-routing';
import { createPaperBet } from '@/lib/engine/paper-bets';
import { buildPaperOrderRecord, buildPaperPositionRecord, resolvePaperExecutionSize } from '@/lib/engine/paper-execution';
import { createOrderCompat } from '@/lib/engine/prisma-runtime-compat';
import { canRunStage, isServiceReachable } from '@/lib/engine/health-check';
import { resolveResearchProvider } from '@/lib/engine/service-routing';
import { runFirecrawlResearch } from '@/lib/engine/research/firecrawl-research';
import { runPostDebatePrediction } from '@/lib/engine/post-debate-prediction';
import { computeExposureTotals } from '@/lib/engine/risk-exposure';
import { buildWatchlistPayload, shouldCreateExecutionJob, shouldCreateWatchlistEntry } from '@/lib/engine/pipeline-decision-helpers';
import { getPolymarketMarkets } from '@/lib/venues/polymarket';
import { getKalshiMarkets } from '@/lib/venues/kalshi';
import type { LivePipelineStage, ResearchDepth, TransparencySourceRef } from '@/lib/types';

export interface PipelineStageEvent {
  stage: LivePipelineStage;
  type?: 'started' | 'completed' | 'failed' | 'progress' | 'skipped';
  message: string;
  provider?: 'deerflow' | 'tradingagents' | 'agent_reach' | 'system' | 'firecrawl';
  serviceName?: string;
  model?: string | null;
  failureReason?: string | null;
  summary?: string | null;
  references?: TransparencySourceRef[];
}

export interface PipelineRunOptions {
  onStage?: (event: PipelineStageEvent) => void | Promise<void>;
}

export interface PipelineResult {
  [key: string]: unknown;
  marketId: string;
  triageStatus: string;
  debateResult: import('@/lib/engine/debate-arena').DebateArenaResult | null;
  postDebatePrediction: import('@/lib/engine/post-debate-prediction').PostDebatePredictionResult | null;
  riskAction: 'BID' | 'SKIP' | 'WATCH' | null;
  orderId: string | null;
  error: string | null;
  stages: string[];
}

function dedupeSourcesByUrl<T extends { url: string }>(sources: T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const source of sources) {
    const normalizedUrl = source.url.trim();
    if (!normalizedUrl || seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    unique.push({ ...source, url: normalizedUrl });
  }

  return unique;
}

async function createResearchSourceSafe(data: Record<string, unknown>): Promise<void> {
  try {
    await (db.researchSource.create as any)({ data });
  } catch (error) {
    console.warn('[Pipeline] Failed to persist research source:', error);
  }
}

async function saveSearchSources(
  researchRunId: string,
  results: Array<{ url: string; title: string; snippet: string; sourceType?: string; recencyScore?: number; qualityScore?: number }>,
): Promise<void> {
  const uniqueResults = dedupeSourcesByUrl(results);
  await Promise.all(
    uniqueResults.map((result) =>
      createResearchSourceSafe({
        researchRunId,
        url: result.url,
        title: result.title,
        content: result.snippet,
        sourceType: result.sourceType || 'SEARCH',
        recencyScore: result.recencyScore ?? 0.7,
        qualityScore: result.qualityScore ?? 0.6,
      }),
    ),
  );
}

async function saveDeerFlowSources(
  researchRunId: string,
  result: Awaited<ReturnType<typeof runDeerFlowResearch>>,
): Promise<void> {
  await saveSearchSources(
    researchRunId,
    result.allSearchResults.map((source) => ({
      ...source,
      sourceType: 'SEARCH',
      recencyScore: 0.7,
      qualityScore: 0.65,
    })),
  );

  await Promise.all(
    dedupeSourcesByUrl(result.allExtractedContent).map((source) =>
      createResearchSourceSafe({
        researchRunId,
        url: source.url,
        title: source.title,
        content: source.content,
        sourceType: 'CRAWL',
        recencyScore: 0.8,
        qualityScore: 0.75,
      }),
    ),
  );
}

async function saveRedditSources(researchRunId: string, redditReport: Record<string, unknown>): Promise<number> {
  const posts = Array.isArray(redditReport.posts) ? (redditReport.posts as Array<Record<string, unknown>>) : [];
  const uniquePosts = dedupeSourcesByUrl(
    posts.map((post) => ({
      url: String(post.url || `https://reddit.com/r/${post.subreddit || 'unknown'}`),
      title: String(post.title || 'Reddit Post'),
      payload: post,
    })),
  );

  await Promise.all(
    uniquePosts.map(({ url, title, payload }) =>
      createResearchSourceSafe({
        researchRunId,
        url,
        title,
        content: JSON.stringify({
          title: payload.title || title,
          subreddit: payload.subreddit || '',
          score: payload.score || 0,
          numComments: payload.num_comments || payload.numComments || 0,
          selftext: payload.selftext || '',
          upvoteRatio: payload.upvote_ratio || payload.upvoteRatio || 0.5,
          createdUtc: payload.created_utc || payload.createdUtc || null,
        }),
        sourceType: 'REDDIT',
        recencyScore: Number(payload.upvote_ratio || payload.upvoteRatio || 0.5),
        qualityScore: Math.min(Number(payload.score || 0) / 1000, 1),
      }),
    ),
  );

  return uniquePosts.length;
}

async function saveXSources(researchRunId: string, xReport: Record<string, unknown>): Promise<number> {
  const tweets = Array.isArray(xReport.tweets) ? (xReport.tweets as Array<Record<string, unknown>>) : [];
  const uniqueTweets = dedupeSourcesByUrl(
    tweets.map((tweet) => ({
      url: String(tweet.url || 'https://x.com'),
      title: String(tweet.title || 'X/Twitter Post'),
      payload: tweet,
    })),
  );

  await Promise.all(
    uniqueTweets.map(({ url, title, payload }) =>
      createResearchSourceSafe({
        researchRunId,
        url,
        title,
        content: JSON.stringify({
          title: payload.title || title,
          content: payload.content || payload.snippet || '',
          author: payload.author || '',
          publishedDate: payload.publishedDate || payload.createdAt || null,
        }),
        sourceType: 'X',
        recencyScore: 0.7,
        qualityScore: 0.6,
      }),
    ),
  );

  return uniqueTweets.length;
}

async function saveAgentReachSources(
  researchRunId: string,
  agentReachResult: NonNullable<Awaited<ReturnType<typeof runFullResearch>>['agentReach']>,
): Promise<number> {
  const uniqueSources = dedupeSourcesByUrl(agentReachResult.sources);
  await Promise.all(
    uniqueSources.map((source) =>
      createResearchSourceSafe({
        researchRunId,
        url: source.url,
        title: source.title,
        content: source.snippet,
        sourceType: 'AGENT_REACH',
        recencyScore: 0.75,
        qualityScore: 0.7,
      }),
    ),
  );
  return uniqueSources.length;
}

export async function runPipelineForMarket(
  marketId: string,
  options: PipelineRunOptions = {},
): Promise<PipelineResult> {
  const emitStage = async (event: PipelineStageEvent): Promise<void> => {
    await options.onStage?.(event);
  };

    const result: PipelineResult = {
    marketId,
    triageStatus: 'PENDING',
    debateResult: null,
    postDebatePrediction: null,
    riskAction: null,
    orderId: null,
    error: null,
    stages: [],
  };

  try {
    const market = await db.market.findUnique({
      where: { id: marketId },
      include: { snapshots: { orderBy: { timestamp: 'desc' }, take: 1 } },
    });
    if (!market) {
      result.error = `Market ${marketId} not found`;
      return result;
    }

    const snapshot = market.snapshots[0];
    let impliedProb = snapshot?.impliedProb ?? 0.5;
    let liquidity = snapshot?.liquidity ?? 0;

    if (market.venue === 'POLYMARKET') {
      try {
        const polymarketResult = await getPolymarketMarkets(100);
        const fresh = polymarketResult.markets.find((m: { externalId: string }) => m.externalId === market.externalId);
        if (fresh) {
          impliedProb = fresh.impliedProb;
          liquidity = fresh.liquidity;
          await db.marketSnapshot.create({
            data: { marketId, impliedProb, liquidity, spread: fresh.spread, volume24h: fresh.volume24h || 0, bestBid: fresh.bestBid ?? impliedProb - 0.01, bestAsk: fresh.bestAsk ?? impliedProb + 0.01 },
          });
        }
      } catch (e) { console.warn('[Pipeline] Fresh Polymarket fetch failed, using cached snapshot:', e); }
    } else if (market.venue === 'KALSHI') {
      try {
        const kalshiResult = await getKalshiMarkets();
        const freshList = kalshiResult.markets;
        const fresh = freshList.find((m: { ticker: string }) => m.ticker === market.externalId);
        if (fresh) {
          impliedProb = fresh.last_price / 100;
          liquidity = fresh.volume;
          await db.marketSnapshot.create({
            data: { marketId, impliedProb, liquidity, spread: Math.max(0.01, (fresh.yes_ask - fresh.yes_bid) / 100), volume24h: fresh.volume, bestBid: fresh.yes_bid / 100, bestAsk: fresh.yes_ask / 100 },
          });
        }
      } catch (e) { console.warn('[Pipeline] Fresh Kalshi fetch failed, using cached snapshot:', e); }
    }

    // Load routing config early for all stages
    const routing = await getStageRouting();

    result.stages.push('TRIAGE');
    const triageModel = getModelForStage('triage', routing);
    await emitStage({
      stage: 'TRIAGE',
      message: 'Running triage',
      provider: 'system',
      serviceName: 'triage-agent',
      model: triageModel,
    });
    const triageResult = await runTriageAgent(
      marketId, market.title, market.description || '', market.category, impliedProb, liquidity
    );
    result.triageStatus = triageResult.status;

    const candidate = await db.tradeCandidate.findFirst({ where: { marketId } });
    if (candidate) {
      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: {
          stage: 'TRIAGED',
          triageStatus: triageResult.status,
          triageReason: triageResult.reason,
          researchQueued: triageResult.worthResearch,
        },
      });
    }

    if (!triageResult.worthResearch) {
      result.stages.push('SKIPPED_TRIAGE');
      return result;
    }

    result.stages.push('RESEARCH');
    const depth: ResearchDepth = getResearchDepth(routing);

    const researchRun = await db.researchRun.create({
      data: {
        marketId,
        candidateId: candidate?.id || null,
        status: 'RUNNING',
        depth,
        startedAt: new Date(),
      },
    });

    let researchContext = '';

    if (depth === 'DEERFLOW') {
      result.stages.push('DEERFLOW');
      const deerflowHealth = await canRunStage('DEERFLOW');

      if (!deerflowHealth.canRun) {
        const fallbackUrl = process.env.DEERFLOW_URL || 'http://192.168.88.97:2026';
        const reachable = await isServiceReachable('deerflow', fallbackUrl);

        if (!reachable) {
          console.warn(`[Pipeline] DeerFlow skipped: ${deerflowHealth.skipReason}`);
          result.stages.push('DEERFLOW_SKIPPED');
          await emitStage({
            stage: 'DEERFLOW',
            type: 'failed',
            message: `Health check failed: ${deerflowHealth.skipReason}`,
            provider: 'deerflow',
            serviceName: 'deerflow',
            failureReason: deerflowHealth.skipReason,
          });

          const researchProvider = await resolveResearchProvider();
          if (researchProvider === 'firecrawl') {
            result.stages.push('FIRECRAWL');
            await emitStage({
              stage: 'FIRECRAWL',
              message: 'Falling back to Firecrawl for deep research',
              provider: 'firecrawl',
              serviceName: 'firecrawl',
            });

            try {
              const firecrawlResult = await runFirecrawlResearch(market.title, researchContext, impliedProb);
              researchContext = [
                firecrawlResult.summary,
                ...firecrawlResult.keyFindings.map((f) => `Finding: ${f}`),
                ...firecrawlResult.contradictions.map((c) => `Contradiction: ${c}`),
              ].join('\n');

              await saveSearchSources(
                researchRun.id,
                firecrawlResult.allSearchResults.map((source) => ({
                  ...source,
                  sourceType: 'SEARCH',
                  recencyScore: 0.7,
                  qualityScore: 0.6,
                })),
              );
              await Promise.all(
                firecrawlResult.allExtractedContent.map((source) =>
                  createResearchSourceSafe({
                    researchRunId: researchRun.id,
                    url: source.url,
                    title: source.title,
                    content: source.content,
                    sourceType: 'CRAWL',
                    recencyScore: 0.8,
                    qualityScore: 0.7,
                  }),
                ),
              );
            } catch (e) {
              console.error('[Pipeline] Firecrawl fallback failed:', e);
              researchContext = 'Research unavailable: DeerFlow and Firecrawl both unavailable';
            }
          } else {
            researchContext = 'Research unavailable: DeerFlow service is down';
          }

          return result;
        }

        console.warn('[Pipeline] DeerFlow health check failed but service is reachable, proceeding anyway');
      }

      await emitStage({
        stage: 'DEERFLOW',
        message: 'Running DeerFlow research',
        provider: 'deerflow',
        serviceName: 'deerflow',
        model: routing.deerflowModel || routing.deerflowApiModel || 'default',
      });
      const deerFlowResult = await runDeerFlowResearch(
        market.title,
        market.description || '',
        impliedProb,
        routing,
      );

      researchContext = [
        deerFlowResult.summary,
        ...deerFlowResult.keyFindings.map((f) => `Finding: ${f}`),
        ...deerFlowResult.contradictions.map((c) => `Contradiction: ${c}`),
      ].join('\n');

      await saveDeerFlowSources(researchRun.id, deerFlowResult);

      await db.agentOutput.create({
        data: {
          researchRunId: researchRun.id,
          role: 'DEERFLOW',
          stage: 'DEERFLOW',
          serviceName: 'deerflow',
          provider: 'deerflow',
          modelUsed: routing.deerflowModel || 'default',
          output: JSON.stringify(deerFlowResult),
          rawOutput: JSON.stringify(deerFlowResult),
          summary: deerFlowResult.summary.slice(0, 4000),
        },
      });
    } else if (depth === 'FULL') {
      const synthesisModel = routing.deerflowModel || routing.analystDeepThinkLlm || 'paper_proglm';
      const analystSections: string[] = [];
      let deerflowSource: ReturnType<typeof formatDeerFlowAsSource> | null = null;
      let agentReachSource: ReturnType<typeof formatAgentReachAsSource> | null = null;
      let newsSource: ReturnType<typeof formatTradingAgentsAsSource> | null = null;
      let sentimentSource: ReturnType<typeof formatTradingAgentsAsSource> | null = null;
      let technicalSource: ReturnType<typeof formatTradingAgentsAsSource> | null = null;
      let searchSource: ReturnType<typeof formatSearchAsSource> | null = null;
      let redditSource: ReturnType<typeof formatRedditAsSource> | null = null;
      let xSource: ReturnType<typeof formatXAsSource> | null = null;

      result.stages.push('WEB_SEARCH');
      await emitStage({
        stage: 'WEB_SEARCH',
        type: 'started',
        message: 'Running SearXNG source fanout',
        provider: 'system',
        serviceName: 'searxng',
        model: null,
      });

      const baseSearchResults = await searchSearXNG(market.title, routing.searchMaxResults ?? 100).catch((e) => {
        console.error('[Pipeline] SearXNG failed:', e);
        return [];
      });
      const additionalQueries = [
        `${market.title} analysis`,
        `${market.title} prediction`,
        `${market.title} market outlook`,
        `${market.title} latest news`,
        `${market.title} research`,
        `${market.title} analysis report`,
      ];
      const additionalSearches = await Promise.allSettled(
        additionalQueries.map((query) =>
          searchSearXNG(query, 50).catch((e) => {
            console.error('[Pipeline] Additional SearXNG search failed:', e);
            return [];
          }),
        ),
      );

      const webSearchResults = dedupeSourcesByUrl([
        ...baseSearchResults,
        ...additionalSearches.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
      ]).slice(0, 300);

      if (webSearchResults.length > 0) {
        await saveSearchSources(researchRun.id, webSearchResults);
        searchSource = formatSearchAsSource(webSearchResults);
        analystSections.push(`[WEB SEARCH]\n${searchSource.raw}`);
      } else {
        analystSections.push('[WEB SEARCH]\nFAILED: No search results returned');
      }

      const fullResearchResult = await runFullResearch({
        marketId,
        marketTitle: market.title,
        marketDescription: market.description || '',
        impliedProbability: impliedProb,
        routing,
        agentReachTargetSourceCount: 300,
      });

      if (fullResearchResult.deerflow) {
        deerflowSource = formatDeerFlowAsSource(fullResearchResult.deerflow);
        analystSections.push(`[DEERFLOW]\n${deerflowSource.raw}`);
        await saveDeerFlowSources(researchRun.id, fullResearchResult.deerflow);
        await db.agentOutput.create({
          data: {
            researchRunId: researchRun.id,
            role: 'DEERFLOW',
            stage: 'DEERFLOW',
            serviceName: 'deerflow',
            provider: 'deerflow',
            modelUsed: routing.deerflowModel || routing.deerflowApiModel || 'default',
            output: JSON.stringify(fullResearchResult.deerflow),
            rawOutput: JSON.stringify(fullResearchResult.deerflow),
            summary: fullResearchResult.deerflow.summary.slice(0, 4000),
          },
        });
      }

      if (fullResearchResult.agentReach) {
        agentReachSource = formatAgentReachAsSource(fullResearchResult.agentReach);
        analystSections.push(`[AGENT REACH]\n${agentReachSource.raw}`);
        const savedCount = await saveAgentReachSources(researchRun.id, fullResearchResult.agentReach);
        await db.agentOutput.create({
          data: {
            researchRunId: researchRun.id,
            role: 'AGENT_REACH',
            stage: 'AGENT_REACH',
            serviceName: 'agent-reach',
            provider: 'agent_reach',
            modelUsed: routing.agentReachToolName || 'research',
            output: JSON.stringify(fullResearchResult.agentReach),
            rawOutput: JSON.stringify(fullResearchResult.agentReach),
            summary: `${fullResearchResult.agentReach.summary.slice(0, 3500)}\n\nPersisted sources: ${savedCount}`,
            referencesJson: JSON.stringify(fullResearchResult.agentReach.sources.slice(0, 100)),
          },
        });
      }

      const taResult = fullResearchResult.tradingagents;
      if (taResult) {
        if (taResult.newsReport) {
          newsSource = formatTradingAgentsAsSource({ newsReport: taResult.newsReport }, 'NEWS');
          analystSections.push(`[NEWS ANALYST]\n${newsSource.raw}`);
          await db.agentOutput.create({
            data: {
              researchRunId: researchRun.id,
              role: 'NEWS_ANALYST',
              stage: 'TRADINGAGENTS',
              serviceName: 'tradingagents',
              provider: 'tradingagents',
              modelUsed: routing.newsAnalystModel || 'tradingagents',
              output: JSON.stringify(taResult.newsReport),
              rawOutput: JSON.stringify(taResult.newsReport),
              summary: typeof taResult.newsReport.summary === 'string' ? taResult.newsReport.summary.slice(0, 4000) : null,
            },
          });
        }

        if (taResult.sentimentReport) {
          sentimentSource = formatTradingAgentsAsSource({ sentimentReport: taResult.sentimentReport }, 'SENTIMENT');
          analystSections.push(`[SENTIMENT ANALYST]\n${sentimentSource.raw}`);
          await db.agentOutput.create({
            data: {
              researchRunId: researchRun.id,
              role: 'SENTIMENT_ANALYST',
              stage: 'TRADINGAGENTS',
              serviceName: 'tradingagents',
              provider: 'tradingagents',
              modelUsed: routing.sentimentAnalystModel || 'tradingagents',
              output: JSON.stringify(taResult.sentimentReport),
              rawOutput: JSON.stringify(taResult.sentimentReport),
              summary: typeof taResult.sentimentReport.summary === 'string' ? taResult.sentimentReport.summary.slice(0, 4000) : null,
            },
          });
        }

        if (taResult.technicalReport) {
          technicalSource = formatTradingAgentsAsSource({ technicalReport: taResult.technicalReport }, 'TECHNICAL');
          analystSections.push(`[TECHNICAL ANALYST]\n${technicalSource.raw}`);
          await db.agentOutput.create({
            data: {
              researchRunId: researchRun.id,
              role: 'TECHNICAL_ANALYST',
              stage: 'TRADINGAGENTS',
              serviceName: 'tradingagents',
              provider: 'tradingagents',
              modelUsed: routing.technicalAnalystModel || 'tradingagents',
              output: JSON.stringify(taResult.technicalReport),
              rawOutput: JSON.stringify(taResult.technicalReport),
              summary: typeof taResult.technicalReport.summary === 'string' ? taResult.technicalReport.summary.slice(0, 4000) : null,
            },
          });
        }

        if (taResult.redditReport) {
          redditSource = formatRedditAsSource(taResult.redditReport);
          if (redditSource) {
            analystSections.push(`[REDDIT]\n${redditSource.raw}`);
          }
          const savedCount = await saveRedditSources(researchRun.id, taResult.redditReport);
          await db.agentOutput.create({
            data: {
              researchRunId: researchRun.id,
              role: 'REDDIT_ANALYST',
              stage: 'TRADINGAGENTS',
              serviceName: 'tradingagents',
              provider: 'tradingagents',
              modelUsed: 'tradingagents',
              output: JSON.stringify(taResult.redditReport),
              rawOutput: JSON.stringify(taResult.redditReport),
              summary: `Persisted Reddit posts: ${savedCount}`,
            },
          });
        }

        if (taResult.xReport) {
          xSource = formatXAsSource(taResult.xReport);
          if (xSource) {
            analystSections.push(`[X/TWITTER]\n${xSource.raw}`);
          }
          const savedCount = await saveXSources(researchRun.id, taResult.xReport);
          await db.agentOutput.create({
            data: {
              researchRunId: researchRun.id,
              role: 'X_ANALYST',
              stage: 'TRADINGAGENTS',
              serviceName: 'tradingagents',
              provider: 'tradingagents',
              modelUsed: 'tradingagents',
              output: JSON.stringify(taResult.xReport),
              rawOutput: JSON.stringify(taResult.xReport),
              summary: `Persisted X/Twitter posts: ${savedCount}`,
            },
          });
        }
      }

      researchContext = analystSections.join('\n\n');

      await emitStage({
        stage: 'SYNTHESIS',
        message: 'Synthesizing research findings',
        provider: 'system',
        serviceName: 'synthesis',
        model: synthesisModel,
      });
      try {
        const synthesisResult = await synthesizeFindings(
          market.title,
          impliedProb,
          newsSource,
          sentimentSource,
          technicalSource,
          deerflowSource,
          agentReachSource,
          searchSource,
          redditSource,
          xSource,
          synthesisModel,
        );
        analystSections.push(`\n[SYNTHESIS]\n${JSON.stringify(synthesisResult, null, 2)}`);
        researchContext += '\n\n--- SYNTHESIS: MERGE & COMPARE ---\n' + [
          `Summary: ${synthesisResult.summary}`,
          `Consensus Prob: ${(synthesisResult.consensusProbability * 100).toFixed(1)}%`,
          `Agreements: ${synthesisResult.agreements.join('; ') || 'none'}`,
          `Disagreements: ${synthesisResult.disagreements.join('; ') || 'none'}`,
          `Final: ${synthesisResult.finalAssessment}`,
          `Confidence: ${(synthesisResult.confidence * 100).toFixed(0)}%`,
          'Source Comparison:',
          ...synthesisResult.sourceComparison.map((s) => `  ${s.source}: ${s.sentiment} (${(s.confidence * 100).toFixed(0)}%)`),
        ].join('\n');
        await db.agentOutput.create({
          data: {
            researchRunId: researchRun.id,
            role: 'SYNTHESIS',
            stage: 'SYNTHESIS',
            serviceName: 'synthesis',
            provider: 'system',
            modelUsed: synthesisModel || 'default',
            output: JSON.stringify(synthesisResult),
            rawOutput: JSON.stringify(synthesisResult),
            summary: synthesisResult.summary?.slice(0, 4000) ?? null,
            referencesJson: JSON.stringify(synthesisResult.sourceComparison?.slice(0, 50) ?? []),
          },
        });
      } catch (e) {
        const errMsg = String(e);
        analystSections.push(`[SYNTHESIS]\nFAILED: ${errMsg}`);
        researchContext += `\n\n[SYNTHESIS] FAILED: ${errMsg}`;
        console.error('[Pipeline] Synthesis failed:', e);
        await emitStage({
          stage: 'SYNTHESIS',
          type: 'failed',
          message: `Synthesis failed: ${errMsg}`,
          provider: 'system',
          serviceName: 'synthesis',
          model: synthesisModel,
          failureReason: errMsg,
        });
        await db.agentOutput.create({
          data: {
            researchRunId: researchRun.id,
            role: 'SYNTHESIS',
            stage: 'SYNTHESIS',
            serviceName: 'synthesis',
            provider: 'system',
            modelUsed: synthesisModel || 'default',
            output: JSON.stringify({ error: errMsg }),
            failureReason: errMsg,
          },
        });
      }
} else {
       const searchResults = await searchSearXNG(market.title, routing.searchMaxResults ?? 50).catch((e) => {
         console.error('[Pipeline] SearXNG failed:', e);
         return [];
       });
       const maxResults = routing.searchMaxResults ?? 50;
       researchContext = searchResults.map((r: { title: string; snippet: string }) => `${r.title}: ${r.snippet}`).join('\n');

       // Additional parallel searches for more reach
       const extraSearches = await Promise.allSettled([
         searchSearXNG(`${market.title} analysis`, maxResults).catch(() => []),
         searchSearXNG(`${market.title} latest news`, maxResults).catch(() => []),
       ]);
       for (const sr of extraSearches) {
         if (sr.status === 'fulfilled') {
           researchContext += '\n' + sr.value.map((r: any) => `${r.title}: ${r.snippet}`).join('\n');
         }
       }

      for (const sr of searchResults) {
        const extracted = await extractContent(sr.url);
        await (db.researchSource.create as any)({
          data: {
            researchRunId: researchRun.id,
            url: sr.url,
            title: sr.title,
            content: extracted?.content || sr.snippet,
            sourceType: sr.sourceType,
            recencyScore: sr.recencyScore,
            qualityScore: sr.qualityScore,
          },
        });
      }

// ── TradingAgents for QUICK/DEEP depths (not FULL/DEERFLOW which handle it above) ──
       result.stages.push('ANALYSTS');
       await emitStage({
         stage: 'TRADINGAGENTS',
         message: 'Running TradingAgents analysts',
         provider: 'tradingagents',
         serviceName: 'tradingagents',
         model: routing.newsAnalystModel || 'tradingagents',
       });
       try {
         const taDate = new Date().toISOString().split('T')[0];
         const taResult = await runTradingAgentsSimple(
           market.title, taDate,
           routing.analystDeepThinkLlm || 'paper_proglm',
           routing.analystQuickThinkLlm || 'paper_lite',
         ).catch((e) => {
           console.error('[Pipeline] TradingAgents simple call failed:', e);
           return null;
         });

        const analystSections: string[] = [];

        if (taResult && taResult.status === 'completed') {
          if (taResult.newsReport) {
            analystSections.push(`[NEWS ANALYST]\n${JSON.stringify(taResult.newsReport, null, 2)}`);
            await db.agentOutput.create({
              data: {
                researchRunId: researchRun.id,
                role: 'NEWS_ANALYST',
                stage: 'TRADINGAGENTS',
                serviceName: 'tradingagents',
                provider: 'tradingagents',
                modelUsed: routing.newsAnalystModel || 'tradingagents',
                output: JSON.stringify(taResult.newsReport),
                rawOutput: JSON.stringify(taResult.newsReport),
                summary: typeof taResult.newsReport.summary === 'string' ? taResult.newsReport.summary.slice(0, 4000) : null,
              },
            });
          }
          if (taResult.sentimentReport) {
            analystSections.push(`[SENTIMENT ANALYST]\n${JSON.stringify(taResult.sentimentReport, null, 2)}`);
            await db.agentOutput.create({
              data: {
                researchRunId: researchRun.id,
                role: 'SENTIMENT_ANALYST',
                stage: 'TRADINGAGENTS',
                serviceName: 'tradingagents',
                provider: 'tradingagents',
                modelUsed: routing.sentimentAnalystModel || 'tradingagents',
                output: JSON.stringify(taResult.sentimentReport),
                rawOutput: JSON.stringify(taResult.sentimentReport),
                summary: typeof taResult.sentimentReport.summary === 'string' ? taResult.sentimentReport.summary.slice(0, 4000) : null,
              },
            });
          }
          if (taResult.technicalReport) {
            analystSections.push(`[TECHNICAL ANALYST]\n${JSON.stringify(taResult.technicalReport, null, 2)}`);
            await db.agentOutput.create({
              data: {
                researchRunId: researchRun.id,
                role: 'TECHNICAL_ANALYST',
                stage: 'TRADINGAGENTS',
                serviceName: 'tradingagents',
                provider: 'tradingagents',
                modelUsed: routing.technicalAnalystModel || 'tradingagents',
                output: JSON.stringify(taResult.technicalReport),
                rawOutput: JSON.stringify(taResult.technicalReport),
                summary: typeof taResult.technicalReport.summary === 'string' ? taResult.technicalReport.summary.slice(0, 4000) : null,
              },
            });
          }
          if (taResult.fundamentalsReport) {
            analystSections.push(`[FUNDAMENTALS]\n${JSON.stringify(taResult.fundamentalsReport, null, 2)}`);
          }
          if (taResult.redditReport) {
            const redditSrc = formatRedditAsSource(taResult.redditReport);
            if (redditSrc) {
              analystSections.push(`[REDDIT]\n${redditSrc.raw}`);
              
              // Save individual Reddit posts as research sources
              const redditPosts = taResult.redditReport.posts as Array<Record<string, unknown>> | undefined;
              if (redditPosts && Array.isArray(redditPosts)) {
                console.log(`[Pipeline] Saving ${redditPosts.length} Reddit posts as research sources (simple mode)`);
                for (const post of redditPosts.slice(0, 100)) {
                  await (db.researchSource.create as any)({
                    data: {
                      researchRunId: researchRun.id,
                      url: (post.url as string) || `https://reddit.com/r/${post.subreddit || 'unknown'}`,
                      title: (post.title as string) || 'Reddit Post',
                      content: `${post.selftext || ''}\n\nSubreddit: r/${post.subreddit || 'unknown'} | Score: ${post.score || 0} | Comments: ${post.num_comments || 0}`,
                      sourceType: 'REDDIT',
                      recencyScore: post.upvote_ratio as number || 0.5,
                      qualityScore: Math.min((post.score as number || 0) / 1000, 1.0),
                    },
                  });
                }
              }
              
              await db.agentOutput.create({
                data: {
                  researchRunId: researchRun.id,
                  role: 'REDDIT_ANALYST',
                  stage: 'TRADINGAGENTS',
                  serviceName: 'tradingagents',
                  provider: 'tradingagents',
                  modelUsed: 'tradingagents',
                  output: JSON.stringify(taResult.redditReport),
                  rawOutput: JSON.stringify(taResult.redditReport),
                  summary: null,
                },
              });
            }
          }
          if (taResult.xReport) {
            const xSrc = formatXAsSource(taResult.xReport);
            if (xSrc) {
              analystSections.push(`[X/TWITTER]\n${xSrc.raw}`);
              
              // Save individual X/Twitter tweets as research sources
              const xTweets = taResult.xReport.tweets as Array<Record<string, unknown>> | undefined;
              if (xTweets && Array.isArray(xTweets)) {
                console.log(`[Pipeline] Saving ${xTweets.length} X/Twitter tweets as research sources (simple mode)`);
                for (const tweet of xTweets.slice(0, 100)) {
                  await (db.researchSource.create as any)({
                    data: {
                      researchRunId: researchRun.id,
                      url: (tweet.url as string) || 'https://x.com',
                      title: (tweet.title as string) || 'X/Twitter Post',
                      content: tweet.content as string || tweet.snippet as string || '',
                      sourceType: 'X',
                      recencyScore: 0.7,
                      qualityScore: 0.6,
                    },
                  });
                }
              }
              
              await db.agentOutput.create({
                data: {
                  researchRunId: researchRun.id,
                  role: 'X_ANALYST',
                  stage: 'TRADINGAGENTS',
                  serviceName: 'tradingagents',
                  provider: 'tradingagents',
                  modelUsed: 'tradingagents',
                  output: JSON.stringify(taResult.xReport),
                  rawOutput: JSON.stringify(taResult.xReport),
                  summary: null,
                },
              });
            }
          }
        } else if (taResult) {
          analystSections.push(`[ANALYSTS]\nFAILED: ${taResult.error || 'Unknown error'}`);
          console.error('[Pipeline] TradingAgents simple failed:', taResult.error);
        } else {
          analystSections.push('[ANALYSTS]\nFAILED: No response from TradingAgents service');
        }

        if (analystSections.length > 0) {
          researchContext += '\n\n--- ANALYST REPORTS ---\n' + analystSections.join('\n\n');
        }
      } catch (e) {
        const errMsg = String(e);
        researchContext += `\n\n[ANALYSTS] FAILED: ${errMsg}`;
        console.error('[Pipeline] TradingAgents analyst team error:', e);
      }
    }

    if (candidate) {
      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: { stage: 'RESEARCHING' },
      });
    }

    await retrieveSimilarMarkets(market.title, market.description || '');

    // ── DEBATE ARENA: Multi-model debate on evidence ──
    result.stages.push('DEBATE');
    const judgeModel = getModelForStage('judge', routing);
    await emitStage({
      stage: 'JUDGE',
      message: 'Running judge debate arena',
      provider: 'system',
      serviceName: 'debate-arena',
      model: judgeModel,
    });
    const debateResult = await runDebateArena(market.title, impliedProb, researchContext, routing);
    result.debateResult = debateResult;

    for (const round of debateResult.rounds) {
      await db.agentOutput.create({
        data: {
          researchRunId: researchRun.id,
          role: `DEBATE_ROUND_${round.round}_BULL`,
          stage: 'JUDGE',
          serviceName: 'debate-arena',
          provider: 'system',
          modelUsed: round.bullModel,
          output: JSON.stringify({ argument: round.bullArgument, probability: round.bullProbability, confidence: round.bullConfidence }),
          rawOutput: round.bullArgument,
          summary: round.bullArgument.slice(0, 4000),
        },
      });
      await db.agentOutput.create({
        data: {
          researchRunId: researchRun.id,
          role: `DEBATE_ROUND_${round.round}_BEAR`,
          stage: 'JUDGE',
          serviceName: 'debate-arena',
          provider: 'system',
          modelUsed: round.bearModel,
          output: JSON.stringify({ argument: round.bearArgument, probability: round.bearProbability, confidence: round.bearConfidence }),
          rawOutput: round.bearArgument,
          summary: round.bearArgument.slice(0, 4000),
        },
      });
    }

    const debateArbiterModel = getModelForStage('judge', routing) || 'paper_proglm';
    await db.agentOutput.create({
      data: {
        researchRunId: researchRun.id,
        role: 'DEBATE_ARBITER',
        stage: 'JUDGE',
        serviceName: 'debate-arena',
        provider: 'system',
        modelUsed: debateArbiterModel,
        output: JSON.stringify({
          debateOutcome: debateResult.debateOutcome,
          finalProbability: debateResult.finalProbability,
          finalConfidence: debateResult.finalConfidence,
          finalUncertainty: debateResult.finalUncertainty,
          pointsOfAgreement: debateResult.pointsOfAgreement,
          pointsOfDisagreement: debateResult.pointsOfDisagreement,
          proEvidence: debateResult.proEvidence,
          antiEvidence: debateResult.antiEvidence,
          recommendation: debateResult.recommendation,
          recommendationReason: debateResult.recommendationReason,
        }),
        rawOutput: debateResult.recommendationReason,
        summary: debateResult.recommendationReason?.slice(0, 4000) ?? null,
        referencesJson: JSON.stringify(debateResult.proEvidence?.slice(0, 20) ?? []),
      },
    });

    // ── POST-DEBATE PREDICTION: Final synthesis via MiroFish ──
    result.stages.push('MIROFISH_PREDICT');
    const mirofishModel = routing.mirofishPredictionModel || 'free_ling';
    await emitStage({
      stage: 'MIROFISH_PREDICT',
      message: `Running post-debate prediction via MiroFish (${mirofishModel})`,
      provider: 'system',
      serviceName: 'mirofish-predict',
      model: mirofishModel,
    });

    let postDebatePrediction: import('@/lib/engine/post-debate-prediction').PostDebatePredictionResult | null = null;
    try {
      postDebatePrediction = await runPostDebatePrediction(debateResult, researchContext, mirofishModel);
      result.postDebatePrediction = postDebatePrediction;

      await db.agentOutput.create({
        data: {
          researchRunId: researchRun.id,
          role: 'MIROFISH_PREDICT',
          stage: 'MIROFISH_PREDICT',
          serviceName: 'mirofish-predict',
          provider: 'mirofish',
          modelUsed: postDebatePrediction.modelUsed,
          output: JSON.stringify(postDebatePrediction),
          rawOutput: postDebatePrediction.summary,
          summary: postDebatePrediction.summary?.slice(0, 4000) ?? null,
          referencesJson: JSON.stringify(postDebatePrediction.keyInsights?.slice(0, 20) ?? []),
        },
      });
    } catch (e) {
      console.error('[Pipeline] Post-debate prediction failed:', e);
      await emitStage({
        stage: 'MIROFISH_PREDICT',
        message: `Post-debate prediction failed: ${String(e)}`,
        provider: 'system',
        serviceName: 'mirofish-predict',
        failureReason: String(e),
      });
    }

    // Mark research run as completed only AFTER all debate outputs are created
    await db.researchRun.update({
      where: { id: researchRun.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    if (candidate) {
      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: { stage: 'JUDGED' },
      });
    }

    // ── RISK ENGINE: 3 outcomes (BID / WATCH / SKIP) ──
    result.stages.push('RISK');
    await emitStage({
      stage: 'RISK',
      message: 'Running deterministic risk engine',
      provider: 'system',
      serviceName: 'risk-engine',
      model: null,
    });
    const strategySetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
    let strategy: Record<string, unknown> = {};
    if (strategySetting?.value) {
      try {
        strategy = JSON.parse(strategySetting.value);
      } catch (parseError) {
        console.error('[pipeline] Failed to parse strategy_settings:', parseError);
        strategy = {};
      }
    }

    const strategyDailyLimit = typeof strategy.maxDailyExposure === 'number' ? strategy.maxDailyExposure : 50000;
    const strategyCategoryLimit = typeof strategy.maxCategoryExposure === 'number' ? strategy.maxCategoryExposure : 10000;
    const strategyPositionLimit = typeof strategy.maxExposurePerMarket === 'number' ? strategy.maxExposurePerMarket : 5000;
    const strategyMinLiquidity = typeof strategy.minLiquidity === 'number' ? strategy.minLiquidity : 1000;
    const strategyMaxSpread = typeof strategy.maxSpread === 'number' ? strategy.maxSpread : 0.05;

    const openPositions = await db.position.findMany({
      where: { status: 'OPEN' },
      include: { market: { select: { category: true } } },
    });

    const exposureTotals = computeExposureTotals(openPositions, market.category);
    const actualDailyExposure = exposureTotals.dailyExposure;
    const actualCategoryExposure = exposureTotals.categoryExposure;

    const dailyExposureBlocked = actualDailyExposure >= strategyDailyLimit;
    const categoryExposureBlocked = actualCategoryExposure >= strategyCategoryLimit;

    const riskInput = {
      impliedProbability: impliedProb,
      judgeProbability: debateResult.finalProbability,
      confidence: debateResult.finalConfidence,
      uncertainty: debateResult.finalUncertainty,
      fees: 0.02,
      slippage: 0.01,
      venue: market.venue as 'POLYMARKET' | 'KALSHI' | 'SX_BET' | 'MANIFOLD',
      category: market.category,
      dailyExposure: dailyExposureBlocked ? strategyDailyLimit : actualDailyExposure,
      categoryExposure: categoryExposureBlocked ? strategyCategoryLimit : actualCategoryExposure,
      openPositions: openPositions.length,
      maxPositionSize: strategyPositionLimit,
      maxDailyExposure: strategyDailyLimit,
      maxCategoryExposure: strategyCategoryLimit,
      minLiquidity: strategyMinLiquidity,
      maxSpread: strategyMaxSpread,
      remainingMarketCapacity: Math.max(0, strategyPositionLimit),
      remainingDailyCapacity: Math.max(0, strategyDailyLimit - actualDailyExposure),
      remainingCategoryCapacity: Math.max(0, strategyCategoryLimit - actualCategoryExposure),
      marketLiquidity: liquidity,
      marketSpread: snapshot?.spread ?? 0.05,
      catalystTiming: undefined,
    };

    const riskResult = computeRisk(riskInput);
    result.riskAction = riskResult.action;

    const decision = await db.decision.create({
      data: {
        marketId,
        candidateId: candidate?.id || null,
        action: riskResult.action,
        side: riskResult.side ?? null,
        reasonCode: riskResult.reasonCode ?? null,
        reason: riskResult.reason,
        judgeProbability: debateResult.finalProbability,
        impliedProb,
        edge: riskResult.edge,
        confidence: debateResult.finalConfidence,
        uncertainty: debateResult.finalUncertainty,
        maxSize: riskResult.maxSize,
        urgency: riskResult.urgency,
        fees: riskResult.fees,
        slippage: riskResult.slippage,
        dryRun: isTestMode(),
      },
    });

    if (candidate) {
      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: { stage: 'DECIDED' },
      });
    }

    if (shouldCreateWatchlistEntry(riskResult.action as 'BID' | 'WATCH' | 'SKIP')) {
      await db.watchlist.create({
        data: buildWatchlistPayload({
          marketId,
          decisionId: decision.id,
          reason: riskResult.reason,
          targetPrice: riskResult.side === 'YES' ? impliedProb : 1 - impliedProb,
        }),
      });

      if (candidate) {
        await db.tradeCandidate.update({
          where: { id: candidate.id },
          data: { stage: 'WATCHING' },
        });
      }
    }

    if (shouldCreateExecutionJob(riskResult.action as 'BID' | 'WATCH' | 'SKIP')) {
      result.stages.push('EXECUTE');
      const orderSize = resolvePaperExecutionSize({
        adjustedSize: riskResult.adjustedSize,
        maxSize: riskResult.maxSize,
        fallbackSize: computePositionSize(riskResult.edge, debateResult.finalConfidence, debateResult.finalUncertainty),
      });

      if (orderSize == null) {
        await emitStage({
          stage: 'DECISION',
          type: 'skipped' as const,
          message: 'Risk engine produced no executable paper order size',
          provider: 'system',
          serviceName: 'paper-execution',
        });
      } else {
        const orderPrice = riskResult.side === 'YES' ? impliedProb : 1 - impliedProb;
        const prefix = 'PAPER';
        const now = new Date();
        const venueOrderId = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const mode = getTradingMode();
        const dataSource = getModeState(mode).dataSource;

        const order = await createOrderCompat(
          buildPaperOrderRecord({
            marketId,
            venueOrderId,
            side: riskResult.side ?? 'YES',
            price: orderPrice,
            size: orderSize,
            now,
            dataSource,
          }) as unknown as Record<string, unknown>,
        );

        // Position is created by order-tracker when order is filled
        // No instant position creation

        await createPaperBet({
          marketId,
          decisionId: decision.id,
          predictionType: 'BID',
          predictedProb: debateResult.finalProbability,
          predictedSide: riskResult.side ?? 'YES',
          impliedProb,
          edge: riskResult.edge,
          confidence: debateResult.finalConfidence,
          stake: orderSize,
          entryPrice: orderPrice,
        });

        result.orderId = venueOrderId;

        // Create lifecycle job to track this order
        await db.job.create({
          data: {
            type: 'ORDER_TRACK',
            status: 'PENDING',
            priority: 4,
            payload: JSON.stringify({ marketId }),
          },
        }).catch(() => {});

        if (candidate) {
          await db.tradeCandidate.update({
            where: { id: candidate.id },
            data: { stage: 'EXECUTED' },
          });
        }
      }
    }

try {
       await writeResearchToQdrant(marketId, market.title, researchContext, {
         judgeProbability: debateResult.finalProbability,
         confidence: debateResult.finalConfidence,
         action: riskResult.action,
         side: riskResult.side,
         category: market.category,
       });
     } catch (e) {
       console.error('Qdrant writeback failed (non-fatal):', e);
     }

    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Pipeline error';
    console.error(`[Pipeline] Error for market ${marketId}:`, error);
    try {
      const researchRuns = await db.researchRun.findMany({
        where: { marketId, status: 'RUNNING' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      if (researchRuns.length > 0) {
        await db.researchRun.update({
          where: { id: researchRuns[0].id },
          data: { status: 'FAILED', completedAt: new Date() },
        });
      }
    } catch {}
    return result;
  }
}
