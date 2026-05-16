import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const candidate = await db.tradeCandidate.findUnique({ where: { id } });

    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
    }

    const job = await db.job.create({
      data: {
        type: 'RESEARCH_MARKET',
        status: 'PENDING',
        priority: 10,
        payload: JSON.stringify({ marketId: candidate.marketId, candidateId: candidate.id, trigger: 'force_research' }),
      },
    });

    await db.auditLog.create({
      data: {
        action: 'FORCE_RESEARCH_CANDIDATE',
        entityType: 'TradeCandidate',
        entityId: candidate.id,
        details: `Queued force research job ${job.id}`,
      },
    });

    return NextResponse.json({ job });
  } catch {
    return NextResponse.json({ error: 'Failed to queue force research job' }, { status: 500 });
  }
}
