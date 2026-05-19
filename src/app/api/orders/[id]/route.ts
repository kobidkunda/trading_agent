import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const order = await db.order.findUnique({
      where: { id },
      include: {
        fills: { orderBy: { fillTime: 'desc' } },
        paperBet: {
          include: {
            decision: {
              include: { strategyConfigVersion: true },
            },
          },
        },
        market: {
          select: {
            id: true,
            title: true,
            venue: true,
            category: true,
            status: true,
            externalId: true,
            description: true,
            latestPrice: true,
            latestSpread: true,
            latestLiquidity: true,
            resolutionTime: true,
            positions: { where: { status: 'OPEN' }, take: 5 },
            decisions: { orderBy: { createdAt: 'desc' }, take: 3 },
            researchRuns: {
              orderBy: { createdAt: 'desc' },
              take: 3,
              include: { agentOutputs: true, sources: true },
            },
          },
        },
        strategyConfigVersion: true,
      },
    });

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const auditLogs = await db.auditLog.findMany({
      where: { entityType: 'Order', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({
      ...order,
      auditLogs,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch order' }, { status: 500 });
  }
}
