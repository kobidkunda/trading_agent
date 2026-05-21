import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const candidate = await db.tradeCandidate.findUnique({
      where: { id },
      include: {
        market: {
          include: {
            snapshots: { orderBy: { timestamp: 'desc' }, take: 20 },
            orderbookSnapshots: { orderBy: { capturedAt: 'desc' }, take: 10 },
            decisions: { orderBy: { createdAt: 'desc' }, take: 10 },
            orders: { orderBy: { createdAt: 'desc' }, take: 10 },
            paperBets: { orderBy: { createdAt: 'desc' }, take: 10 },
            outcomes: { orderBy: { resolvedAt: 'desc' }, take: 10 },
            oracleCheck: true,
          },
        },
        researchRuns: {
          orderBy: { createdAt: 'desc' },
          include: {
            sources: { orderBy: { extractedAt: 'desc' } },
            agentOutputs: { orderBy: { createdAt: 'asc' } },
          },
        },
        decisions: { orderBy: { createdAt: 'desc' }, take: 10 },
      },
    });

    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
    }

    const jobs = await db.job.findMany({
      where: {
        OR: [
          { payload: { contains: candidate.marketId } },
          { payload: { contains: candidate.id } },
        ],
      },
      include: {
        researchCheckpoints: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return NextResponse.json({
      candidate,
      market: candidate.market,
      snapshots: candidate.market.snapshots,
      orderbookSnapshots: candidate.market.orderbookSnapshots,
      researchRuns: candidate.researchRuns,
      decisions: candidate.decisions,
      marketDecisions: candidate.market.decisions,
      orders: candidate.market.orders,
      paperBets: candidate.market.paperBets,
      outcomes: candidate.market.outcomes,
      oracleCheck: candidate.market.oracleCheck,
      jobs,
    });
  } catch (error) {
    console.error('[Candidate Detail API] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch candidate detail' }, { status: 500 });
  }
}
