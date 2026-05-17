import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const configs = await db.strategyConfigVersion.findMany({
    orderBy: { version: 'desc' },
  });
  return NextResponse.json(configs);
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
