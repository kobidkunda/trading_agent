import { db } from '@/lib/db';
import { computeRisk, computePositionSize } from '@/lib/engine/risk';
import { computeBiasAdjustedProb } from '@/lib/engine/bias-correction';
import { runTriageAgent } from '@/lib/engine/agents/triage';
import { runDebateArena } from '@/lib/engine/debate-arena';
import { searchSearXNG } from '@/lib/engine/research/search';
import { extractContent } from '@/lib/engine/research/extract';
// DeerFlow disabled — service unreachable
// import { runDeerFlowResearch } from '@/lib/engine/research/deerflow';
import { runTradingAgentsSimple, runTradingAgentsNative, isNativeAnalysisCandidate } from '@/lib/engine/research/tradingagents-api';
import { runFullResearch } from '@/lib/engine/research/full-research';
import { synthesizeFindings, formatAgentReachAsSource, formatSearchAsSource, formatTradingAgentsAsSource, formatRedditAsSource, formatXAsSource } from '@/lib/engine/research/synthesis';
import { writeResearchToQdrant, retrieveSimilarMarkets } from '@/lib/engine/memory/qdrant';
import { isTestMode, getTradingMode, getModeState } from '@/lib/engine/mode';
import { getStageRouting, getResearchDepth, getModelForStage } from '@/lib/engine/service-routing';
import { createPaperBet } from '@/lib/engine/paper-bets';
import { buildPaperOrderRecord, resolvePaperExecutionSize } from '@/lib/engine/paper-execution';
import { createOrderCompat } from '@/lib/engine/prisma-runtime-compat';
import { canRunStage, isServiceReachable } from '@/lib/engine/health-check';
import { resolveResearchProvider } from '@/lib/engine/service-routing';
import { runFirecrawlResearch } from '@/lib/engine/research/firecrawl-research';
import { runPostDebatePrediction } from '@/lib/engine/post-debate-prediction';
import { runEnsemblePipeline } from '@/lib/engine/ensemble-probability';
import { computeCandidateScore } from '@/lib/engine/candidate-scoring';
import { computeClusterAwareExposure, computeExposureTotals } from '@/lib/engine/risk-exposure';
import { buildWatchlistPayload, shouldCreateExecutionJob, shouldCreateWatchlistEntry } from '@/lib/engine/pipeline-decision-helpers';
import { computeNextEligibleAt } from '@/lib/engine/candidate-dedupe';
import { causalTreeEngine } from '@/lib/engine/causal-tree';
import { getPolymarketMarkets } from '@/lib/venues/polymarket';
import { getKalshiMarkets } from '@/lib/venues/kalshi';
import type { LivePipelineStage, ResearchDepth, TransparencySourceRef } from '@/lib/types';
import { getEffectiveTradingConfig, STRATEGY_SETTINGS_KEY, TRADING_CONFIG_KEY, TRADING_MODE_KEY } from '@/lib/engine/trading-settings';
import { evaluateAPlusSignalGate } from '@/lib/engine/a-plus/signal-gate';
import { getWalletSignalTrustContext } from '@/lib/engine/wallet-signal';
import { getLiveGovernanceSettings } from '@/lib/engine/live-governance';
import { saveDeepResearchProgress, type DeepResearchProgress } from '@/lib/engine/worker-checkpoint';
import { tailRiskAnalyzer } from '@/lib/engine/correlation-risk';

// ── Event & Options types ──────────────────────────────────────────

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
  ensembleResult?: import('@/lib/engine/ensemble-probability').EnsembleResult;
  ensembleDisagreement?: import('@/lib/engine/ensemble-probability').DisagreementDetail;
  riskAction: 'BID' | 'SKIP' | 'WATCH' | null;
  orderId: string | null;
  error: string | null;
  stages: string[];
}

// ── Pipeline Context (shared data loaded once) ──────────────────────

export interface PipelineContext {
  market: Awaited<ReturnType<typeof db.market.findUnique>> & {
    snapshots: Array<{
      id: string; marketId: string; impliedProb: number; liquidity: number;
      spread: number; volume24h: number; bestBid: number; bestAsk: number;
      timestamp: Date;
    }>;
    oracleCheck: { id: string; riskLevel: string; manualReviewStatus: string | null; manualReviewExpiresAt: Date | null } | null;
  };
  candidate: Awaited<ReturnType<typeof db.tradeCandidate.findFirst>>;
  snapshot: Record<string, unknown> | null;
  impliedProb: number;
  liquidity: number;
  biasAdjustedProb: number;
  routing: Awaited<ReturnType<typeof getStageRouting>>;
  strategySetting: Awaited<ReturnType<typeof db.settings.findUnique>> | null;
  tradingConfigSetting: Awaited<ReturnType<typeof db.settings.findUnique>> | null;
  tradingModeSetting: Awaited<ReturnType<typeof db.settings.findUnique>> | null;
  tradingConfig: ReturnType<typeof getEffectiveTradingConfig>;
}

// ── Stage-specific result types ─────────────────────────────────────

export interface TriageStageResult {
  triageStatus: string;
  worthResearch: boolean;
  triageResult: Awaited<ReturnType<typeof runTriageAgent>>;
  biasAdjustedProb: number;
  candidate: Awaited<ReturnType<typeof db.tradeCandidate.findFirst>>;
  stages: string[];
}

export interface ResearchStageResult {
  researchRunId: string;
  researchContext: string;
  depth: ResearchDepth;
  stages: string[];
  candidate: Awaited<ReturnType<typeof db.tradeCandidate.findFirst>>;
}

export interface JudgeStageResult {
  judgeProbability: number;
  judgeConfidence: number;
  judgeUncertainty: number;
  debateResult: import('@/lib/engine/debate-arena').DebateArenaResult | null;
  postDebatePrediction: import('@/lib/engine/post-debate-prediction').PostDebatePredictionResult | null;
  ensembleResult?: import('@/lib/engine/ensemble-probability').EnsembleResult;
  ensembleDisagreement?: import('@/lib/engine/ensemble-probability').DisagreementDetail;
  ensembleUncertaintyBoost: number;
  modelDisagreement: number;
  disagreementLevel: 'LOW' | 'MODERATE' | 'HIGH';
  researchRunId: string;
  stages: string[];
  candidate: Awaited<ReturnType<typeof db.tradeCandidate.findFirst>>;
}

export interface RiskStageResult {
  decisionId: string;
  riskAction: 'BID' | 'SKIP' | 'WATCH' | null;
  gatedRiskResult: ReturnType<typeof computeRisk> & { action: 'BID' | 'SKIP' | 'WATCH'; adjustedSize?: number };
  aPlusGatePassed: boolean;
  decision: Awaited<ReturnType<typeof db.decision.create>>;
  stages: string[];
  candidate: Awaited<ReturnType<typeof db.tradeCandidate.findFirst>>;
}

export interface ExecuteStageResult {
  orderId: string | null;
  venueOrderId: string | null;
  stages: string[];
  candidate: Awaited<ReturnType<typeof db.tradeCandidate.findFirst>>;
}

