import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { analyzeOracleRisk } from '@/lib/engine/oracle-mismatch';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const marketId = searchParams.get('marketId');

  if (!marketId) {
    return NextResponse.json({ error: 'marketId required' }, { status: 400 });
  }

  const market = await db.market.findUnique({ where: { id: marketId } });
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  const risk = analyzeOracleRisk(market);
  return NextResponse.json(risk);
}

export async function POST(request: NextRequest) {
  const { marketId } = await request.json();

  if (!marketId) {
    return NextResponse.json({ error: 'marketId required' }, { status: 400 });
  }

  const market = await db.market.findUnique({ where: { id: marketId } });
  if (!market) {
    return NextResponse.json({ error: 'Market not found' }, { status: 404 });
  }

  const risk = analyzeOracleRisk(market);
  
  await db.oracleCheck.upsert({
    where: { marketId },
    update: {
      oracleSource: risk.oracleSource,
      ambiguousWording: risk.hasAmbiguousWording,
      humanDiscretion: risk.hasHumanDiscretion,
      appealProcess: risk.hasAppealProcess,
      riskLevel: risk.riskLevel,
    },
    create: {
      marketId,
      oracleSource: risk.oracleSource,
      ambiguousWording: risk.hasAmbiguousWording,
      humanDiscretion: risk.hasHumanDiscretion,
      appealProcess: risk.hasAppealProcess,
      riskLevel: risk.riskLevel,
    },
  });

  return NextResponse.json(risk);
}
