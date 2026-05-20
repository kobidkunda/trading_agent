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
            lastSnapshotAt: true,
            lastResearchAt: true,
            snapshots: { orderBy: { capturedAt: 'desc' }, take: 12 },
            orderbookSnapshots: { orderBy: { capturedAt: 'desc' }, take: 12 },
            tradeCandidates: {
              orderBy: { updatedAt: 'desc' },
              take: 3,
              include: {
                sourceScanRun: true,
              },
            },
            candidateRuns: { orderBy: { createdAt: 'desc' }, take: 5 },
            positions: { where: { status: 'OPEN' }, take: 5 },
            outcomes: { orderBy: { resolvedAt: 'desc' }, take: 3 },
            postmortems: { orderBy: { createdAt: 'desc' }, take: 3 },
            oracleCheck: true,
            ensemblePredictions: { orderBy: { createdAt: 'desc' }, take: 12 },
            walletClusterSignals: { orderBy: { detectedAt: 'desc' }, take: 5 },
            clusterMarketLinks: {
              include: { cluster: true },
              take: 8,
            },
            relatedAsA: {
              include: {
                marketB: { select: { id: true, title: true, venue: true, latestPrice: true, status: true } },
              },
              take: 8,
            },
            relatedAsB: {
              include: {
                marketA: { select: { id: true, title: true, venue: true, latestPrice: true, status: true } },
              },
              take: 8,
            },
            decisions: { orderBy: { createdAt: 'desc' }, take: 3 },
            researchRuns: {
              orderBy: { createdAt: 'desc' },
              take: 5,
              include: {
                agentOutputs: true,
                sources: true,
                causalTreeNodes: {
                  orderBy: { importanceWeight: 'desc' },
                  take: 20,
                },
              },
            },
          },
        },
        strategyConfigVersion: true,
      },
    });

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    const marketId = order.marketId;
    const relatedEntityIds = [
      id,
      marketId,
      order.paperBet?.id,
      order.paperBet?.decisionId,
      order.paperBet?.decision?.candidateId,
    ].filter((value): value is string => Boolean(value));

    const [auditLogs, jobs] = await Promise.all([
      db.auditLog.findMany({
        where: {
          OR: [
            { entityType: 'Order', entityId: id },
            { entityId: { in: relatedEntityIds } },
            { details: { contains: id } },
            { details: { contains: marketId } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      db.job.findMany({
        where: {
          OR: [
            { payload: { contains: marketId } },
            { payload: { contains: id } },
            { result: { contains: marketId } },
            { result: { contains: id } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    return NextResponse.json({
      ...order,
      auditLogs,
      jobs,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch order' }, { status: 500 });
  }
}
