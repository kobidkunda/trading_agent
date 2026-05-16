import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma, OrderLifecycle } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '20', 10), 1), 100);
    const status = searchParams.get('status');

    const where: Prisma.OrderWhereInput | undefined =
      status === 'open'
        ? {
            OR: [
              { lifecycleStatus: { in: [OrderLifecycle.PLANNED, OrderLifecycle.SUBMITTED, OrderLifecycle.PARTIALLY_FILLED] } },
              { status: { in: ['PENDING', 'SUBMITTED', 'PARTIAL'] } },
            ],
          }
        : undefined;

    let orders = await db.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        market: { select: { id: true, title: true, venue: true, category: true } },
      },
    });

    if (status === 'open') {
      orders = orders.filter((order) => order.status !== 'WATCH');
    }

    return NextResponse.json({ orders });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}
