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
            lifecycleStatus: { in: [OrderLifecycle.PLANNED, OrderLifecycle.SUBMITTED, OrderLifecycle.PARTIALLY_FILLED, OrderLifecycle.FILLED] },
          }
        : status
          ? { lifecycleStatus: status as OrderLifecycle }
          : undefined;

    const orders = await db.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        market: { select: { id: true, title: true, venue: true, category: true } },
      },
    });

    return NextResponse.json({ orders });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}
