import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma, OrderLifecycle } from '@prisma/client';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pagination = parsePaginationParams(searchParams);
    const status = searchParams.get('status');
    const includeTest = searchParams.get('includeTest') === 'true';

    const where: Prisma.OrderWhereInput = {};

    if (status === 'open') {
      where.lifecycleStatus = { in: [OrderLifecycle.PLANNED, OrderLifecycle.SUBMITTED, OrderLifecycle.PARTIALLY_FILLED] };
      where.NOT = [
        { status: 'WATCH' },
        { status: 'FILLED' },
        { lifecycleStatus: OrderLifecycle.FILLED },
        { lifecycleStatus: OrderLifecycle.CANCELLED },
        { lifecycleStatus: OrderLifecycle.EXPIRED },
      ];
    } else if (status) {
      where.lifecycleStatus = status as OrderLifecycle;
    }

    if (pagination.search) {
      where.market = { title: { contains: pagination.search } };
    }

    if (!includeTest) {
      const marketFilter: Prisma.MarketWhereInput = {
        NOT: {
          OR: [
            { externalId: 'PAPER_TEST_MARKET' },
            { title: 'Test V2: Paper Orders should work in paper mode' },
            { title: 'Paper-loop test market' },
            { venue: 'PAPER', category: 'test' },
          ],
        },
      };

      where.market = where.market
        ? {
            AND: [
              where.market as Prisma.MarketWhereInput,
              marketFilter,
            ],
          }
        : marketFilter;
    }

    const sortField = pagination.sortBy || 'createdAt';
    const [data, total, lifecycleCounts, hiddenTestCount] = await Promise.all([
      db.order.findMany({
        where,
        orderBy: { [sortField]: pagination.sortOrder || 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
        include: {
          market: {
            select: {
              id: true,
              title: true,
              venue: true,
              category: true,
              status: true,
              isResolved: true,
              resolutionTime: true,
            },
          },
        },
      }),
      db.order.count({ where }),
      db.order.groupBy({
        by: ['lifecycleStatus'],
        where,
        _count: { _all: true },
      }),
      includeTest
        ? Promise.resolve(0)
        : db.order.count({
            where: {
              market: {
                OR: [
                  { externalId: 'PAPER_TEST_MARKET' },
                  { title: 'Test V2: Paper Orders should work in paper mode' },
                  { title: 'Paper-loop test market' },
                  { venue: 'PAPER', category: 'test' },
                ],
              },
            },
          }),
    ]);

    const lifecycleStatusCounts = lifecycleCounts.reduce<Record<string, number>>((acc, row) => {
      acc[row.lifecycleStatus] = row._count._all;
      return acc;
    }, {});
    const openCount = [
      OrderLifecycle.PLANNED,
      OrderLifecycle.SUBMITTED,
      OrderLifecycle.PARTIALLY_FILLED,
    ].reduce((sum, status) => sum + (lifecycleStatusCounts[status] ?? 0), 0);

    const payload = buildPaginatedResponse(data, total, pagination);
    return NextResponse.json({
      ...payload,
      orders: data,
      meta: {
        includeTest,
        hiddenTestCount,
        lifecycleStatusCounts,
        openCount,
        filledCount: lifecycleStatusCounts[OrderLifecycle.FILLED] ?? 0,
      },
    });
  } catch (error) {
    console.error('[Orders API] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}
