import { db } from '@/lib/db';
import type { WalletTrade, Wallet } from '@prisma/client';
import { analyzeOracleRisk } from '@/lib/engine/oracle-mismatch';
import { correlationClusterManager } from '@/lib/engine/correlation-risk';

export interface ClusterAlert {
  marketId: string;
  walletIds: string[];
  side: string;
  combinedSize: number;
  signalStrength: number;
  lifecycle: 'DETECTED' | 'REJECTED' | 'APPROVED';
  rejectionReason?: string | null;
}

interface ClusterGroup {
  marketId: string;
  side: string;
  trades: (WalletTrade & { wallet: Wallet })[];
}

const CLUSTER_WINDOW_MINUTES = 10;
const MIN_CLUSTER_WALLETS = 3;

export class WalletClusterSignalDetector {
  async detectClusters(): Promise<ClusterAlert[]> {
    const cutoff = new Date(Date.now() - CLUSTER_WINDOW_MINUTES * 60_000);

    const recentTrades = await db.walletTrade.findMany({
      where: {
        tradeTimestamp: { gte: cutoff },
        wallet: { rank: { not: null }, isActive: true },
        marketId: { not: null },
      },
      include: { wallet: true },
      orderBy: { tradeTimestamp: 'desc' },
    });

    if (recentTrades.length === 0) return [];

    const groups = this.groupTrades(recentTrades);

    const eligibleGroups = groups.filter((g) => {
      const uniqueWallets = new Set(g.trades.map((t) => t.walletId));
      return uniqueWallets.size >= MIN_CLUSTER_WALLETS;
    });

    const alerts = await Promise.all(
      eligibleGroups.map((g) => this.buildClusterAlert(g))
    );

    return alerts
      .filter((alert): alert is ClusterAlert => alert !== null)
      .sort((a, b) => b.signalStrength - a.signalStrength);
  }

  async computeClusterSignal(marketId: string): Promise<number> {
    const clusters = await this.detectClusters();
    const relevant = clusters.filter((c) => c.marketId === marketId);

    if (relevant.length === 0) return 0;

    return Math.max(...relevant.map((c) => c.signalStrength));
  }

  private groupTrades(
    trades: (WalletTrade & { wallet: Wallet })[]
  ): ClusterGroup[] {
    const map = new Map<string, ClusterGroup>();

    for (const trade of trades) {
      const key = `${trade.marketId}:${trade.side}`;
      if (!map.has(key)) {
        map.set(key, { marketId: trade.marketId!, side: trade.side, trades: [] });
      }
      map.get(key)!.trades.push(trade);
    }

    return Array.from(map.values());
  }

  private async buildClusterAlert(group: ClusterGroup): Promise<ClusterAlert | null> {
    const walletIds = [...new Set(group.trades.map((t) => t.walletId))];
    const combinedSize = group.trades.reduce((sum, t) => sum + t.quantity, 0);
    const market = await db.market.findUnique({
      where: { id: group.marketId },
      include: {
        snapshots: { orderBy: { capturedAt: 'desc' }, take: 1 },
        orderbookSnapshots: { orderBy: { capturedAt: 'desc' }, take: 1 },
      },
    });

    if (!market) return null;

    const snapshot = market.snapshots[0];
    const orderbook = market.orderbookSnapshots[0];
    if ((snapshot?.liquidity ?? 0) < 10000) return null;
    if ((snapshot?.spread ?? 1) > 0.05) return null;
    if ((orderbook?.bidDepth ?? 0) + (orderbook?.askDepth ?? 0) < combinedSize) return null;
    if (orderbook?.thinBookDanger) return null;
    if ((orderbook?.recentMovement ?? 0) > 0.08) return null;

    const conflictingSideTrades = await db.walletTrade.count({
      where: {
        marketId: group.marketId,
        side: { not: group.side },
        tradeTimestamp: { gte: new Date(Date.now() - CLUSTER_WINDOW_MINUTES * 60_000) },
      },
    });
    if (conflictingSideTrades > 0) return null;

    const oracleRisk = analyzeOracleRisk({
      title: market.title,
      description: market.description ?? '',
      crossVenueMismatch: 0,
    });
    if (oracleRisk.riskLevel === 'HIGH' || oracleRisk.riskLevel === 'BLOCK') return null;

    const clusterLinks = await db.clusterMarketLink.findMany({
      where: { marketId: group.marketId },
      select: { clusterId: true },
    });
    for (const link of clusterLinks) {
      const canAdd = await correlationClusterManager.canAddToCluster(link.clusterId, combinedSize);
      if (!canAdd.allowed || canAdd.utilizationAfter > 0.8) {
        return null;
      }
    }

    const walletCount = walletIds.length;
    const countScore = walletCount >= 6 ? 12
      : walletCount >= 5 ? 9
      : walletCount >= 4 ? 6
      : 3;

    const sizeScore = Math.min(8, Math.log2(combinedSize + 1) * 2);
    const sideCount = group.trades.filter(
      (t) => t.side === group.side
    ).length;

    const signalStrength = Math.min(20, Math.round(countScore + sizeScore));

    return {
      marketId: group.marketId,
      walletIds,
      side: group.side,
      combinedSize: Math.round(combinedSize * 100) / 100,
      signalStrength,
      lifecycle: 'DETECTED',
      rejectionReason: null,
    };
  }
}

export const walletClusterDetector = new WalletClusterSignalDetector();
