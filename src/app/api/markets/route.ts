import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const venue = searchParams.get('venue');
    const status = searchParams.get('status');
    const category = searchParams.get('category');
    const search = searchParams.get('search');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: Prisma.MarketWhereInput = {};
    if (venue) where.venue = venue;
    if (status) where.status = status;
    if (category) where.category = category;
    if (search) where.title = { contains: search };

    const markets = await db.market.findMany({
      where,
      include: {
        snapshots: { orderBy: { timestamp: 'desc' }, take: 1 },
        tradeCandidates: { orderBy: { updatedAt: 'desc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const total = await db.market.count({ where });

    return NextResponse.json({ markets, total, limit, offset });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch markets' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const market = await db.market.create({
      data: {
        externalId: body.externalId,
        venue: body.venue,
        title: body.title,
        description: body.description || '',
        category: body.category || 'other',
        status: body.status || 'ACTIVE',
        resolutionTime: body.resolutionTime ? new Date(body.resolutionTime) : null,
      },
    });
    return NextResponse.json(market, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create market' }, { status: 500 });
  }
}
