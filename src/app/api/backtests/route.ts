import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const status = searchParams.get('status');

  if (id) {
    const run = await db.backtestRun.findUnique({
      where: { id: id },
    });
    return NextResponse.json(run);
  }

  const runs = await db.backtestRun.findMany({
    where: status ? { status: status as any } : {},
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(runs);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { strategyConfigVersion, mode, periodStart, periodEnd } = body;

  const newRun = await db.backtestRun.create({
    data: {
      strategyConfigId: strategyConfigVersion,
      status: 'PENDING',
      mode: mode,
      periodStart: periodStart,
      periodEnd: periodEnd,
    },
  });

  return NextResponse.json(newRun);
}
