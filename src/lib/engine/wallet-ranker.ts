import { db } from '@/lib/db';
import type { Wallet } from '@prisma/client';

const DEFAULT_TOP_N = 20;

interface WalletRanking {
  wallet: Wallet;
  compositeScore: number;
  rank: number;
}

/**
 * Ranks wallets by composite score: PnL z-score (30%), win rate (25%),
 * profit factor log-normalized (20%), inverted Brier calibration (15%),
 * avgEdge (10%). Minimum 5 resolved trades to qualify.
 */
export class WalletPerformanceRanker {
  private readonly WEIGHTS = {
    pnl: 0.30,
    winRate: 0.25,
    profitFactor: 0.20,
    brier: 0.15,
    edge: 0.10,
  };

  private readonly MIN_RESOLVED_TRADES = 5;

  async rankWallets(): Promise<Wallet[]> {
    const wallets = await db.wallet.findMany({
      where: { isActive: true, resolvedTrades: { gte: this.MIN_RESOLVED_TRADES } },
    });

    if (wallets.length === 0) return [];

    const ranked = this.computeCompositeScores(wallets);
    return ranked.sort((a, b) => b.compositeScore - a.compositeScore).map((r) => r.wallet);
  }

  async getTopWallets(n: number = DEFAULT_TOP_N): Promise<Wallet[]> {
    const ranked = await this.rankWallets();
    return ranked.slice(0, n);
  }

  async updateRankings(): Promise<void> {
    const wallets = await db.wallet.findMany({
      where: { isActive: true, resolvedTrades: { gte: this.MIN_RESOLVED_TRADES } },
    });

    if (wallets.length === 0) return;

    const ranked = this.computeCompositeScores(wallets)
      .sort((a, b) => b.compositeScore - a.compositeScore);

    await db.$transaction(
      ranked.map((r, i) =>
        db.wallet.update({
          where: { id: r.wallet.id },
          data: { rank: i + 1 },
        })
      )
    );

    await db.wallet.updateMany({
      where: {
        isActive: true,
        resolvedTrades: { lt: this.MIN_RESOLVED_TRADES },
      },
      data: { rank: null },
    });
  }

  private computeCompositeScores(wallets: Wallet[]): WalletRanking[] {
    const pnls = wallets.map((w) => w.realizedPnl);
    const meanPnl = pnls.reduce((a, b) => a + b, 0) / pnls.length;
    const stdPnl = stdDev(pnls, meanPnl) || 1;

    const winRates = wallets.map((w) => w.winRate ?? 0);
    const profitFactors = wallets.map((w) => w.profitFactor ?? 1);
    const briers = wallets.map((w) => w.brierScore ?? 0.25);
    const edges = wallets.map((w) => Math.max(0, w.avgEdge ?? 0));

    const maxWinRate = Math.max(...winRates, 0.01);
    const maxProfitFactor = Math.max(...profitFactors, 1);
    const maxBrier = Math.max(...briers, 0.01);
    const maxEdge = Math.max(...edges, 0.01);

    return wallets.map((wallet) => {
      const pnlZScore = (wallet.realizedPnl - meanPnl) / stdPnl;
      const pnlNorm = clamp((pnlZScore + 3) / 6, 0, 1);

      const winRateNorm = (wallet.winRate ?? 0) / maxWinRate;
      const pf = Math.max(0.5, wallet.profitFactor ?? 1);
      const pfNorm = clamp(Math.log(pf) / Math.log(Math.max(maxProfitFactor, 2)), 0, 1);
      const brier = wallet.brierScore ?? 0.25;
      const brierNorm = 1 - (brier / maxBrier);
      const edgeNorm = clamp((wallet.avgEdge ?? 0) / maxEdge, 0, 1);

      const compositeScore =
        this.WEIGHTS.pnl * pnlNorm +
        this.WEIGHTS.winRate * winRateNorm +
        this.WEIGHTS.profitFactor * pfNorm +
        this.WEIGHTS.brier * brierNorm +
        this.WEIGHTS.edge * edgeNorm;

      return { wallet, compositeScore, rank: 0 };
    });
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function stdDev(values: number[], mean: number): number {
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export const walletRanker = new WalletPerformanceRanker();
