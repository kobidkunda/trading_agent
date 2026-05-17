import type {
  ClusterType,
  ClusterGroup,
  ClusterExposure,
  ClusterAddResult,
  TailRiskMetrics,
  TailRiskWarning,
  TailRiskLevel,
} from '@/lib/types';
import { db } from '@/lib/db';

const MAX_CLUSTER_EXPOSURE_DEFAULT = 10000;
const MAX_LOSS_TO_WIN_RATIO = 5;
const TAIL_RISK_LOSS_THRESHOLD = 2000;

function parseResolutionTime(rt: string | Date | null | undefined): number | null {
  if (!rt) return null;
  const d = typeof rt === 'string' ? new Date(rt) : rt;
  return isNaN(d.getTime()) ? null : d.getTime();
}

function weekBucket(ts: number): string {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.toISOString().slice(0, 10);
}

export class CorrelationClusterManager {
  clusterMarket(
    market: {
      id: string;
      title: string;
      category: string;
      resolutionTime?: string | Date | null;
      venue: string;
    },
    existingClusters?: { clusterType: string; clusterKey: string; id: string }[],
  ): ClusterGroup[] {
    const clusters: ClusterGroup[] = [];
    const seen = new Set<string>();

    const addCluster = (type: ClusterType, key: string, label?: string) => {
      const dedupKey = `${type}:${key}`;
      if (seen.has(dedupKey)) return;
      const existing = existingClusters?.find(
        c => c.clusterType === type && c.clusterKey === key,
      );
      clusters.push({
        clusterType: type,
        clusterKey: key,
        label,
        marketIds: [market.id],
        exposureLimit: existing ? undefined : MAX_CLUSTER_EXPOSURE_DEFAULT,
      });
      seen.add(dedupKey);
    };

    addCluster('CATEGORY', market.category, `Category: ${market.category}`);

    const eventMatch = market.title.match(
      /(20\d{2})\s*(Election|World Cup|Olympics|Super Bowl|Playoffs|Finals|Championship|Referendum)/i,
    );
    if (eventMatch) {
      addCluster('EVENT', eventMatch[0], `Event: ${eventMatch[0]}`);
    }

    const sourceMatch = market.title.match(
      /(Reuters|Bloomberg|AP\b|Associated Press|CDC|FDA|FOMC|Fed\b|BLS|Census)/i,
    );
    if (sourceMatch) {
      addCluster(
        'RESOLUTION_SOURCE',
        sourceMatch[0],
        `Source: ${sourceMatch[0]}`,
      );
    }

    const underlyingMatch = market.title.match(
      /\b(BTC|Bitcoin|ETH|Ethereum|SOL|Solana|S&P|NASDAQ|DOW|Gold|Oil|Crude)\b/i,
    );
    if (underlyingMatch) {
      addCluster(
        'UNDERLYING',
        underlyingMatch[0].toUpperCase(),
        `Underlying: ${underlyingMatch[0].toUpperCase()}`,
      );
    }

    const rt = parseResolutionTime(market.resolutionTime);
    if (rt) {
      const wk = weekBucket(rt);
      addCluster('DATE_WINDOW', wk, `Week of ${wk}`);
    }

    return clusters;
  }

  async getClusterExposure(
    clusterId: string,
  ): Promise<{
    totalExposure: number;
    maxLoss: number;
    lossToWinRatio: number;
  }> {
    const cluster = await db.correlationCluster.findUnique({
      where: { id: clusterId },
      include: { marketLinks: true },
    });
    if (!cluster) return { totalExposure: 0, maxLoss: 0, lossToWinRatio: 0 };

    const marketIds = cluster.marketLinks.map(ml => ml.marketId);
    const positions = await db.position.findMany({
      where: { marketId: { in: marketIds }, status: 'OPEN' },
    });

    let totalExposure = 0;
    let maxLoss = 0;
    let totalMaxGain = 0;

    for (const pos of positions) {
      const size = Number(pos.currentSize || 0);
      totalExposure += size;
      const posMaxLoss = size;
      const posMaxGain =
        pos.side === 'YES'
          ? size * ((1 - Number(pos.entryPrice)) / Number(pos.entryPrice || 0.5))
          : size * (Number(pos.entryPrice) / (1 - Number(pos.entryPrice || 0.5)));

      if (posMaxLoss > maxLoss) maxLoss = posMaxLoss;
      totalMaxGain += isFinite(posMaxGain) ? posMaxGain : size * 0.5;
    }

    const lossToWinRatio =
      totalMaxGain > 0 ? maxLoss / (totalMaxGain / Math.max(positions.length, 1)) : 0;

    await db.correlationCluster.update({
      where: { id: clusterId },
      data: {
        currentExposure: totalExposure,
        maxLoss,
        lossToWinRatio,
      },
    });

    return { totalExposure, maxLoss, lossToWinRatio };
  }