// ── Helpers ─────────────────────────────────────────────────────────

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

// ── resolvePipelineContext ──────────────────────────────────────────
// Loads market data, fresh venue snapshot, bias correction, config, routing.
// Used by all stage functions and the compatibility wrapper.

async function withVenueFetchTimeout<T>(label: string, fetcher: () => Promise<T>, timeoutMs = 12_000): Promise<T> {
  return Promise.race([
    fetcher(),
    new Promise<never>((_, reject) => setTimeout(() => {
      reject(new Error(`${label} fetch timed out after ${timeoutMs}ms`));
    }, timeoutMs)),
  ]);
}

export async function resolvePipelineContext(marketId: string): Promise<PipelineContext> {
  const [strategySetting, tradingConfigSetting, tradingModeSetting] = await Promise.all([
    db.settings.findUnique({ where: { key: STRATEGY_SETTINGS_KEY } }),
    db.settings.findUnique({ where: { key: TRADING_CONFIG_KEY } }),
    db.settings.findUnique({ where: { key: TRADING_MODE_KEY } }),
  ]);
  const tradingConfig = getEffectiveTradingConfig({
    strategySettings: strategySetting ? JSON.parse(strategySetting.value) : null,
    tradingConfig: tradingConfigSetting ? JSON.parse(tradingConfigSetting.value) : null,
    tradingMode: tradingModeSetting?.value ?? null,
  });

  const market = await db.market.findUnique({
    where: { id: marketId },
    include: {
      snapshots: { orderBy: { timestamp: 'desc' }, take: 1 },
      oracleCheck: true,
    },
  });
  if (!market) throw new Error(`Market ${marketId} not found`);

  const snapshot = market.snapshots[0];
  let impliedProb = snapshot?.impliedProb ?? market.latestPrice ?? 0.5;
  // Guard: ?? only catches null/undefined, not 0. Force sane default.
  if (!impliedProb || impliedProb <= 0 || impliedProb > 1) impliedProb = 0.5;
  let liquidity = snapshot?.liquidity ?? market.latestLiquidity ?? 0;

  if (market.venue === 'POLYMARKET') {
    const polymarketResult = await withVenueFetchTimeout('Fresh Polymarket', () => getPolymarketMarkets({ limit: 100 }));
    const fresh = polymarketResult.markets.find((m: { externalId: string }) => m.externalId === market.externalId);
    if (fresh) {
      impliedProb = fresh.impliedProb;
      liquidity = fresh.liquidity;
      await db.marketSnapshot.create({
        data: { marketId, impliedProb, liquidity, spread: fresh.spread, volume24h: fresh.volume24h || 0, bestBid: fresh.bestBid ?? impliedProb - 0.01, bestAsk: fresh.bestAsk ?? impliedProb + 0.01 },
      });
    }
  } else if (market.venue === 'KALSHI') {
    const kalshiResult = await withVenueFetchTimeout('Fresh Kalshi', () => getKalshiMarkets());
    const freshList = kalshiResult.markets;
    const fresh = freshList.find((m: { ticker: string }) => m.ticker === market.externalId);
    if (fresh) {
      impliedProb = fresh.last_price / 100;
      liquidity = fresh.volume;
      await db.marketSnapshot.create({
        data: { marketId, impliedProb, liquidity, spread: Math.max(0.01, (fresh.yes_ask - fresh.yes_bid) / 100), volume24h: fresh.volume, bestBid: fresh.yes_bid / 100, bestAsk: fresh.yes_ask / 100 },
      });
    }
  }

  // Bias correction via Wang transform
  const daysToResolution = market.resolutionTime
    ? Math.max(0, (market.resolutionTime.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 30;
  const biasResult = computeBiasAdjustedProb({
    marketPrice: impliedProb,
    category: market.category,
    timeToResolution: daysToResolution,
    liquidity,
  });
  const biasAdjustedProb = biasResult.biasAdjustedProb;

  // Load routing config early for all stages
  const routing = await getStageRouting();

  const candidate = await db.tradeCandidate.findFirst({ where: { marketId } });

  return {
    market: market as PipelineContext['market'],
    candidate,
    snapshot: snapshot as Record<string, unknown> | null,
    impliedProb,
    liquidity,
    biasAdjustedProb,
    routing,
    strategySetting,
    tradingConfigSetting,
    tradingModeSetting,
    tradingConfig,
  };
}

// ── Stage 1: TRIAGE ─────────────────────────────────────────────────

export async function runTriageStage(
  marketId: string,
  options: PipelineRunOptions = {},
): Promise<TriageStageResult> {
  const emitStage = async (event: PipelineStageEvent): Promise<void> => {
    await options.onStage?.(event);
  };

  const stages: string[] = [];
  stages.push('TRIAGE');

  const ctx = await resolvePipelineContext(marketId);
  const { market, candidate, impliedProb, liquidity, biasAdjustedProb, routing } = ctx;

  const triageModel = getModelForStage('triage', routing);
  await emitStage({
    stage: 'TRIAGE',
    message: 'Running triage',
    provider: 'system',
    serviceName: 'triage-agent',
    model: triageModel,
  });
  const triageResult = await runTriageAgent(
    marketId, market.title, market.description || '', market.category, impliedProb, liquidity,
  );

  if (candidate) {
    await db.tradeCandidate.update({
      where: { id: candidate.id },
      data: {
        stage: 'TRIAGED',
        triageStatus: triageResult.status,
        triageReason: triageResult.reason,
        researchQueued: triageResult.worthResearch,
        biasAdjustedProb,
      },
    });
  }

  return {
    triageStatus: triageResult.status,
    worthResearch: triageResult.worthResearch,
    triageResult,
    biasAdjustedProb,
    candidate,
    stages,
  };
}

// ── Stage 2: RESEARCH ───────────────────────────────────────────────

export async function runResearchStage(
  marketId: string,
  depth?: ResearchDepth,
  options: PipelineRunOptions = {},
  resumeFromCheckpoint?: DeepResearchProgress & { jobId?: string },
): Promise<ResearchStageResult> {
  const emitStage = async (event: PipelineStageEvent): Promise<void> => {
    await options.onStage?.(event);
  };

  const stages: string[] = [];
  stages.push('RESEARCH');

  const ctx = await resolvePipelineContext(marketId);
  const { market, candidate, impliedProb, routing } = ctx;
  let actualDepth: ResearchDepth = depth ?? getResearchDepth(routing);

  const researchRun = await db.researchRun.create({
    data: {
      marketId,
      candidateId: candidate?.id || null,
      status: 'RUNNING',
      depth: actualDepth,
      startedAt: new Date(),
    },
  });

  let researchContext = '';

  // DeerFlow disabled — service unreachable (192.168.88.97:2026). Redirect DEERFLOW→FULL.
  if (actualDepth === 'DEERFLOW') {
    console.warn('[Pipeline] DEERFLOW depth requested but DeerFlow disabled, falling back to FULL');
    actualDepth = 'FULL';
  }
  if (actualDepth === 'FULL') {
    const synthesisModel = routing.analystDeepThinkLlm || 'paper_proglm';
    const analystSections: string[] = [];
    let agentReachSource: ReturnType<typeof formatAgentReachAsSource> | null = null;
    let newsSource: ReturnType<typeof formatTradingAgentsAsSource> | null = null;
    let sentimentSource: ReturnType<typeof formatTradingAgentsAsSource> | null = null;
    let technicalSource: ReturnType<typeof formatTradingAgentsAsSource> | null = null;
    let searchSource: ReturnType<typeof formatSearchAsSource> | null = null;
    let redditSource: ReturnType<typeof formatRedditAsSource> | null = null;
    let xSource: ReturnType<typeof formatXAsSource> | null = null;

    stages.push('WEB_SEARCH');
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

    if (resumeFromCheckpoint?.jobId) {
      await saveDeepResearchProgress(resumeFromCheckpoint.jobId, researchRun.id, {
        completedSearchQueries: [
          market.title,
          ...additionalQueries,
        ],
        extractedContentCount: webSearchResults.length,
        currentSearchPhase: 'WEB_SEARCH',
        partialResultIds: [],
      }).catch((e) => { console.error('[Pipeline] Failed to save deep research progress (WEB_SEARCH):', e); });
    }

    const fullResearchResult = await runFullResearch({
      marketId,
      marketTitle: market.title,
      marketDescription: market.description || '',
      marketCategory: market.category,
      impliedProbability: impliedProb,
      routing,
      agentReachTargetSourceCount: 300,
    });

    if (fullResearchResult.deerflow) {
      console.warn('[Pipeline] DeerFlow result present but DeerFlow disabled — ignoring');
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

      const nativeResult = fullResearchResult.tradingagentsNative;
      if (nativeResult && nativeResult.status !== 'failed') {
        console.log('[Pipeline] Storing native graph AgentOutput');
        await db.agentOutput.create({
          data: {
            researchRunId: researchRun.id,
            role: 'TRADINGAGENTS_NATIVE',
            stage: 'TRADINGAGENTS',
            serviceName: 'tradingagents-native',
            provider: 'tradingagents',
            modelUsed: 'tradingagents-native',
            output: JSON.stringify({
              finalProbability: nativeResult.probability,
              finalConfidence: nativeResult.confidence,
              status: nativeResult.status,
              fundamentals: nativeResult.fundamentals,
              sentiment: nativeResult.sentiment,
              news: nativeResult.news,
              technical: nativeResult.technical,
              bullResearcher: nativeResult.bullResearcher,
              bearResearcher: nativeResult.bearResearcher,
              trader: nativeResult.trader,
              riskManager: nativeResult.riskManager,
              portfolioManager: nativeResult.portfolioManager,
              fullReport: nativeResult.fullReport,
            }),
            rawOutput: JSON.stringify(nativeResult),
            summary: `Native graph analysis: confidence=${nativeResult.confidence}, probability=${nativeResult.probability}`,
          },
        });
      }
    }

    researchContext = analystSections.join('\n\n');

    if (resumeFromCheckpoint?.jobId) {
      await saveDeepResearchProgress(resumeFromCheckpoint.jobId, researchRun.id, {
        completedSearchQueries: resumeFromCheckpoint.completedSearchQueries ?? [
          market.title,
          ...additionalQueries,
        ],
        extractedContentCount: analystSections.length,
        currentSearchPhase: 'SYNTHESIS',
        partialResultIds: [],
      }).catch((e) => { console.error('[Pipeline] Failed to save deep research progress (SYNTHESIS):', e); });
    }

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
        null, // deerflow — disabled
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

    // ── TradingAgents for QUICK/DEEP depths (not FULL which handles it above) ──
    stages.push('ANALYSTS');
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

        // Native graph analysis for financial markets (QUICK/DEEP path)
        if (isNativeAnalysisCandidate(market.category) && taResult?.status === 'completed') {
          try {
            const nativeResult = await runTradingAgentsNative(
              market.title, taDate,
              routing.analystDeepThinkLlm,
              routing.analystQuickThinkLlm,
              routing.analystLlmProvider,
            );
            if (nativeResult && nativeResult.status !== 'failed') {
              console.log('[Pipeline] Storing native graph AgentOutput (QUICK/DEEP path)');
              await db.agentOutput.create({
                data: {
                  researchRunId: researchRun.id,
                  role: 'TRADINGAGENTS_NATIVE',
                  stage: 'TRADINGAGENTS',
                  serviceName: 'tradingagents-native',
                  provider: 'tradingagents',
                  modelUsed: 'tradingagents-native',
                  output: JSON.stringify({
                    finalProbability: nativeResult.probability,
                    finalConfidence: nativeResult.confidence,
                    status: nativeResult.status,
                    fundamentals: nativeResult.fundamentals,
                    sentiment: nativeResult.sentiment,
                    news: nativeResult.news,
                    technical: nativeResult.technical,
                    bullResearcher: nativeResult.bullResearcher,
                    bearResearcher: nativeResult.bearResearcher,
                    trader: nativeResult.trader,
                    riskManager: nativeResult.riskManager,
                    portfolioManager: nativeResult.portfolioManager,
                    fullReport: nativeResult.fullReport,
                  }),
                  rawOutput: JSON.stringify(nativeResult),
                  summary: `Native graph analysis: confidence=${nativeResult.confidence}, probability=${nativeResult.probability}`,
                },
              });
            }
          } catch (nativeErr) {
            console.warn('[Pipeline] Native analysis (QUICK/DEEP) threw, continuing:', String(nativeErr));
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
      data: { stage: 'RESEARCHING', lastResearchAt: new Date() },
    });
  }

  await retrieveSimilarMarkets(market.title, market.description || '');

  // Quality gate: when research produces no usable context, still complete
  // the run with a fallback indicator. The judge stage will build a
  // market-data fallback context so the pipeline doesn't stall.
  const failurePatterns: string[] = [];
  if (!researchContext || failurePatterns.includes(researchContext.trim())) {
    console.warn(`[Pipeline] Research produced no usable context for ${marketId}, marking for fallback`);
    // Don't throw — let judge stage build fallback from market data
  }

  // Mark research run as COMPLETED so queued Judge can find it
  try {
    await db.researchRun.update({
      where: { id: researchRun.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  } catch (e) { console.error('[Pipeline] Failed to finalize research run status:', e); }

  return {
    researchRunId: researchRun.id,
    researchContext,
    depth: actualDepth,
    stages,
    candidate,
  };
}

// ── Fallback context builder: when ALL research sources return 0 ─────
// Generates minimal market-data-based context so debate agents have
// something to work with instead of stalling the pipeline.
function buildMarketDataFallbackContext(
  marketTitle: string,
  marketDescription: string,
  marketCategory: string,
  marketVenue: string,
  impliedProb: number,
  liquidity: number,
  spread: number,
  volume24h: number,
  bestBid: number,
  bestAsk: number,
  originalContext: string,
): string {
  const lines = [
    `[FALLBACK_CONTEXT — NO RESEARCH SOURCES AVAILABLE]`,
    `All research sources (SearXNG, TradingAgents, Agent-Reach) returned 0 usable sources.`,
    `Confidence estimates should be conservative (low confidence) due to research unavailability.`,
    ``,
    `--- MARKET DATA (for fallback analysis) ---`,
    `Market Title: "${marketTitle}"`,
    `Category: ${marketCategory}`,
    `Venue: ${marketVenue}`,
    `Description: ${marketDescription || '(none)'}`,
    `Implied Probability: ${(impliedProb * 100).toFixed(1)}%`,
    `Liquidity: $${liquidity.toLocaleString()}`,
    `Spread: ${(spread * 100).toFixed(2)}% (Bid ${(bestBid * 100).toFixed(1)}% / Ask ${(bestAsk * 100).toFixed(1)}%)`,
    `24h Volume: $${volume24h.toLocaleString()}`,
    ``,
    `--- ORIGINAL RESEARCH OUTPUT (all failures) ---`,
    originalContext || '(empty — no research ran)',
    ``,
    `INSTRUCTIONS: You MUST produce a fallback bull/bear analysis based on market microstructure`,
    `(price, liquidity, spread, volume, category) alone. Confidence should be capped at 0.4 due to`,
    `research unavailability. Mark your analysis clearly as fallback-based.`,
  ];
  return lines.join('\n');
}

// ── Stage 3: JUDGE ──────────────────────────────────────────────────

export async function runJudgeStage(
  marketId: string,
  researchRunId: string,
  researchContext: string,
  depth?: ResearchDepth,
  options: PipelineRunOptions = {},
): Promise<JudgeStageResult> {
  const emitStage = async (event: PipelineStageEvent): Promise<void> => {
    await options.onStage?.(event);
  };

  const stages: string[] = [];
  const ctx = await resolvePipelineContext(marketId);
  const { market, candidate, impliedProb, routing, liquidity } = ctx;
  const actualDepth: ResearchDepth = depth ?? getResearchDepth(routing);

  // Quality gate: when ALL research sources return 0 usable results,
  // build a fallback context from market data so debate agents can
  // still produce predictions instead of stalling the pipeline.
  const researchIsBare =
    !researchContext ||
    researchContext.trim().length < 50 ||
    /^\[(WEB\s*SEARCH|ANALYSTS|TRADINGAGENTS|AGENT\s*REACH)\]\s*\n?\s*FAILED/.test(researchContext.trim());

  const effectiveResearchContext = researchIsBare
    ? buildMarketDataFallbackContext(
        market.title,
        market.description || '',
        market.category,
        market.venue,
        impliedProb,
        liquidity,
        (market.snapshots[0] as any)?.spread ?? 0.05,
        (market.snapshots[0] as any)?.volume24h ?? 0,
        (market.snapshots[0] as any)?.bestBid ?? impliedProb - 0.01,
        (market.snapshots[0] as any)?.bestAsk ?? impliedProb + 0.01,
        researchContext,
      )
    : researchContext;

  if (researchIsBare) {
    console.log(`[Pipeline] Research context is bare for ${marketId}, using market-data fallback`);
  }

  let judgeProbability = 0.5;
  let judgeConfidence = 0.3;
  let judgeUncertainty = 0.5;
  let debateResult: import('@/lib/engine/debate-arena').DebateArenaResult | null = null;
  let postDebatePrediction: import('@/lib/engine/post-debate-prediction').PostDebatePredictionResult | null = null;
  let ensembleUncertaintyBoost = 0;
  let modelDisagreement = 0;
  let disagreementLevel: 'LOW' | 'MODERATE' | 'HIGH' = 'LOW';
  const judgeModel = getModelForStage('judge', routing);

  if (actualDepth === 'DEEP') {
    // Phase: Causal Tree — decompose thesis, research leaves, aggregate
    stages.push('CAUSAL_TREE');
    await emitStage({
      stage: 'JUDGE',
      message: 'Decomposing market thesis into causal tree',
      provider: 'system',
      serviceName: 'causal-tree',
      model: judgeModel,
    });

    const causalModel = routing.analystDeepThinkLlm || routing.judgeModel || 'paper_proglm';
    let causalAggregation: import('@/lib/engine/causal-tree').CausalTreeAggregation | null = null;

    try {
      const { rootId, tree } = await causalTreeEngine.decomposeThesis(
        market.title,
        researchRunId,
        causalModel,
      );

      const rootNode = await db.causalTreeNode.findUnique({
        where: { id: rootId },
        include: { children: true },
      });

      if (rootNode) {
        const evidenceSections = effectiveResearchContext.split('\n\n').slice(0, rootNode.children.length * 2 || 6);
        for (let i = 0; i < rootNode.children.length && i < evidenceSections.length; i++) {
          await causalTreeEngine.researchNode(
            rootNode.children[i].id,
            evidenceSections[i],
            undefined,
            0.6,
            0.5,
          );
        }
      }

      await db.agentOutput.create({
        data: {
          researchRunId,
          role: 'CAUSAL_TREE',
          stage: 'JUDGE',
          serviceName: 'causal-tree',
          provider: 'system',
          modelUsed: causalModel,
          output: JSON.stringify({ tree, rootId }),
          summary: `Causal tree: ${tree.root.label} with ${rootNode?.children.length ?? 0} factors`,
        },
      });

      causalAggregation = await causalTreeEngine.aggregateTree(rootId);

      await db.agentOutput.create({
        data: {
          researchRunId,
          role: 'CAUSAL_AGGREGATOR',
          stage: 'JUDGE',
          serviceName: 'causal-tree',
          provider: 'system',
          modelUsed: causalModel,
          output: JSON.stringify(causalAggregation),
          summary: `Aggregated probability: ${(causalAggregation.finalProbability * 100).toFixed(1)}% from ${causalAggregation.leafCount} leaves`,
        },
      });
    } catch (e) {
      console.error('[Pipeline] Causal tree failed:', e);
      await emitStage({
        stage: 'JUDGE',
        type: 'failed',
        message: `Causal tree failed: ${String(e)}`,
        provider: 'system',
        serviceName: 'causal-tree',
        failureReason: String(e),
      });
    }

    judgeProbability = causalAggregation?.finalProbability ?? 0.5;
    judgeConfidence = causalAggregation?.confidence ?? 0.3;
    judgeUncertainty = 1 - judgeConfidence;
  } else {
    // ── DEBATE ARENA: Multi-model debate on evidence ──
    stages.push('DEBATE');
    await emitStage({
      stage: 'JUDGE',
      message: 'Running judge debate arena',
      provider: 'system',
      serviceName: 'debate-arena',
      model: judgeModel,
    });
    try {
      debateResult = await runDebateArena(market.title, impliedProb, effectiveResearchContext, routing);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.agentOutput.create({
        data: {
          researchRunId,
          role: 'DEBATE_FAILED',
          stage: 'JUDGE',
          serviceName: 'debate-arena',
          provider: 'system',
          modelUsed: judgeModel,
          output: JSON.stringify({ error: message }),
          rawOutput: message,
          summary: message.slice(0, 4000),
          failureReason: message,
        },
      });
      await db.researchRun.update({
        where: { id: researchRunId },
        data: { status: 'FAILED', completedAt: new Date() },
      });
      await db.auditLog.create({
        data: {
          action: 'DEBATE_FAILED',
          entityType: 'ResearchRun',
          entityId: researchRunId,
          details: message,
        },
      });
      await emitStage({
        stage: 'JUDGE',
        type: 'failed',
        message: `Debate failed: ${message}`,
        provider: 'system',
        serviceName: 'debate-arena',
        failureReason: message,
      });
      judgeProbability = impliedProb;
      judgeConfidence = 0.3;
      judgeUncertainty = 0.7;
    }

    if (debateResult) {
      for (const round of debateResult.rounds) {
        await db.agentOutput.create({
          data: {
            researchRunId,
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
            researchRunId,
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
          researchRunId,
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
    }

    // ── POST-DEBATE PREDICTION: Final synthesis via MiroFish ──
    if (debateResult) {
      stages.push('MIROFISH_PREDICT');
      const mirofishModel = routing.mirofishPredictionModel || 'free_ling';
      await emitStage({
        stage: 'MIROFISH_PREDICT',
        message: `Running post-debate prediction via MiroFish (${mirofishModel})`,
        provider: 'system',
        serviceName: 'mirofish-predict',
        model: mirofishModel,
      });

      try {
        postDebatePrediction = await runPostDebatePrediction(debateResult, effectiveResearchContext, mirofishModel);

        await db.agentOutput.create({
          data: {
            researchRunId,
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
    }

    if (debateResult) {
      judgeProbability = debateResult.finalProbability;
      judgeConfidence = debateResult.finalConfidence;
      judgeUncertainty = debateResult.finalUncertainty;
    }
    
    // Quality gate: fail if judge confidence is below minimum threshold
    if (judgeConfidence < 0.20) {
      throw new Error(`Research quality insufficient: confidence ${(judgeConfidence * 100).toFixed(0)}% below minimum 20%`);
    }
  }

  // Mark research run as completed only AFTER all judgment outputs are created
  await db.researchRun.update({
    where: { id: researchRunId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  if (candidate) {
    await db.tradeCandidate.update({
      where: { id: candidate.id },
      data: { lastResearchAt: new Date() },
    });
  }

  // ── Phase: ENSEMBLE ──
  try {
    const ensembleOutcome = await runEnsemblePipeline(marketId, candidate?.id ?? null, researchRunId, market.category);
    modelDisagreement = ensembleOutcome.disagreement.score;
    disagreementLevel = ensembleOutcome.disagreement.level;

    if (ensembleOutcome.disagreement.level === 'HIGH') {
      ensembleUncertaintyBoost = 0.15;
      stages.push('ENSEMBLE_HIGH_DISAGREEMENT');
      await emitStage({
        stage: 'JUDGE',
        type: 'progress',
        message: `Ensemble model disagreement: ${ensembleOutcome.disagreement.summary}`,
        provider: 'system',
        serviceName: 'ensemble-engine',
        model: null,
      });
    }

    return {
      judgeProbability,
      judgeConfidence,
      judgeUncertainty,
      debateResult,
      postDebatePrediction,
      ensembleResult: ensembleOutcome.result,
      ensembleDisagreement: ensembleOutcome.disagreement,
      ensembleUncertaintyBoost,
      modelDisagreement,
      disagreementLevel,
      researchRunId,
      stages,
      candidate,
    };
  } catch (e) {
    console.error('[Pipeline] Ensemble pipeline failed (non-fatal):', e);
  }

  if (candidate) {
    await db.tradeCandidate.update({
      where: { id: candidate.id },
      data: { stage: 'JUDGED' },
    });
  }

  return {
    judgeProbability,
    judgeConfidence,
    judgeUncertainty,
    debateResult,
    postDebatePrediction,
    ensembleResult: undefined,
    ensembleDisagreement: undefined,
    ensembleUncertaintyBoost,
    modelDisagreement,
    disagreementLevel,
    researchRunId,
    stages,
    candidate,
  };
}

// ── Stage 4: RISK ───────────────────────────────────────────────────

export async function runRiskStage(
  marketId: string,
  judgeProbability: number,
  judgeConfidence: number,
  judgeUncertainty: number,
  ensembleUncertaintyBoost: number = 0,
  modelDisagreement: number = 0,
  disagreementLevel: 'LOW' | 'MODERATE' | 'HIGH' = 'LOW',
  options: PipelineRunOptions = {},
): Promise<RiskStageResult> {
  const emitStage = async (event: PipelineStageEvent): Promise<void> => {
    await options.onStage?.(event);
  };

  const stages: string[] = [];
  stages.push('RISK');

  const ctx = await resolvePipelineContext(marketId);
  const { market, candidate, snapshot, impliedProb, liquidity, biasAdjustedProb, strategySetting, tradingConfig } = ctx;

  await emitStage({
    stage: 'RISK',
    message: 'Running deterministic risk engine',
    provider: 'system',
    serviceName: 'risk-engine',
    model: null,
  });

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
  const strategyFees = typeof strategy.fees === 'number' ? strategy.fees : 0.02;
  const strategySlippage = typeof strategy.slippage === 'number' ? strategy.slippage : 0.01;

  const openPositions = await db.position.findMany({
    where: { status: 'OPEN' },
    include: { market: { select: { category: true } } },
  });

  const exposureTotals = computeExposureTotals(openPositions, market.category);
  const clusterExposureTotals = await computeClusterAwareExposure(
    marketId,
    openPositions.map((position) => ({
      currentSize: position.currentSize,
      market: {
        id: position.marketId,
        category: position.market.category,
      },
    })),
    market.category,
  );
  const actualDailyExposure = exposureTotals.dailyExposure;
  const actualCategoryExposure = exposureTotals.categoryExposure;
  const tailRiskWarnings = tailRiskAnalyzer.findWipeoutRisk(
    openPositions.map((position) =>
      tailRiskAnalyzer.analyzePosition(
        position.marketId,
        position.side,
        position.currentSize,
        position.entryPrice,
      ),
    ),
  );

  const dailyExposureBlocked = actualDailyExposure >= strategyDailyLimit;
  const categoryExposureBlocked = actualCategoryExposure >= strategyCategoryLimit;

  const riskInput = {
    impliedProbability: biasAdjustedProb,
    judgeProbability,
    confidence: judgeConfidence,
    uncertainty: judgeUncertainty,
    fees: strategyFees,
    slippage: strategySlippage,
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
    bidEdgeThreshold: typeof strategy.bidEdgeThreshold === 'number' ? strategy.bidEdgeThreshold : undefined,
    watchEdgeThreshold: typeof strategy.watchEdgeThreshold === 'number' ? strategy.watchEdgeThreshold : undefined,
    bidConfidenceThreshold: typeof strategy.bidConfidenceThreshold === 'number' ? strategy.bidConfidenceThreshold : undefined,
    watchConfidenceThreshold: typeof strategy.watchConfidenceThreshold === 'number' ? strategy.watchConfidenceThreshold : undefined,
    maxUncertaintyThreshold: typeof strategy.maxUncertaintyThreshold === 'number' ? strategy.maxUncertaintyThreshold : undefined,
    ignoreTailRiskWarnings: strategy.ignoreTailRiskWarnings === true,
    remainingMarketCapacity: Math.max(0, strategyPositionLimit),
    remainingDailyCapacity: Math.max(0, strategyDailyLimit - actualDailyExposure),
    remainingCategoryCapacity: Math.max(0, strategyCategoryLimit - actualCategoryExposure),
    marketLiquidity: liquidity,
    marketSpread: (snapshot as any)?.spread ?? 0.05,
    catalystTiming: undefined,
  };

  const riskResult = computeRisk(riskInput, {
    clusterExposures: clusterExposureTotals.clusterExposures,
    clusterOverlapCount: clusterExposureTotals.clusterOverlapCount,
    tailRiskWarnings,
  });

  const latestOrderbook = await db.orderbookSnapshot.findFirst({
    where: { marketId },
    orderBy: { capturedAt: 'desc' },
  });
  const orderbookAgeSeconds = latestOrderbook?.capturedAt
    ? Math.max(0, (Date.now() - new Date(latestOrderbook.capturedAt).getTime()) / 1000)
    : undefined;
  const oracleCheckPresent = market.oracleCheck != null;
  const oracleRiskScore =
    oracleCheckPresent && candidate?.oracleRiskPenalty != null
      ? Math.min(1, candidate.oracleRiskPenalty / 20)
      : 1;
  const maxClusterUtilization = clusterExposureTotals.clusterExposures.reduce(
    (highest, exposure) => Math.max(highest, exposure.utilization),
    0,
  );
  const correlationExposure = Math.min(
    1,
    Math.max(
      actualCategoryExposure / Math.max(strategyCategoryLimit, 1),
      maxClusterUtilization,
    ),
  );
  const tailRiskScore = Math.min(
    1,
    Math.max(
      ensembleUncertaintyBoost + (judgeUncertainty * 0.25),
      tailRiskWarnings.some((warning) => warning.severity === 'CRITICAL')
        ? 1
        : tailRiskWarnings.some((warning) => warning.severity === 'HIGH')
          ? 0.85
          : tailRiskWarnings.some((warning) => warning.severity === 'MEDIUM')
            ? 0.6
            : 0,
    ),
  );
  const orderbookQuality =
    latestOrderbook == null
      ? 0
      : Math.max(
          0,
          Math.min(
            20,
            (latestOrderbook.fillProbability ?? 0) * 10 +
              ((latestOrderbook.bidDepth ?? 0) + (latestOrderbook.askDepth ?? 0)) / 1000 -
              (latestOrderbook.thinBookDanger ? 5 : 0),
          ),
        );
  const [walletTrustContext, governance] = await Promise.all([
    getWalletSignalTrustContext(marketId),
    getLiveGovernanceSettings(),
  ]);
  const manualReviewApproved =
    market.oracleCheck?.manualReviewStatus === 'APPROVED' &&
    (!market.oracleCheck.manualReviewExpiresAt || market.oracleCheck.manualReviewExpiresAt > new Date());
  const oracleRiskLevel = market.oracleCheck?.riskLevel ?? 'UNKNOWN';
  const aPlusGate = evaluateAPlusSignalGate({
    candidateScore: candidate?.candidateScore ?? 0,
    adjustedEdge: riskResult.edge,
    confidence: judgeConfidence,
    resolutionClarity: Math.max(0, 1 - judgeUncertainty),
    spread: (snapshot as any)?.spread ?? 0.05,
    liquidity,
    category: market.category,
    modelDisagreement,
    oracleRiskScore,
    tailRiskScore,
    correlationExposure,
    orderbookQuality,
    dataSource: market.dataSource,
    spreadSource: (latestOrderbook?.spreadSource as 'REAL_ORDERBOOK' | 'ESTIMATED') || 'ESTIMATED',
    bestBid: latestOrderbook?.bestBid,
    bestAsk: latestOrderbook?.bestAsk,
    fillProbability: latestOrderbook?.fillProbability,
    priceImpact: latestOrderbook?.priceImpact,
    oracleCheckPresent,
    orderbookAgeSeconds,
  });
  const aPlusGateReasons = [...aPlusGate.reasons];
  if (candidate?.walletSignalScore != null && candidate.walletSignalScore > 0 && !walletTrustContext.hasTrustedEligibleWalletSignal) {
    aPlusGateReasons.push('walletSignal is untrusted or ineligible for A+ execution');
  }
  if (candidate?.oracleRiskPenalty != null && candidate.oracleRiskPenalty >= 8) {
    aPlusGateReasons.push('oracleRiskLevel >= HIGH blocks A+ execution');
  }
  if (oracleRiskLevel === 'HIGH' && !manualReviewApproved) {
    aPlusGateReasons.push('oracle manual review is required and not approved');
  }
  if (oracleRiskLevel === 'BLOCK') {
    aPlusGateReasons.push('oracle risk level BLOCK forces skip');
  }
  const walletTrustPassed =
    (candidate?.walletSignalScore ?? 0) <= 0 || walletTrustContext.hasTrustedEligibleWalletSignal;
  const oracleGatePassed =
    oracleCheckPresent &&
    (
      oracleRiskLevel === 'LOW' ||
      oracleRiskLevel === 'MEDIUM' ||
      (oracleRiskLevel === 'HIGH' && manualReviewApproved)
    );
  const aPlusGatePassed = aPlusGate.passed && walletTrustPassed && oracleGatePassed;
  const liveGovernanceReady =
    !governance.liveEnabled
      ? true
      : governance.killSwitchEnabled &&
        governance.killSwitchLastTestResult === 'PASS' &&
        governance.manualApprovalRequired &&
        governance.maxStakePerMarket > 0 &&
        governance.maxDailyLoss > 0;

  const isLiveOrDemo = tradingConfig.mode === 'LIVE' || tradingConfig.mode === 'DEMO';
  const requiresAPlusForExecution = isLiveOrDemo || governance.liveEnabled;

  const gatedRiskResult =
    oracleRiskLevel === 'BLOCK'
      ? {
          ...riskResult,
          action: 'SKIP' as const,
          reasonCode: 'MANUAL_REVIEW_REQUIRED',
          reason: `Oracle risk level BLOCK forces skip. ${aPlusGateReasons.join('; ')}`,
        }
    :
    riskResult.action === 'BID'
        && (disagreementLevel === 'HIGH' || !liveGovernanceReady || (requiresAPlusForExecution && !aPlusGatePassed))
      ? {
          ...riskResult,
          action: 'WATCH' as const,
          reasonCode: 'MANUAL_REVIEW_REQUIRED',
          reason:
            disagreementLevel === 'HIGH'
              ? `Forced WATCH due to high ensemble disagreement. ${aPlusGateReasons.join('; ')}`
              : !liveGovernanceReady
                ? `Forced WATCH because live governance settings are not fully configured. ${aPlusGateReasons.join('; ')}`
                : `A+ signal gate failed: ${aPlusGateReasons.join('; ')}`,
        }
      : riskResult;

  const decision = await db.decision.create({
    data: {
      marketId,
      candidateId: candidate?.id || null,
      action: gatedRiskResult.action,
      side: gatedRiskResult.side ?? null,
      reasonCode: gatedRiskResult.reasonCode ?? null,
      reason: gatedRiskResult.reason,
      judgeProbability,
      impliedProb,
      edge: gatedRiskResult.edge,
      confidence: judgeConfidence,
      uncertainty: Math.min(1, judgeUncertainty + ensembleUncertaintyBoost),
      maxSize: gatedRiskResult.maxSize,
      urgency: gatedRiskResult.urgency,
      fees: gatedRiskResult.fees,
      slippage: gatedRiskResult.slippage,
      dryRun: isTestMode(),
    },
  });

  if (candidate) {
    const freshnessMinutes = Math.max(0, (Date.now() - new Date(market.lastSeenAt).getTime()) / 60000);
    const catPriority = ['crypto', 'economics'].includes(market.category) ? 3 : ['technology', 'politics'].includes(market.category) ? 2 : 0;
    const vol24h = (snapshot as any)?.volume24h ?? 0;

    // Compute edgeDirection: which side the edge favors.
    // Negative edge on YES means market price > our estimate → edge is on NO.
    // Negative edge on NO means market price > our NO estimate → edge is on YES.
    const edgeDirection: string = (() => {
      const s = gatedRiskResult.side;
      const e = gatedRiskResult.edge;
      if (s === 'YES' && e > 0) return 'YES_EDGE';
      if (s === 'YES' && e < 0) return 'NO_EDGE';
      if (s === 'NO' && e > 0) return 'NO_EDGE';
      if (s === 'NO' && e < 0) return 'YES_EDGE';
      return 'UNKNOWN';
    })();

    const enrichedScore = computeCandidateScore({
      liquidity,
      spread: (snapshot as any)?.spread ?? 0.05,
      volume24h: vol24h,
      freshnessMinutes,
      priceMovePercent: 0,
      categoryPriority: catPriority,
      rawEdge: gatedRiskResult.edge,
      adjustedEdge: gatedRiskResult.edge,
      biasAdjustedProb,
      confidence: judgeConfidence,
    });

    await db.tradeCandidate.update({
      where: { id: candidate.id },
      data: {
        stage: 'DECIDED',
        candidateScore: enrichedScore.totalScore,
        adjustedEdge: gatedRiskResult.edge,
        edgeDirection,
        lastDecisionAt: new Date(),
        nextEligibleAt: computeNextEligibleAt(new Date(), 24),
      },
    });

    const latestHistorical = await db.historicalSnapshot.findFirst({
      where: { marketId },
      orderBy: { snapshotTime: 'desc' },
    });

    if (latestHistorical) {
      await db.historicalSnapshot.update({
        where: { id: latestHistorical.id },
        data: {
          predictedProb: judgeProbability,
          candidateScore: enrichedScore.totalScore,
          walletSignalStrength: candidate.walletSignalScore,
        },
      });
    }
  }

  return {
    decisionId: decision.id,
    riskAction: gatedRiskResult.action,
    gatedRiskResult: gatedRiskResult as RiskStageResult['gatedRiskResult'],
    aPlusGatePassed,
    decision,
    stages,
    candidate,
  };
}

// ── Stage 5: EXECUTE ────────────────────────────────────────────────

export async function runExecuteStage(
  marketId: string,
  decisionId: string,
  gatedRiskResult: RiskStageResult['gatedRiskResult'],
  aPlusGatePassed: boolean,
  judgeProbability: number,
  judgeConfidence: number,
  judgeUncertainty: number,
  options: PipelineRunOptions = {},
): Promise<ExecuteStageResult> {
  const emitStage = async (event: PipelineStageEvent): Promise<void> => {
    await options.onStage?.(event);
  };

  const stages: string[] = [];
  const ctx = await resolvePipelineContext(marketId);
  const { candidate, impliedProb, snapshot, tradingConfig } = ctx;
  const latestSnapshot = snapshot;

  if (shouldCreateWatchlistEntry(gatedRiskResult.action as 'BID' | 'WATCH' | 'SKIP')) {
    await db.watchlist.create({
      data: buildWatchlistPayload({
        marketId,
        decisionId,
        reason: gatedRiskResult.reason,
        targetPrice: gatedRiskResult.side === 'YES' ? impliedProb : 1 - impliedProb,
      }),
    });

    if (candidate) {
      await db.tradeCandidate.update({
        where: { id: candidate.id },
        data: {
          stage: 'WATCHING',
          nextEligibleAt: computeNextEligibleAt(new Date(), 6),
        },
      });
    }
  }

  let orderId: string | null = null;
  let venueOrderId: string | null = null;

  if (shouldCreateExecutionJob(gatedRiskResult.action as 'BID' | 'WATCH' | 'SKIP')) {
    stages.push('EXECUTE');
    const orderSize = resolvePaperExecutionSize({
      adjustedSize: gatedRiskResult.adjustedSize,
      maxSize: gatedRiskResult.maxSize,
      fallbackSize: computePositionSize(gatedRiskResult.edge, judgeConfidence, judgeUncertainty),
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
      const orderPrice = gatedRiskResult.side === 'YES' ? impliedProb : 1 - impliedProb;
      // Guard: never create orders with zero or nonsensical prices
      if (orderPrice <= 0 || orderPrice > 1) {
        await emitStage({
          stage: 'DECISION',
          type: 'skipped' as const,
          message: `Invalid order price ${orderPrice} (impliedProb=${impliedProb}, side=${gatedRiskResult.side})`,
          provider: 'system',
          serviceName: 'paper-execution',
        });
      } else {
      const prefix = 'PAPER';
      const now = new Date();
      venueOrderId = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const mode = getTradingMode();
      const dataSource = getModeState(mode).dataSource;

      const order = await createOrderCompat(
        buildPaperOrderRecord({
          marketId,
          venueOrderId,
          side: gatedRiskResult.side ?? 'YES',
          price: orderPrice,
          size: orderSize,
          now,
          dataSource,
          fillModel: tradingConfig.paperFillModel,
          orderExpiryMinutes: tradingConfig.orderExpiryMinutes,
          executionNotesJson: JSON.stringify({
            mode,
            spread: (latestSnapshot as any)?.spread ?? null,
            spreadSource: (latestSnapshot as any)?.spreadSource ?? null,
          }),
        }) as unknown as Record<string, unknown>,
      );

      // Position is created by order-tracker when order is filled
      // No instant position creation

      await createPaperBet({
        marketId,
        decisionId,
        orderId: order.id,
        predictionType: 'BID',
        setupType: aPlusGatePassed ? 'A_PLUS_BET' : 'STANDARD_BET',
        aPlusStatus: aPlusGatePassed ? 'PASSED' : 'FAILED',
        executionStatus: 'SUBMITTED',
        predictedProb: judgeProbability,
        predictedSide: gatedRiskResult.side ?? 'YES',
        impliedProb,
        edge: gatedRiskResult.edge,
        confidence: judgeConfidence,
        stake: orderSize,
        entryPrice: orderPrice,
      });

      orderId = order.id;

      // Create lifecycle job to track this order
      await db.job.create({
        data: {
          type: 'ORDER_TRACK',
          status: 'PENDING',
          priority: 4,
          payload: JSON.stringify({ marketId }),
        },
      }).catch((e) => { console.error('[Pipeline] Failed to create ORDER_TRACK job:', e); });

      if (candidate) {
        await db.tradeCandidate.update({
          where: { id: candidate.id },
          data: {
            stage: 'EXECUTION_PENDING',
            cooldownUntil: computeNextEligibleAt(new Date(), 24),
            lastExecutionAt: new Date(), // NOTE: EXECUTION_PENDING — not terminal. Will become EXECUTED after fill via order-tracker.
          },
        });
      }
      }
    }
  }

  return { orderId, venueOrderId, stages, candidate };
}

// ── Compatibility Wrapper: runPipelineForMarket ─────────────────────
// Original monolith preserved as a wrapper that calls all stages sequentially.
// All existing callers (worker.ts, live-simulation.ts, scripts, API routes)
// continue to work without changes.

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

  const MAX_RESEARCH_RETRIES = 3;

  try {
    // Stage 1: TRIAGE
    const triageOut = await runTriageStage(marketId, { onStage: emitStage });
    result.triageStatus = triageOut.triageStatus;
    result.stages.push(...triageOut.stages);

    if (!triageOut.worthResearch) {
      result.stages.push('SKIPPED_TRIAGE');
      return result;
    }

    // ── Stage 2-3: RESEARCH + JUDGE (with retry on failure) ──
    let judgeProbability = 0;
    let judgeConfidence = 0;
    let judgeUncertainty = 0;
    let ensembleUncertaintyBoost = 0;
    let modelDisagreement = 0;
    let disagreementLevel: 'LOW' | 'MODERATE' | 'HIGH' = 'LOW';
    let finalResearchContext = '';
    let finalDepth: ResearchDepth = 'STANDARD';

    // ── Retry loop: if debate/research fails, retry up to MAX_RESEARCH_RETRIES times ──
    let judgeSucceeded = false;
    let lastJudgeError: string | null = null;

    for (let attempt = 0; attempt < MAX_RESEARCH_RETRIES; attempt++) {
      try {
        const researchOut = await runResearchStage(marketId, undefined, { onStage: emitStage });
        if (attempt === 0) {
          result.stages.push(...researchOut.stages);
        } else {
          result.stages.push(`RESEARCH_RETRY_${attempt}`);
        }

        const judgeOut = await runJudgeStage(
          marketId, researchOut.researchRunId, researchOut.researchContext,
          researchOut.depth, { onStage: emitStage },
        );
        if (attempt === 0) {
          result.stages.push(...judgeOut.stages);
        } else {
          result.stages.push(`JUDGE_RETRY_${attempt}`);
        }

        judgeProbability = judgeOut.judgeProbability;
        judgeConfidence = judgeOut.judgeConfidence;
        judgeUncertainty = judgeOut.judgeUncertainty;
        ensembleUncertaintyBoost = judgeOut.ensembleUncertaintyBoost;
        modelDisagreement = judgeOut.modelDisagreement;
        disagreementLevel = judgeOut.disagreementLevel;
        finalResearchContext = researchOut.researchContext;
        finalDepth = researchOut.depth;
        result.debateResult = judgeOut.debateResult;
        result.postDebatePrediction = judgeOut.postDebatePrediction;
        result.ensembleResult = judgeOut.ensembleResult as any;
        result.ensembleDisagreement = judgeOut.ensembleDisagreement as any;
        judgeSucceeded = true;
        break;
      } catch (err) {
        lastJudgeError = String(err);
        console.warn(`[Pipeline] Research/Judge attempt ${attempt + 1}/${MAX_RESEARCH_RETRIES} failed for ${marketId}: ${lastJudgeError}`);
        await emitStage({
          stage: 'JUDGE',
          type: 'failed' as const,
          message: `Attempt ${attempt + 1}/${MAX_RESEARCH_RETRIES} failed: ${lastJudgeError}`,
          provider: 'system',
          serviceName: 'debate-arena',
          failureReason: lastJudgeError,
        });
        // Exponential backoff: 2s, 4s, 8s
        if (attempt < MAX_RESEARCH_RETRIES - 1) {
          const delay = Math.min(2000 * Math.pow(2, attempt), 10000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    if (!judgeSucceeded) {
      result.error = `Research/Judge failed after ${MAX_RESEARCH_RETRIES} retries: ${lastJudgeError}`;
      result.stages.push('JUDGE_EXHAUSTED');
      return result;
    }

    // Stage 4: RISK
    const riskOut = await runRiskStage(
      marketId,
      judgeProbability,
      judgeConfidence,
      judgeUncertainty,
      ensembleUncertaintyBoost,
      modelDisagreement,
      disagreementLevel,
      { onStage: emitStage },
    );
    result.stages.push(...riskOut.stages);
    result.riskAction = riskOut.riskAction;

    // Stage 5: EXECUTE
    const executeOut = await runExecuteStage(
      marketId,
      riskOut.decisionId,
      riskOut.gatedRiskResult,
      riskOut.aPlusGatePassed,
      judgeProbability,
      judgeConfidence,
      judgeUncertainty,
      { onStage: emitStage },
    );
    result.stages.push(...executeOut.stages);
    result.orderId = executeOut.venueOrderId;

    // Qdrant writeback (non-fatal)
    try {
      const ctxForWriteback = await resolvePipelineContext(marketId);
      await writeResearchToQdrant(marketId, ctxForWriteback.market.title, finalResearchContext, {
        judgeProbability,
        confidence: judgeConfidence,
        action: riskOut.riskAction ?? undefined,
        side: riskOut.gatedRiskResult.side,
        category: ctxForWriteback.market.category,
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
    } catch (e) { console.error('[Pipeline] Failed to mark orphaned research runs as FAILED:', e); }
    return result;
  }
}
