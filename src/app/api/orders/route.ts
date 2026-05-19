import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma, OrderLifecycle } from '@prisma/client';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pagination = parsePaginationParams(searchParams);
    const status = searchParams.get('status');

    const where: Prisma.OrderWhereInput = {};

    if (status === 'open') {
      where.lifecycleStatus = { in: [OrderLifecycle.PLANNED, OrderLifecycle.SUBMITTED, OrderLifecycle.PARTIALLY_FILLED, OrderLifecycle.FILLED] };
    } else if (status) {
      where.lifecycleStatus = status as OrderLifecycle;
    }

    if (pagination.search) {
      where.market = { title: { contains: pagination.search } };
    }

    const sortField = pagination.sortBy || 'createdAt';
    const [data, total] = await Promise.all([
      db.order.findMany({
        where,
        orderBy: { [sortField]: pagination.sortOrder || 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
        include: {
          market: { select: { id: true, title: true, venue: true, category: true } },
        },
      }),
      db.order.count({ where }),
    ]);

    return NextResponse.json(buildPaginatedResponse(data, total, pagination));
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}