  async canAddToCluster(
    clusterId: string,
    newSize: number,
  ): Promise<ClusterAddResult> {
    const cluster = await db.correlationCluster.findUnique({
      where: { id: clusterId },
    });
    if (!cluster) {
      return {
        allowed: true,
        currentExposure: 0,
        exposureLimit: null,
        proposedExposure: newSize,
        utilizationAfter: 0,
      };
    }

    const { totalExposure } = await this.getClusterExposure(clusterId);
    const proposedExposure = totalExposure + newSize;
    const limit = Number(cluster.exposureLimit ?? MAX_CLUSTER_EXPOSURE_DEFAULT);
    const utilizationAfter = proposedExposure / limit;

    if (proposedExposure > limit) {
      return {
        allowed: false,
        reason: `Cluster "${cluster.clusterKey}" exposure ${proposedExposure.toFixed(0)} would exceed limit ${limit}`,
        currentExposure: totalExposure,
        exposureLimit: limit,
        proposedExposure,
        utilizationAfter,
      };
    }

    return {
      allowed: true,
      currentExposure: totalExposure,
      exposureLimit: limit,
      proposedExposure,
      utilizationAfter,
    };
  }

  async detectTailRisk(): Promise<TailRiskWarning[]> {
    const openPositions = await db.position.findMany({
      where: { status: 'OPEN' },
      include: { market: { select: { id: true, title: true } } },
    });

    if (openPositions.length < 2) return [];

    const analyzer = new TailRiskAnalyzer();
    const warnings: TailRiskWarning[] = [];

    for (const pos of openPositions) {
      const metrics = analyzer.analyzePosition(
        pos.marketId,
        pos.side,
        Number(pos.currentSize),
        Number(pos.entryPrice),
      );

      const otherPositions = openPositions.filter(p => p.id !== pos.id);
      const avgWinOther =
        otherPositions.length > 0
          ? otherPositions.reduce((sum, p) => {
              const m = analyzer.analyzePosition(
                p.marketId,
                p.side,
                Number(p.currentSize),
                Number(p.entryPrice),
              );
              return sum + m.maxGain;
            }, 0) / otherPositions.length
          : 0;

      if (avgWinOther > 0 && metrics.maxLoss > avgWinOther) {
        const winsWiped = Math.floor(metrics.maxLoss / avgWinOther);
        const severity: TailRiskLevel =
          winsWiped >= 5
            ? 'CRITICAL'
            : winsWiped >= 3
              ? 'HIGH'
              : 'MEDIUM';

        warnings.push({
          marketId: pos.marketId,
          marketTitle: pos.market.title,
          lossAmount: metrics.maxLoss,
          winsWiped,
          totalWinningPositions: otherPositions.length,
          warning: `1 loss on "${pos.market.title}" ($${metrics.maxLoss.toFixed(0)}) wipes ${winsWiped} average wins`,
          severity,
        });
      }
    }

    return warnings.sort((a, b) => b.winsWiped - a.winsWiped);
  }

  async getDashboard(): Promise<ClusterExposure[]> {
    const clusters = await db.correlationCluster.findMany({
      include: { marketLinks: { include: { market: { select: { id: true } } } } },
    });

    const results: ClusterExposure[] = [];
    for (const c of clusters) {
      const exp = await this.getClusterExposure(c.id);
      const limit = Number(c.exposureLimit ?? MAX_CLUSTER_EXPOSURE_DEFAULT);
      results.push({
        clusterId: c.id,
        clusterType: c.clusterType as ClusterType,
        clusterKey: c.clusterKey,
        label: c.label,
        totalExposure: exp.totalExposure,
        exposureLimit: limit,
        maxLoss: exp.maxLoss,
        lossToWinRatio: exp.lossToWinRatio,
        tailRiskLevel: c.tailRiskLevel,
        utilization: exp.totalExposure / (limit || 1),
        marketCount: c.marketLinks.length,
      });
    }

    return results.sort((a, b) => b.utilization - a.utilization);
  }

