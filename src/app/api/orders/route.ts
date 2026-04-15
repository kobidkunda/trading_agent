import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '20', 10), 1), 100);

    const orders = await db.order.findMany({
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
