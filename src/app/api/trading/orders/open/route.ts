import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { OrderLifecycle } from '@prisma/client';

const OPEN_ORDER_LIFECYCLES = [
  OrderLifecycle.PLANNED,
  OrderLifecycle.SUBMITTED,
  OrderLifecycle.PARTIALLY_FILLED,
] as const;

export async function GET() {
  try {
    const orders = await db.order.findMany({
      where: {
        lifecycleStatus: { in: [...OPEN_ORDER_LIFECYCLES] },
        NOT: [
          { status: 'WATCH' },
          { status: 'FILLED' },
          { lifecycleStatus: OrderLifecycle.FILLED },
          { lifecycleStatus: OrderLifecycle.CANCELLED },
          { lifecycleStatus: OrderLifecycle.EXPIRED },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        market: { select: { id: true, title: true, venue: true, category: true } },
      },
    });

    const visibleOrders = orders.filter((order) => {
      if (order.status === 'WATCH' || order.status === 'FILLED') {
        return false;
      }

      return OPEN_ORDER_LIFECYCLES.includes(order.lifecycleStatus as (typeof OPEN_ORDER_LIFECYCLES)[number]);
    });

    return NextResponse.json({ orders: visibleOrders });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch open trading orders' }, { status: 500 });
  }
}
