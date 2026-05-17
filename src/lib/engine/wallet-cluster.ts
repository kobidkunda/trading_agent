import { db } from '@/lib/db';
import type { WalletTrade, Wallet } from '@prisma/client';

export interface ClusterAlert {
  marketId: string;
  walletIds: string[];
  side: string;
  combinedSize: number;
  signalStrength: number;
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

    return groups
      .filter((g) => {
        const uniqueWallets = new Set(g.trades.map((t) => t.walletId));
        return uniqueWallets.size >= MIN_CLUSTER_WALLETS;
      })
      .map((g) => this.buildClusterAlert(g))
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

  private buildClusterAlert(group: ClusterGroup): ClusterAlert {
    const walletIds = [...new Set(group.trades.map((t) => t.walletId))];
    const combinedSize = group.trades.reduce((sum, t) => sum + t.quantity, 0);

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
    };
  }
}

export const walletClusterDetector = new WalletClusterSignalDetector();
