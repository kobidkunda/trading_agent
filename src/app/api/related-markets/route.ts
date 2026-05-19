import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { scanRelatedMarkets, computeRelatedMarketSignal } from '@/lib/engine/related-market';
import { buildPaginatedResponse, parsePaginationParams } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pagination = parsePaginationParams(searchParams);
    const marketId = searchParams.get('marketId');
    const type = searchParams.get('relationshipType') || searchParams.get('type');
    const hasContradiction = searchParams.get('hasContradiction');
    const search = pagination.search;

    const where: Prisma.RelatedMarketWhereInput = {};

    if (marketId) {
      where.OR = [
        { marketIdA: marketId },
        { marketIdB: marketId },
      ];
    }
    if (type) {
      where.relationshipType = type;
    }
    if (hasContradiction === 'true') {
      where.contradictionScore = { gt: 0 };
    }
    if (search) {
      where.AND = [
        {
          OR: [
            { marketA: { title: { contains: search } } },
            { marketA: { venue: { contains: search } } },
            { marketA: { category: { contains: search } } },
            { marketB: { title: { contains: search } } },
            { marketB: { venue: { contains: search } } },
            { marketB: { category: { contains: search } } },
          ],
        },
      ];
    }

    const sortBy = pagination.sortBy || 'contradictionScore';
    const sortOrder = pagination.sortOrder || 'desc';
    let orderBy: Prisma.RelatedMarketOrderByWithRelationInput;

    if (sortBy === 'detectedAt' || sortBy === 'createdAt') {
      orderBy = { createdAt: sortOrder };
    } else if (sortBy === 'priceInconsistency') {
      orderBy = { priceInconsistency: sortOrder };
    } else if (sortBy === 'relationshipType') {
      orderBy = { relationshipType: sortOrder };
    } else {
      orderBy = { contradictionScore: sortOrder };
    }

    const [pairs, total] = await Promise.all([
      db.relatedMarket.findMany({
        where,
        include: {
          marketA: {
            select: {
              id: true,
              title: true,
              venue: true,
              category: true,
              latestPrice: true,
              normalizedTitle: true,
            },
          },
          marketB: {
            select: {
              id: true,
              title: true,
              venue: true,
              category: true,
              latestPrice: true,
              normalizedTitle: true,
            },
          },
        },
        orderBy,
        take: pagination.limit,
        skip: (pagination.page - 1) * pagination.limit,
      }),
      db.relatedMarket.count({ where }),
    ]);

    return NextResponse.json(buildPaginatedResponse(pairs, total, pagination));
  } catch (error) {
    console.error('Failed to fetch related markets:', error);
    return NextResponse.json({ error: 'Failed to fetch related markets' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const marketId = body.marketId;

    if (!marketId) {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
    }

    const market = await db.market.findUnique({ where: { id: marketId } });
    if (!market) {
      return NextResponse.json({ error: 'Market not found' }, { status: 404 });
    }

    const pairCount = await scanRelatedMarkets(marketId);
    const signal = await computeRelatedMarketSignal(marketId);

    return NextResponse.json({
      success: true,
      marketId,
      marketTitle: market.title,
      pairCount,
      signal,
    });
  } catch (error) {
    console.error('Failed to scan related markets:', error);
    return NextResponse.json({ error: 'Failed to scan related markets' }, { status: 500 });
  }
}
