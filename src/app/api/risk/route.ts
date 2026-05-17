import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { computeRisk } from '@/lib/engine/risk';
import {
  correlationClusterManager,
  tailRiskAnalyzer,
} from '@/lib/engine/correlation-risk';
import { computeClusterAwareExposure } from '@/lib/engine/risk-exposure';
import type {
  RiskEngineInput,
  RiskDashboard,
  ClusterExposure,
  TailRiskMetrics,
} from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId');

    if (marketId) {
      return preFlightCheck(marketId);
    }

    return dashboard();
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch risk data' },
      { status: 500 },
    );
  }
}

async function dashboard(): Promise<NextResponse> {
  const [
    openPositions,
    tailRiskWarnings,
  ] = await Promise.all([
    db.position.findMany({
      where: { status: 'OPEN' },
      select: { currentSize: true, unrealizedPnl: true },
    }),
    correlationClusterManager.detectTailRisk(),
  ]);

  const dailyExposure = openPositions.reduce(
    (sum, p) => sum + Number(p.currentSize || 0),
    0,
  );
  const totalUnrealizedPnl = openPositions.reduce(
    (sum, p) => sum + Number(p.unrealizedPnl || 0),
    0,
  );

  const clusterExposures = await correlationClusterManager.getDashboard();
  const maxDailyExposure = 50000;
  const riskLimitUtilization = dailyExposure / maxDailyExposure;

  const dashboard: RiskDashboard = {
    totalDailyExposure: dailyExposure,
    maxDailyExposure,
    clusterExposures,
    tailRiskWarnings,
    openPositionCount: openPositions.length,
    totalUnrealizedPnl,
    riskLimitUtilization,
  };

  return NextResponse.json(dashboard);
}

async function preFlightCheck(marketId: string): Promise<NextResponse> {
  const market = await db.market.findUnique({
    where: { id: marketId },
    include: {
      snapshots: { orderBy: { timestamp: 'desc' }, take: 1 },
    },
  });

  if (!market) {
    return NextResponse.json(
      { error: 'Market not found' },
      { status: 404 },
    );
  }

  const snapshot = market.snapshots[0];

  const openPositions = await db.position.findMany({
    where: { status: 'OPEN' },
  });

  const positionsInput = openPositions.map(p => ({
    currentSize: Number(p.currentSize),
    market: { id: p.marketId, category: '' },
  }));

  for (const pi of positionsInput) {
    const pos = openPositions.find(op => op.marketId === pi.market.id);
    if (pos) {
      const mkt = await db.market.findUnique({
        where: { id: pi.market.id },
        select: { category: true },
      });
      pi.market.category = mkt?.category ?? '';
    }
  }

  const clusterData = await computeClusterAwareExposure(
    marketId,
    positionsInput,
    market.category,
  );

  const dailyExposure = positionsInput.reduce(
    (sum, p) => sum + p.currentSize,
    0,
  );
  const categoryExposure = positionsInput
    .filter(p => p.market.category === market.category)
    .reduce((sum, p) => sum + p.currentSize, 0);

  const tailRiskWarnings =
    await correlationClusterManager.detectTailRisk();

  const riskInput: RiskEngineInput = {
    impliedProbability: snapshot?.impliedProb ?? 0.5,
    judgeProbability: 0.5,
    confidence: 0.5,
    uncertainty: 0.2,
    fees: 0.02,
    slippage: 0.01,
    venue: market.venue as RiskEngineInput['venue'],
    category: market.category,
    dailyExposure,
    categoryExposure,
    openPositions: openPositions.length,
    marketLiquidity: snapshot?.liquidity ?? 0,
    marketSpread: snapshot?.spread ?? 0.05,
  };

  const result = computeRisk(riskInput, {
    clusterExposures: clusterData.clusterExposures,
    tailRiskWarnings,
    clusterOverlapCount: clusterData.clusterOverlapCount,
  });

  const clusterLinks = await db.clusterMarketLink.findMany({
    where: { marketId },
    include: {
      cluster: {
        include: { marketLinks: true },
      },
    },
  });

  const linkedClusters: ClusterExposure[] = clusterLinks.map(link => {
    const existing = clusterData.clusterExposures.find(
      ce => ce.clusterId === link.clusterId,
    );
    return (
      existing ?? {
        clusterId: link.cluster.id,
        clusterType: link.cluster.clusterType as ClusterExposure['clusterType'],
        clusterKey: link.cluster.clusterKey,
        label: link.cluster.label,
        totalExposure: 0,
        exposureLimit: Number(link.cluster.exposureLimit ?? 10000),
        maxLoss: link.cluster.maxLoss ? Number(link.cluster.maxLoss) : null,
        lossToWinRatio: link.cluster.lossToWinRatio
          ? Number(link.cluster.lossToWinRatio)
          : null,
        tailRiskLevel: link.cluster.tailRiskLevel,
        utilization: 0,
        marketCount: link.cluster.marketLinks.length,
      }
    );
  });

  const allMetrics: TailRiskMetrics[] = [];
  for (const pos of openPositions) {
    const metrics = tailRiskAnalyzer.analyzePosition(
      pos.marketId,
      pos.side,
      Number(pos.currentSize),
      Number(pos.entryPrice),
    );
    allMetrics.push(metrics);
  }

  return NextResponse.json({
    market: {
      id: market.id,
      title: market.title,
      venue: market.venue,
      category: market.category,
    },
    riskAssessment: {
      action: result.action,
      side: result.side ?? null,
      reasonCode: result.reasonCode ?? null,
      reason: result.reason,
      urgency: result.urgency,
      maxSize: result.maxSize,
      edge: result.edge,
    },
    exposure: {
      dailyExposure,
      categoryExposure,
      clusterExposures: clusterData.clusterExposures,
    },
    clusters: linkedClusters,
    tailRisk: {
      warnings: tailRiskWarnings,
      metrics: allMetrics.slice(0, 20),
    },
  });
}
