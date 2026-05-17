import { db } from '@/lib/db';
import type { ClusterExposure, ClusterType } from '@/lib/types';

const MAX_CLUSTER_EXPOSURE_DEFAULT = 10000;

export interface PositionExposureInput {
  currentSize: number;
  market: {
    id?: string;
    category: string;
  };
}

export function computeExposureTotals(
  positions: PositionExposureInput[],
  marketCategory: string,
) {
  let dailyExposure = 0;
  let categoryExposure = 0;

  for (const position of positions) {
    dailyExposure += Number(position.currentSize || 0);
    if (position.market.category === marketCategory) {
      categoryExposure += Number(position.currentSize || 0);
    }
  }

  return {
    dailyExposure,
    categoryExposure,
  };
}

export interface ClusterExposureTotals {
  dailyExposure: number;
  categoryExposure: number;
  clusterExposures: ClusterExposure[];
  clusterOverlapCount: number;
}

export async function computeClusterAwareExposure(
  marketId: string,
  positions: PositionExposureInput[],
  marketCategory: string,
): Promise<ClusterExposureTotals> {
  const { dailyExposure, categoryExposure } = computeExposureTotals(
    positions,
    marketCategory,
  );

  const links = await db.clusterMarketLink.findMany({
    where: { marketId },
    include: {
      cluster: {
        include: { marketLinks: true },
      },
    },
  });

  const clusterExposures: ClusterExposure[] = [];
  const seenClusterIds = new Set<string>();

  for (const link of links) {
    const c = link.cluster;
    if (seenClusterIds.has(c.id)) continue;
    seenClusterIds.add(c.id);

    const linkedMarketIds = c.marketLinks.map(ml => ml.marketId);
    let clusterTotalExposure = 0;

    for (const pos of positions) {
      if (pos.market.id && linkedMarketIds.includes(pos.market.id)) {
        clusterTotalExposure += Number(pos.currentSize || 0);
      }
    }

    const limit = Number(c.exposureLimit ?? MAX_CLUSTER_EXPOSURE_DEFAULT);
    clusterExposures.push({
      clusterId: c.id,
      clusterType: c.clusterType as ClusterType,
      clusterKey: c.clusterKey,
      label: c.label,
      totalExposure: clusterTotalExposure,
      exposureLimit: limit,
      maxLoss: c.maxLoss ? Number(c.maxLoss) : null,
      lossToWinRatio: c.lossToWinRatio ? Number(c.lossToWinRatio) : null,
      tailRiskLevel: c.tailRiskLevel,
      utilization: clusterTotalExposure / (limit || 1),
      marketCount: c.marketLinks.length,
    });
  }

  return {
    dailyExposure,
    categoryExposure,
    clusterExposures,
    clusterOverlapCount: links.length,
  };
}
