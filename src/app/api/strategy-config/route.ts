import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pagination = parsePaginationParams(searchParams);

    const where: Prisma.StrategyConfigVersionWhereInput = {};
    if (pagination.search) {
      where.OR = [
        { name: { contains: pagination.search } },
        { status: { contains: pagination.search } },
        { notes: { contains: pagination.search } },
      ];
    }

    const [data, total] = await Promise.all([
      db.strategyConfigVersion.findMany({
        where,
        orderBy: { [pagination.sortBy || 'createdAt']: pagination.sortOrder || 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      db.strategyConfigVersion.count({ where }),
    ]);

    return NextResponse.json(buildPaginatedResponse(data, total, pagination));
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch strategy configs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, config } = body;

  const latest = await db.strategyConfigVersion.findFirst({
    orderBy: { version: 'desc' },
  });
  const nextVersion = (latest?.version ?? 0) + 1;

  const newConfig = await db.strategyConfigVersion.create({
    data: {
      version: nextVersion,
      name: name || `Strategy ${nextVersion}`,
      config: JSON.stringify(config),
      status: 'DRAFT',
    },
  });

  return NextResponse.json(newConfig);
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { version, status, notes, aPlusWinRate, aPlusROI, brierScore, drawdown } = body;

  const updatedConfig = await db.strategyConfigVersion.update({
    where: { version: parseInt(version) },
    data: {
      ...(status && { status }),
      ...(notes !== undefined && { notes }),
      ...(aPlusWinRate !== undefined && { aPlusWinRate }),
      ...(aPlusROI !== undefined && { aPlusROI }),
      ...(brierScore !== undefined && { brierScore }),
      ...(drawdown !== undefined && { drawdown }),
    },
  });

  return NextResponse.json(updatedConfig);
}
