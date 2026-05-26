import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { buildStageTransparencyRecord } from '@/lib/engine/research/transparency';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/types';
import type { TransparencyStageRecord } from '@/lib/types';

interface ResearchRunWithRelations {
  id: string;
  marketId: string;
  candidateId: string | null;
  status: string;
  depth: string;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  market: {
    id: string;
    title: string;
    venue: string;
    category: string;
  };
  candidate: {
    id: string;
    stage: string;
    triageStatus: string | null;
  } | null;
  sources: Array<{
    id: string;
    url: string;
    title: string | null;
    content: string | null;
    sourceType: string;
    recencyScore: number | null;
    qualityScore: number | null;
    extractedAt: Date;
  }>;
  agentOutputs: Array<{
    id: string;
    role: string;
    stage: string | null;
    serviceName: string | null;
    provider: string | null;
    modelUsed: string | null;
    output: string;
    rawOutput: string | null;
    summary: string | null;
    referencesJson: string | null;
    failureReason: string | null;
    startedAt: Date | null;
    endedAt: Date | null;
    createdAt: Date;
  }>;
}

interface MappedResearchRun {
  id: string;
  marketId: string;
  candidateId: string | null;
  status: string;
  depth: string;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  market: {
    id: string;
    title: string;
    venue: string;
    category: string;
  };
  candidate: {
    id: string;
    stage: string;
    triageStatus: string | null;
  } | null;
  sources: Array<{
    id: string;
    url: string;
    title: string | null;
    content: string | null;
    sourceType: string;
    recencyScore: number | null;
    qualityScore: number | null;
    extractedAt: Date;
    domain: string | null;
  }>;
  agentOutputs: ResearchRunWithRelations['agentOutputs'];
  totalSourceCount: number;
  matchedSourceCount: number;
  agentOutputCount: number;
  transparencyStages: TransparencyStageRecord[];
  sourceProvenance: Array<{
    url: string;
    title: string | null;
    domain: string | null;
    sourceType: string;
    qualityScore: number | null;
    recencyScore: number | null;
    extractedAt: Date;
    relevanceMatched: boolean;
  }>;
}

/**
 * Build transparency stages from agent outputs
 */
function buildTransparencyStagesFromOutputs(
  agentOutputs: ResearchRunWithRelations['agentOutputs'],
): TransparencyStageRecord[] {
  return agentOutputs.map((output) => {
    let references: Array<{
      title?: string;
      url?: string;
      snippet?: string;
      provider?: string;
    }> = [];
    if (output.referencesJson) {
      try {
        references = JSON.parse(output.referencesJson) as Array<{
          title?: string;
          url?: string;
          snippet?: string;
          provider?: string;
        }>;
      } catch {
        console.warn(`[Research API] Failed to parse referencesJson for output ${output.id}`);
        references = [];
      }
    }

    return buildStageTransparencyRecord({
      stage: output.stage ?? output.role,
      serviceName: output.serviceName ?? output.role,
      provider: output.provider,
      model: output.modelUsed,
      startedAt: output.startedAt?.toISOString() ?? null,
      endedAt: output.endedAt?.toISOString() ?? null,
      status: output.failureReason ? 'failed' : 'completed',
      failureReason: output.failureReason,
      summary: output.summary,
      rawOutput: output.rawOutput ?? output.output,
      references: references.map((ref) => ({
        title: ref.title ?? ref.url ?? 'Untitled',
        url: ref.url ?? '',
        snippet: ref.snippet ?? null,
        provider: ref.provider ?? null,
      })),
    });
  });
}

/**
 * Extract domain from URL
 */
function getDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

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

function filterSourcesForMarket(run: ResearchRunWithRelations) {
  return run.sources.filter((source) =>
    sourceMatchesMarket(
      run.market.title,
      [source.title, source.content, source.url].filter(Boolean).join(' '),
    ),
  );
}

/**
 * Map research runs to include transparency and provenance data
 */
