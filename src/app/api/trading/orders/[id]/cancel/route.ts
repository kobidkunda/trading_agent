import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { OrderLifecycle } from '@prisma/client';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const order = await db.order.findUnique({ where: { id } });

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const updated = await db.order.update({
      where: { id },
      data: {
        lifecycleStatus: OrderLifecycle.CANCELLED,
        status: 'CANCELLED',
        cancelledAt: new Date(),
      },
    });

    await db.auditLog.create({
      data: {
        action: 'CANCEL_ORDER',
        entityType: 'Order',
        entityId: id,
        details: `Cancelled trading order ${id}`,
      },
    });

    return NextResponse.json({ order: updated });
  } catch {
    return NextResponse.json({ error: 'Failed to cancel trading order' }, { status: 500 });
  }
}
