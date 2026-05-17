import { db } from '@/lib/db';
import { walletClusterDetector } from './wallet-cluster';
import { walletRanker } from './wallet-ranker';

/**
 * Computes a wallet signal score (0–20) for a market.
 * Combines cluster signal strength with top-wallet participation data.
 */
export async function computeWalletSignalScore(marketId: string): Promise<number> {
  const [clusterSignal, topWallets] = await Promise.all([
    walletClusterDetector.computeClusterSignal(marketId),
    walletRanker.getTopWallets(10),
  ]);

  if (clusterSignal >= 10) return clusterSignal;

  const topWalletIds = topWallets.map((w) => w.id);

  const relevantTrades = await db.walletTrade.findMany({
    where: {
      marketId,
      walletId: { in: topWalletIds },
    },
    include: { wallet: true },
  });

  if (relevantTrades.length === 0) return clusterSignal;

  let score = clusterSignal;

  const uniqueWallets = new Set(relevantTrades.map((t) => t.walletId));
  const topWalletParticipation = uniqueWallets.size;

  if (topWalletParticipation >= 3) {
    score += 5 + Math.min(3, topWalletParticipation - 3);
  } else if (topWalletParticipation >= 1) {
    score += topWalletParticipation * 2;
  }

  const avgRank = relevantTrades.reduce(
    (sum, t) => sum + (t.wallet.rank ?? 999),
    0
  ) / relevantTrades.length;

  if (avgRank <= 3) score += 3;
  else if (avgRank <= 5) score += 2;
  else if (avgRank <= 10) score += 1;

  return Math.min(20, Math.round(score));
}
