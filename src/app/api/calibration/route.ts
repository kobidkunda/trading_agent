import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { BrierCalibrationEngine } from '@/lib/engine/brier-calibration';

export async function GET() {
  const bets = await db.decision.findMany({
    where: { outcome: { not: null } },
    select: { predictedProb: true, outcome: true, category: true }
  });

  const formattedBets = bets.map(b => ({
    predictedProb: b.predictedProb || 0,
    actualOutcome: b.outcome || 'NO',
    category: b.category || 'general'
  }));

  const rollingBrier50 = BrierCalibrationEngine.computeRollingBrier(formattedBets, 50);
  const rollingBrier100 = BrierCalibrationEngine.computeRollingBrier(formattedBets, 100);
  const buckets = BrierCalibrationEngine.computeCalibrationBuckets(formattedBets);
  const byCategory = BrierCalibrationEngine.computeByCategory(formattedBets);

  return NextResponse.json({
    rollingBrier50,
    rollingBrier100,
    buckets,
    byCategory
  });
}