function mapResearchRun(run: ResearchRunWithRelations): MappedResearchRun {
  const relevantSources = filterSourcesForMarket(run);
  const relevantSourceIds = new Set(relevantSources.map((source) => source.id));
  const sourcesWithDomain = relevantSources.map((source) => ({
    ...source,
    domain: getDomain(source.url),
    relevanceMatched: relevantSourceIds.has(source.id),
  }));

  const sourceProvenance = run.sources.map((source) => ({
    url: source.url,
    title: source.title,
    domain: getDomain(source.url),
    sourceType: source.sourceType,
    qualityScore: source.qualityScore,
    recencyScore: source.recencyScore,
    extractedAt: source.extractedAt,
    relevanceMatched: relevantSourceIds.has(source.id),
  }));

  const transparencyStages = buildTransparencyStagesFromOutputs(run.agentOutputs);

  return {
    ...run,
    sources: sourcesWithDomain,
    totalSourceCount: run.sources.length,
    matchedSourceCount: sourcesWithDomain.length,
    agentOutputCount: run.agentOutputs.length,
    transparencyStages,
    sourceProvenance,
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId');
    const status = searchParams.get('status');
    const view = searchParams.get('view');
    const pagination = parsePaginationParams(searchParams);
    const allowedSortFields = new Set(['createdAt', 'startedAt', 'completedAt', 'status', 'depth']);
    const sortBy = allowedSortFields.has(pagination.sortBy ?? '') ? pagination.sortBy ?? 'createdAt' : 'createdAt';
    const sortOrder = pagination.sortOrder ?? 'desc';

    const where: Prisma.ResearchRunWhereInput = {};
    if (marketId) where.marketId = marketId;
    if (status) where.status = status;
    if (pagination.search) {
      where.market = { title: { contains: pagination.search } };
    }

    const orderBy: Prisma.ResearchRunOrderByWithRelationInput[] = [{ [sortBy]: sortOrder }];

    if (view === 'queue') {
      const [researchRuns, total] = await Promise.all([
        db.researchRun.findMany({
          where,
          select: {
            id: true,
            marketId: true,
            candidateId: true,
            status: true,
            depth: true,
            startedAt: true,
            completedAt: true,
            createdAt: true,
            updatedAt: true,
            market: { select: { id: true, title: true, venue: true, category: true } },
            candidate: { select: { id: true, stage: true, triageStatus: true } },
            _count: { select: { sources: true, agentOutputs: true } },
          },
          orderBy,
          skip: (pagination.page - 1) * pagination.limit,
          take: pagination.limit,
        }),
        db.researchRun.count({ where }),
      ]);

      const queueRows = researchRuns.map((run) => ({
        ...run,
        totalSourceCount: run._count.sources,
        agentOutputCount: run._count.agentOutputs,
        _count: undefined,
      }));

      const payload = buildPaginatedResponse(queueRows, total, pagination);
      return NextResponse.json({
        ...payload,
        researchRuns: payload.data,
      });
    }

    const [researchRuns, total] = await Promise.all([
      db.researchRun.findMany({
        where,
        include: {
          market: { select: { id: true, title: true, venue: true, category: true } },
          candidate: { select: { id: true, stage: true, triageStatus: true } },
          sources: { orderBy: { extractedAt: 'desc' } },
          agentOutputs: { orderBy: { createdAt: 'asc' } },
        },
        orderBy,
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      db.researchRun.count({ where }),
    ]);

    // Map runs to include transparency stages and source provenance
    const mappedRuns = (researchRuns as unknown as ResearchRunWithRelations[]).map(mapResearchRun);

    const payload = buildPaginatedResponse(mappedRuns, total, pagination);
    return NextResponse.json({
      ...payload,
      researchRuns: payload.data,
    });
  } catch (error) {
    console.error('[Research API] GET error:', {
      error,
      query: Object.fromEntries(new URL(request.url).searchParams.entries()),
      sortBy: new URL(request.url).searchParams.get('sortBy'),
    });
    return NextResponse.json({ error: 'Failed to fetch research runs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.marketId) {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
    }

    const researchRun = await db.researchRun.create({
      data: {
        marketId: body.marketId,
        candidateId: body.candidateId || null,
        status: body.status || 'PENDING',
        depth: body.depth || 'QUICK',
        startedAt: body.status === 'RUNNING' ? new Date() : null,
      },
      include: {
        market: { select: { id: true, title: true, venue: true } },
      },
    });

    await db.auditLog.create({
      data: {
        action: 'CREATE_RESEARCH_RUN',
        entityType: 'ResearchRun',
        entityId: researchRun.id,
        details: `Research run created for market ${body.marketId} with depth ${researchRun.depth}`,
      },
    });

    return NextResponse.json(researchRun, { status: 201 });
  } catch (error) {
    console.error('[Research API] POST error:', error);
    return NextResponse.json({ error: 'Failed to create research run' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === 'fix_stuck') {
      const result = await db.researchRun.updateMany({
        where: { status: 'RUNNING' },
        data: { status: 'FAILED', completedAt: new Date() },
      });
      return NextResponse.json({ fixed: result.count });
    }

    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const updateData: Prisma.ResearchRunUpdateInput = {};
    if (body.status) updateData.status = body.status;
    if (body.status === 'COMPLETED' || body.status === 'FAILED') {
      updateData.completedAt = new Date();
    }

    const researchRun = await db.researchRun.update({
      where: { id: body.id },
      data: updateData,
    });

    return NextResponse.json(researchRun);
  } catch (error) {
    console.error('[Research API] PUT error:', error);
    return NextResponse.json({ error: 'Failed to update research run' }, { status: 500 });
  }
}
