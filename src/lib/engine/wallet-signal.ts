import { db } from '@/lib/db';
import { walletClusterDetector } from './wallet-cluster';
import { walletRanker } from './wallet-ranker';
import { checkWalletEligibility } from './wallet-ingestion';

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
  const eligibleTrades = relevantTrades.filter((trade) => checkWalletEligibility(trade.wallet).eligible);
  if (eligibleTrades.length === 0) return clusterSignal;

  let score = clusterSignal;

  const uniqueWallets = new Set(eligibleTrades.map((t) => t.walletId));
  const topWalletParticipation = uniqueWallets.size;

  if (topWalletParticipation >= 3) {
    score += 5 + Math.min(3, topWalletParticipation - 3);
  } else if (topWalletParticipation >= 1) {
    score += topWalletParticipation * 2;
  }

  const avgRank = eligibleTrades.reduce(
    (sum, t) => sum + (t.wallet.rank ?? 999),
    0
  ) / eligibleTrades.length;

  if (avgRank <= 3) score += 3;
  else if (avgRank <= 5) score += 2;
  else if (avgRank <= 10) score += 1;

  return Math.min(20, Math.round(score));
}

/**
 * Fresh wallet signal result with trust filtering and age decay.
 * Called from market-loop each iteration to avoid stale scores.
 */
export interface FreshWalletSignalResult {
  score: number;             // 0–20, raw score (before decay in scoring)
  hasTrustedSignal: boolean;
  signalReason: string;      // stored on TradeCandidate.walletSignalReason
  signalFreshnessHours: number; // hours since most recent trusted trade (for decay)
  trustedTradeCount: number;
  eligibleTrustedWalletCount: number;
}

export async function computeFreshWalletSignal(marketId: string): Promise<FreshWalletSignalResult> {
  const [trustContext, rawScore] = await Promise.all([
    getWalletSignalTrustContext(marketId),
    computeWalletSignalScore(marketId),
  ]);

  if (!trustContext.hasTrustedEligibleWalletSignal) {
    return {
      score: 0,
      hasTrustedSignal: false,
      signalReason: 'NO_TRUSTED_ELIGIBLE_WALLET',
      signalFreshnessHours: 0,
      trustedTradeCount: trustContext.trustedTradeCount,
      eligibleTrustedWalletCount: trustContext.eligibleTrustedWalletCount,
    };
  }

  // Compute freshness: hours since most recent trusted wallet trade for this market
  const mostRecentTrade = await db.walletTrade.findFirst({
    where: {
      marketId,
      trustedSource: true,
      wallet: {
        resolvedTrades: { gte: 10 },
        activeDays: { gte: 7 },
        winRate: { gte: 0.5 },
        profitFactor: { gte: 1.0 },
        brierScore: { lte: 0.5 },
      },
    },
    orderBy: { tradeTimestamp: 'desc' },
  });

  const ageMs = mostRecentTrade
    ? Date.now() - new Date(mostRecentTrade.tradeTimestamp).getTime()
    : 24 * 60 * 60_000;
  const signalFreshnessHours = Math.max(0, ageMs / (1000 * 60 * 60));

  return {
    score: Math.min(20, Math.round(rawScore ?? 0)),
    hasTrustedSignal: true,
    signalReason: `TRUSTED:${trustContext.eligibleTrustedWalletCount}w/${trustContext.trustedTradeCount}t_raw=${rawScore}`,
    signalFreshnessHours,
    trustedTradeCount: trustContext.trustedTradeCount,
    eligibleTrustedWalletCount: trustContext.eligibleTrustedWalletCount,
  };
}

export async function getWalletSignalTrustContext(marketId: string): Promise<{
  hasAnyWalletSignal: boolean;
  hasTrustedEligibleWalletSignal: boolean;
  trustedTradeCount: number;
  eligibleTrustedWalletCount: number;
}> {
  const walletTrades = await db.walletTrade.findMany({
    where: { marketId },
    include: { wallet: true },
  });

  if (walletTrades.length === 0) {
    return {
      hasAnyWalletSignal: false,
      hasTrustedEligibleWalletSignal: false,
      trustedTradeCount: 0,
      eligibleTrustedWalletCount: 0,
    };
  }

  const trustedEligibleTrades = walletTrades.filter(
    (trade) => trade.trustedSource && checkWalletEligibility(trade.wallet).eligible,
  );

  return {
    hasAnyWalletSignal: true,
    hasTrustedEligibleWalletSignal: trustedEligibleTrades.length > 0,
    trustedTradeCount: trustedEligibleTrades.length,
    eligibleTrustedWalletCount: new Set(trustedEligibleTrades.map((trade) => trade.walletId)).size,
  };
}
