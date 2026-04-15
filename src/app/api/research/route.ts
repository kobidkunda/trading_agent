import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: Prisma.ResearchRunWhereInput = {};
    if (marketId) where.marketId = marketId;
    if (status) where.status = status;

    const researchRuns = await db.researchRun.findMany({
      where,
      include: {
        market: { select: { id: true, title: true, venue: true, category: true } },
        candidate: { select: { id: true, stage: true, triageStatus: true } },
        sources: { orderBy: { extractedAt: 'desc' } },
        agentOutputs: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const total = await db.researchRun.count({ where });

    return NextResponse.json({ researchRuns, total, limit, offset });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch research runs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.marketId) {
      return NextResponse.json({ error: 'marketId is required' }, { status: 400 });
    }

    const researchRun = await db.researchRun.create({
      data: {
        marketId: body.marketId,
        candidateId: body.candidateId || null,
        status: body.status || 'PENDING',
        depth: body.depth || 'QUICK',
        startedAt: body.status === 'RUNNING' ? new Date() : null,
      },
      include: {
        market: { select: { id: true, title: true, venue: true } },
      },
    });

    await db.auditLog.create({
      data: {
        action: 'CREATE_RESEARCH_RUN',
        entityType: 'ResearchRun',
        entityId: researchRun.id,
        details: `Research run created for market ${body.marketId} with depth ${researchRun.depth}`,
      },
    });

    return NextResponse.json(researchRun, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create research run' }, { status: 500 });
  }
}
