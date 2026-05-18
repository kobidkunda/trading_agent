import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  computeWeightedEnsemble,
  detectDisagreement,
  resolveEnsembleWeights,
  collectPredictionsFromAgentOutputs,
  storePredictions,
  type ModelPrediction,
} from '@/lib/engine/ensemble-probability';

async function getEnsembleForMarket(marketId: string) {
  const rows = await db.ensemblePrediction.findMany({
    where: { marketId },
    orderBy: { createdAt: 'desc' },
  });

  if (rows.length === 0) return null;

  const predictions: ModelPrediction[] = rows.map((r) => ({
    source: r.source,
    predictedProb: r.predictedProb,
    confidence: r.confidence ?? 0.5,
    weight: r.weight,
    category: r.category,
  }));

  const result = computeWeightedEnsemble(predictions);
  const disagreement = detectDisagreement(predictions);

  return {
    ...result,
    disagreement,
    sources: rows.map((r) => ({
      source: r.source,
      predictedProb: r.predictedProb,
      confidence: r.confidence,
      weight: r.weight,
      brierScore: r.brierScore,
      category: r.category,
    })),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId');

    if (!marketId) {
      return NextResponse.json({ error: 'marketId query parameter is required' }, { status: 400 });
    }

    const ensemble = await getEnsembleForMarket(marketId);

    if (!ensemble) {
      return NextResponse.json({ error: 'No ensemble predictions found for this market' }, { status: 404 });
    }

    return NextResponse.json(ensemble);
  } catch (error) {
    console.error('[Ensemble API GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ensemble result' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === 'resolve') {
      if (!body.marketId || (body.actualOutcome !== 0 && body.actualOutcome !== 1)) {
        return NextResponse.json(
          { error: 'resolve requires marketId (string) and actualOutcome (0 or 1)' },
          { status: 400 },
        );
      }

      await resolveEnsembleWeights(body.marketId, body.actualOutcome as 0 | 1);

      return NextResponse.json({
        success: true,
        message: `Model weights recalculated for market ${body.marketId}`,
      });
    }

    if (body.action === 'recompute') {
      if (!body.marketId) {
        return NextResponse.json({ error: 'recompute requires marketId' }, { status: 400 });
      }

      const market = await db.market.findUnique({
        where: { id: body.marketId },
        select: { category: true },
      });
      const marketCategory = market?.category ?? 'general';

      const researchRuns = await db.researchRun.findMany({
        where: { marketId: body.marketId },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      if (researchRuns.length === 0) {
        return NextResponse.json(
          { error: 'No research runs found for this market' },
          { status: 404 },
        );
      }

      const predictions = await collectPredictionsFromAgentOutputs(researchRuns[0].id, marketCategory);

      if (predictions.length === 0) {
        return NextResponse.json(
          { error: 'No agent outputs with probability data found' },
          { status: 404 },
        );
      }

      const candidate = await db.tradeCandidate.findFirst({
        where: { marketId: body.marketId },
      });

      const result = computeWeightedEnsemble(predictions);
      const disagreement = detectDisagreement(predictions);

      await storePredictions(body.marketId, candidate?.id ?? null, predictions);

      return NextResponse.json({ ...result, disagreement });
    }

    return NextResponse.json(
      { error: 'Invalid action. Supported: resolve, recompute' },
      { status: 400 },
    );
  } catch (error) {
    console.error('[Ensemble API POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process ensemble request' },
      { status: 500 },
    );
  }
}
