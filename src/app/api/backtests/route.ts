import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/types';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const pagination = parsePaginationParams(searchParams);
    const id = searchParams.get('id');
    const status = searchParams.get('status');

    if (id) {
      const run = await db.backtestRun.findUnique({
        where: { id },
      });
      if (!run) {
        return NextResponse.json({ error: 'Backtest run not found' }, { status: 404 });
      }
      return NextResponse.json(run);
    }

    const where: Prisma.BacktestRunWhereInput = {};
    if (status) where.status = status;
    if (pagination.search) {
      where.OR = [
        { status: { contains: pagination.search } },
        { mode: { contains: pagination.search } },
        { result: { contains: pagination.search } },
      ];
    }

    const [data, total] = await Promise.all([
      db.backtestRun.findMany({
        where,
        orderBy: { [pagination.sortBy || 'createdAt']: pagination.sortOrder || 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      db.backtestRun.count({ where }),
    ]);

    return NextResponse.json(buildPaginatedResponse(data, total, pagination));
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch backtest runs' }, { status: 500 });
  }
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
