import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { OrderLifecycle } from '@prisma/client';

export async function GET() {
  try {
    let orders = await db.order.findMany({
      where: {
        OR: [
          { lifecycleStatus: { in: [OrderLifecycle.PLANNED, OrderLifecycle.SUBMITTED, OrderLifecycle.PARTIALLY_FILLED] } },
          { status: { in: ['PENDING', 'SUBMITTED', 'PARTIAL'] } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        market: { select: { id: true, title: true, venue: true, category: true } },
      },
    });

    orders = orders.filter((order) => order.status !== 'WATCH' && order.status !== 'FILLED');

    return NextResponse.json({ orders });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch open trading orders' }, { status: 500 });
  }
}
