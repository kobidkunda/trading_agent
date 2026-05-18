import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { OrderLifecycle } from '@prisma/client';

export async function GET() {
  try {
    const orders = await db.order.findMany({
      where: {
        lifecycleStatus: { in: [OrderLifecycle.PLANNED, OrderLifecycle.SUBMITTED, OrderLifecycle.PARTIALLY_FILLED] },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        market: { select: { id: true, title: true, venue: true, category: true } },
      },
    });

    return NextResponse.json({ orders });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch open trading orders' }, { status: 500 });
  }
}
