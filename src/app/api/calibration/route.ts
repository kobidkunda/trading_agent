import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { BrierCalibrationEngine } from '@/lib/engine/brier-calibration';

export async function GET() {
  const bets = await db.paperBet.findMany({
    where: { actualOutcome: { not: null } },
    select: {
      predictedProb: true,
      actualOutcome: true,
      market: {
        select: {
          category: true,
        },
      },
    }
  });

  const formattedBets = bets.map(b => ({
    predictedProb: b.predictedProb || 0,
    actualOutcome: b.actualOutcome || 'NO',
    category: b.market.category || 'general'
  }));

  const rollingBrier50 = BrierCalibrationEngine.computeRollingBrier(formattedBets, 50);
  const rollingBrier100 = BrierCalibrationEngine.computeRollingBrier(formattedBets, 100);
  const bucketResult = BrierCalibrationEngine.computeCalibrationBuckets(formattedBets);
  const categoryResult = BrierCalibrationEngine.computeByCategory(formattedBets);
  const sampleSufficiency = BrierCalibrationEngine.computeSampleSufficiency(formattedBets);

  return NextResponse.json({
    rollingBrier50,
    rollingBrier100,
    buckets: bucketResult.buckets,
    bucketsSufficient: bucketResult.sufficient,
    bucketsReason: bucketResult.reason,
    byCategory: categoryResult.categories,
    byCategorySufficient: categoryResult.sufficient,
    byCategoryReason: categoryResult.reason,
    sampleSufficiency,
  });
}