  async findOrCreateCluster(
    clusterType: ClusterType,
    clusterKey: string,
    label?: string,
  ): Promise<string> {
    const existing = await db.correlationCluster.findUnique({
      where: { clusterType_clusterKey: { clusterType, clusterKey } },
    });
    if (existing) return existing.id;

    const created = await db.correlationCluster.create({
      data: {
        clusterType,
        clusterKey,
        label: label ?? `${clusterType}: ${clusterKey}`,
        exposureLimit: MAX_CLUSTER_EXPOSURE_DEFAULT,
      },
    });
    return created.id;
  }

  async linkMarketToCluster(
    clusterId: string,
    marketId: string,
    weight = 1.0,
  ): Promise<void> {
    await db.clusterMarketLink.upsert({
      where: {
        clusterId_marketId: { clusterId, marketId },
      },
      create: { clusterId, marketId, exposureWeight: weight },
      update: { exposureWeight: weight },
    });
  }

  async clusterAndLink(market: {
    id: string;
    title: string;
    category: string;
    resolutionTime?: string | Date | null;
    venue: string;
  }): Promise<number> {
    const clusters = this.clusterMarket(market);
    let linked = 0;
    for (const cg of clusters) {
      const clusterId = await this.findOrCreateCluster(
        cg.clusterType,
        cg.clusterKey,
        cg.label,
      );
      await this.linkMarketToCluster(clusterId, market.id);
      linked++;
    }
    return linked;
  }
}

export class TailRiskAnalyzer {
  analyzePosition(
    marketId: string,
    side: string,
    size: number,
    entryPrice: number,
  ): TailRiskMetrics {
    const price = isNaN(entryPrice) || entryPrice <= 0 ? 0.5 : entryPrice;

    let maxGain: number;
    let maxLoss: number;

    if (side === 'YES') {
      maxGain = size * ((1 - price) / price);
      maxLoss = size;
    } else {
      maxGain = size * (price / (1 - price));
      maxLoss = size;
    }

    if (!isFinite(maxGain)) maxGain = size * 0.5;
    const lossToWinRatio =
      maxGain > 0 ? maxLoss / maxGain : MAX_LOSS_TO_WIN_RATIO;

    const tailRiskLevel: TailRiskLevel =
      lossToWinRatio >= MAX_LOSS_TO_WIN_RATIO
        ? 'CRITICAL'
        : lossToWinRatio >= 3
          ? 'HIGH'
          : lossToWinRatio >= 1.5
            ? 'MEDIUM'
            : 'LOW';

    return {
      marketId,
      side,
      size,
      entryPrice: price,
      maxGain: Math.round(maxGain * 100) / 100,
      maxLoss: Math.round(maxLoss * 100) / 100,
      lossToWinRatio: Math.round(lossToWinRatio * 100) / 100,
      tailRiskLevel,
    };
  }

  findWipeoutRisk(positions: TailRiskMetrics[]): TailRiskWarning[] {
    if (positions.length < 2) return [];

    const warnings: TailRiskWarning[] = [];

    for (const pos of positions) {
      if (pos.maxLoss < TAIL_RISK_LOSS_THRESHOLD) continue;

      const others = positions.filter(p => p.marketId !== pos.marketId);
      const avgWinOther =
        others.reduce((s, p) => s + p.maxGain, 0) / others.length;

      if (avgWinOther <= 0) continue;

      const winsWiped = Math.floor(pos.maxLoss / avgWinOther);
      if (winsWiped < 1) continue;

      const severity: TailRiskLevel =
        winsWiped >= 5 ? 'CRITICAL' : winsWiped >= 3 ? 'HIGH' : 'MEDIUM';

      warnings.push({
        marketId: pos.marketId,
        lossAmount: pos.maxLoss,
        winsWiped,
        totalWinningPositions: others.length,
        warning: `1 loss wipes ${winsWiped} average wins`,
        severity,
      });
    }

    return warnings.sort((a, b) => b.winsWiped - a.winsWiped);
  }
}

export const correlationClusterManager = new CorrelationClusterManager();
export const tailRiskAnalyzer = new TailRiskAnalyzer();
