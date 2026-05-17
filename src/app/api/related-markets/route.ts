import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { scanRelatedMarkets, computeRelatedMarketSignal } from '@/lib/engine/related-market';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId');
    const type = searchParams.get('type');
    const hasContradiction = searchParams.get('hasContradiction');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

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
        orderBy: { contradictionScore: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.relatedMarket.count({ where }),
    ]);

    return NextResponse.json({ pairs, total, limit, offset });
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
