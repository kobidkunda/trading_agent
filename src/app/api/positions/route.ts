import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: Prisma.PositionWhereInput = {};
    if (status) where.status = status;

    const [positions, total] = await Promise.all([
      db.position.findMany({
        where,
        include: {
          market: { select: { id: true, title: true, venue: true } },
        },
        orderBy: { openedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.position.count({ where }),
    ]);

    return NextResponse.json({ positions, total, limit, offset });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch positions' }, { status: 500 });
  }
}
