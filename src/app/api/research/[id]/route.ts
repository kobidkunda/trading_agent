import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

type SourceRecord = {
  id: string;
  title: string | null;
  url: string;
  sourceType: string;
  extractedAt: Date;
  qualityScore: number | null;
  recencyScore: number | null;
  provider?: string | null;
};

type AgentOutputRecord = {
  id: string;
  role: string;
  stage: string | null;
  serviceName: string | null;
  provider: string | null;
  modelUsed: string | null;
  summary: string | null;
  output: string;
  rawOutput: string | null;
  failureReason: string | null;
  createdAt: Date;
  referencesJson?: string | null;
};

function safeJsonParse<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function inferProvider(source: SourceRecord): string | null {
  const provider = source.provider?.toUpperCase() ?? '';
  const sourceType = source.sourceType?.toUpperCase() ?? '';
  const url = source.url?.toLowerCase() ?? '';

  if (provider.includes('AGENT_REACH') || sourceType === 'AGENT_REACH' || url.includes('agent-reach') || url.includes('agentreach')) {
    return 'AGENT_REACH';
  }
  if (provider.includes('SEARXNG') || sourceType === 'SEARXNG' || sourceType === 'SEARCH' || sourceType === 'WEB') {
    return 'SEARXNG';
  }
  if (provider.includes('TWITTER') || provider === 'X' || sourceType === 'TWITTER' || sourceType === 'X' || url.includes('x.com') || url.includes('twitter.com')) {
    return 'TWITTER';
  }
  if (provider.includes('REDDIT') || sourceType === 'REDDIT' || url.includes('reddit.com')) {
    return 'REDDIT';
  }
  if (provider.includes('DEERFLOW') || sourceType === 'DEERFLOW' || sourceType === 'CRAWL' || url.includes('deerflow')) {
    return 'DEERFLOW';
  }

  return source.provider ?? null;
}

function extractDerivedSources(outputs: AgentOutputRecord[]): SourceRecord[] {
  const derived: SourceRecord[] = [];

  for (const output of outputs) {
    const createdAt = output.createdAt;

    if (output.role === 'AGENT_REACH') {
      const parsed = safeJsonParse<{ sources?: Array<{ title?: string; url?: string; snippet?: string }> }>(output.output);
      for (const [index, source] of (parsed?.sources ?? []).entries()) {
        if (!source.url) continue;
        derived.push({
          id: `${output.id}-agent-reach-${index}`,
          title: source.title ?? null,
          url: source.url,
          sourceType: 'AGENT_REACH',
          extractedAt: createdAt,
          qualityScore: null,
          recencyScore: null,
          provider: 'AGENT_REACH',
        });
      }
    }

    if (output.role === 'X_ANALYST') {
      const parsed = safeJsonParse<{ tweets?: Array<{ title?: string; url?: string; text?: string }> }>(output.output);
      for (const [index, tweet] of (parsed?.tweets ?? []).entries()) {
        derived.push({
          id: `${output.id}-twitter-${index}`,
          title: tweet.title ?? tweet.text ?? null,
          url: tweet.url ?? 'https://x.com',
          sourceType: 'X',
          extractedAt: createdAt,
          qualityScore: null,
          recencyScore: null,
          provider: 'TWITTER',
        });
      }
    }

    if (output.role === 'REDDIT_ANALYST') {
      const parsed = safeJsonParse<{ posts?: Array<{ title?: string; url?: string; subreddit?: string }> }>(output.output);
      for (const [index, post] of (parsed?.posts ?? []).entries()) {
        derived.push({
          id: `${output.id}-reddit-${index}`,
          title: post.title ?? null,
          url: post.url ?? `https://reddit.com/r/${post.subreddit ?? 'unknown'}`,
          sourceType: 'REDDIT',
          extractedAt: createdAt,
          qualityScore: null,
          recencyScore: null,
          provider: 'REDDIT',
        });
      }
    }

    if ((output.role === 'DEERFLOW' || output.serviceName?.toUpperCase().includes('DEERFLOW')) && output.output) {
      const parsed = safeJsonParse<{
        allSearchResults?: Array<{ title?: string; url?: string }>;
        allExtractedContent?: Array<{ title?: string; url?: string }>;
      }>(output.output);
      for (const [index, source] of (parsed?.allSearchResults ?? []).entries()) {
        if (!source.url) continue;
        derived.push({
          id: `${output.id}-deerflow-search-${index}`,
          title: source.title ?? null,
          url: source.url,
          sourceType: 'DEERFLOW',
          extractedAt: createdAt,
          qualityScore: null,
          recencyScore: null,
          provider: 'DEERFLOW',
        });
      }
      for (const [index, source] of (parsed?.allExtractedContent ?? []).entries()) {
        if (!source.url) continue;
        derived.push({
          id: `${output.id}-deerflow-crawl-${index}`,
          title: source.title ?? null,
          url: source.url,
          sourceType: 'CRAWL',
          extractedAt: createdAt,
          qualityScore: null,
          recencyScore: null,
          provider: 'DEERFLOW',
        });
      }
    }
  }

  return derived;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const researchRun = await db.researchRun.findUnique({
      where: { id },
      include: {
        market: true,
        candidate: true,
        sources: { orderBy: { extractedAt: 'desc' } },
        agentOutputs: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!researchRun) {
      return NextResponse.json({ error: 'Research run not found' }, { status: 404 });
    }

    const [decisions, orders, paperBets, jobs] = await Promise.all([
      db.decision.findMany({
        where: {
          OR: [
            { marketId: researchRun.marketId },
            ...(researchRun.candidateId ? [{ candidateId: researchRun.candidateId }] : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      db.order.findMany({
        where: { marketId: researchRun.marketId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      db.paperBet.findMany({
        where: { marketId: researchRun.marketId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      db.job.findMany({
        where: {
          OR: [
            { payload: { contains: researchRun.marketId } },
            ...(researchRun.candidateId ? [{ payload: { contains: researchRun.candidateId } }] : []),
          ],
        },
        include: {
          researchCheckpoints: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const researchRunsForMarket = await db.researchRun.findMany({
      where: { marketId: researchRun.marketId },
      include: {
        sources: { orderBy: { extractedAt: 'desc' } },
        agentOutputs: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const mergedSources = researchRunsForMarket.flatMap((run) => run.sources as SourceRecord[]);
    const mergedAgentOutputs = researchRunsForMarket.flatMap((run) => run.agentOutputs as AgentOutputRecord[]);
    const derivedSources = extractDerivedSources(mergedAgentOutputs);
    const dedupedSources = [...mergedSources, ...derivedSources]
      .map((source) => ({ ...source, provider: inferProvider(source) }))
      .filter((source, index, all) => all.findIndex((candidate) => candidate.url === source.url && candidate.sourceType === source.sourceType) === index)
      .sort((a, b) => new Date(b.extractedAt).getTime() - new Date(a.extractedAt).getTime());

    return NextResponse.json({
      researchRun,
      market: researchRun.market,
      candidate: researchRun.candidate,
      sources: dedupedSources,
      agentOutputs: researchRun.agentOutputs,
      decisions,
      orders,
      paperBets,
      jobs,
    });
  } catch (error) {
    console.error('[Research Detail API] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch research run detail' }, { status: 500 });
  }
}
