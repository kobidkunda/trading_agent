import { db } from '@/lib/db';
import type { Venue } from '@/lib/types';

interface IngestedWalletTrade {
  externalMarketId: string;
  side: string;
  quantity: number;
  price: number;
  tradeTimestamp: Date;
  category?: string;
  resolutionDate?: Date;
  currentPosition?: number;
  realizedPnl?: number;
  unrealizedPnl?: number;
}

interface IngestedWalletStats {
  address: string;
  venue: string;
  totalTrades: number;
  resolvedTrades: number;
  winRate: number;
  profitFactor: number;
  realizedPnl: number;
  brierScore: number;
  avgEdge?: number;
  avgPositionSize?: number;
  avgHoldTimeMs?: number;
  drawdown?: number;
  trades: IngestedWalletTrade[];
}

interface IngestionResult {
  walletsUpserted: number;
  tradesInserted: number;
  skipped: number;
  errors: string[];
}

const INGESTION_BATCH_SIZE = 50;

export class WalletIngestionEngine {
  /**
   * Ingest wallet data from an external source. Accepts pre-fetched
   * stats + trades (production feeder calls Polymarket Gamma Markets API,
   * parses response, then passes to this method).
   */
  async ingestWallets(
    wallets: IngestedWalletStats[],
    venue: Venue = 'POLYMARKET'
  ): Promise<IngestionResult> {
    const result: IngestionResult = {
      walletsUpserted: 0,
      tradesInserted: 0,
      skipped: 0,
      errors: [],
    };

    for (let i = 0; i < wallets.length; i += INGESTION_BATCH_SIZE) {
      const batch = wallets.slice(i, i + INGESTION_BATCH_SIZE);
      try {
        await db.$transaction(async (tx) => {
          for (const wallet of batch) {
            try {
              const upserted = await tx.wallet.upsert({
                where: { address: wallet.address },
                create: {
                  address: wallet.address,
                  venue,
                  totalTrades: wallet.totalTrades,
                  resolvedTrades: wallet.resolvedTrades,
                  winRate: wallet.winRate,
                  profitFactor: wallet.profitFactor,
                  realizedPnl: wallet.realizedPnl,
                  brierScore: wallet.brierScore,
                  avgEdge: wallet.avgEdge ?? null,
                  avgPositionSize: wallet.avgPositionSize ?? null,
                  avgHoldTimeMs: wallet.avgHoldTimeMs ?? null,
                  drawdown: wallet.drawdown ?? null,
                  lastActivityAt: new Date(),
                },
                update: {
                  totalTrades: wallet.totalTrades,
                  resolvedTrades: wallet.resolvedTrades,
                  winRate: wallet.winRate,
                  profitFactor: wallet.profitFactor,
                  realizedPnl: wallet.realizedPnl,
                  brierScore: wallet.brierScore,
                  avgEdge: wallet.avgEdge ?? null,
                  avgPositionSize: wallet.avgPositionSize ?? null,
                  avgHoldTimeMs: wallet.avgHoldTimeMs ?? null,
                  drawdown: wallet.drawdown ?? null,
                  lastActivityAt: new Date(),
                },
              });

              result.walletsUpserted++;

              if (wallet.trades.length === 0) continue;

              const tradeIds = wallet.trades.map(
                (t) => `${upserted.id}:${t.externalMarketId}:${t.tradeTimestamp.toISOString()}`
              );

              const existing = await tx.walletTrade.findMany({
                where: {
                  walletId: upserted.id,
                  marketId: null,
                  externalMarketId: { in: wallet.trades.map((t) => t.externalMarketId) },
                },
                select: { externalMarketId: true, tradeTimestamp: true },
              });

              const existingKeys = new Set(
                existing.map((e) => `${e.externalMarketId}:${e.tradeTimestamp.toISOString()}`)
              );

              const newTrades = wallet.trades.filter(
                (_, idx) => !existingKeys.has(tradeIds[idx])
              );

              if (newTrades.length > 0) {
                await tx.walletTrade.createMany({
                  data: newTrades.map((t) => ({
                    walletId: upserted.id,
                    externalMarketId: t.externalMarketId,
                    side: t.side,
                    quantity: t.quantity,
                    price: t.price,
                    tradeTimestamp: t.tradeTimestamp,
                    category: t.category ?? null,
                    resolutionDate: t.resolutionDate ?? null,
                    currentPosition: t.currentPosition ?? null,
                    realizedPnl: t.realizedPnl ?? null,
                    unrealizedPnl: t.unrealizedPnl ?? null,
                  })),
                });
                result.tradesInserted += newTrades.length;
              }

              result.skipped += wallet.trades.length - newTrades.length;
            } catch (err: any) {
              result.errors.push(
                `wallet ${wallet.address}: ${err?.message ?? 'unknown'}`
              );
            }
          }
        });
      } catch (err: any) {
        result.errors.push(
          `batch ${i}-${i + INGESTION_BATCH_SIZE}: ${err?.message ?? 'unknown'}`
        );
      }
    }

    return result;
  }

  /**
   * Compute wallet stats from a list of trades.
   * Used when you have raw trade data and need derived metrics.
   */
  computeStatsFromTrades(
    address: string,
    resolvedTrades: { side: string; pnl: number; probability: number }[]
  ): Omit<IngestedWalletStats, 'trades'> {
    const wins = resolvedTrades.filter((t) => t.pnl > 0);
    const losses = resolvedTrades.filter((t) => t.pnl < 0);

    const winRate = resolvedTrades.length > 0
      ? wins.length / resolvedTrades.length
      : 0;

    const totalGain = wins.reduce((s, t) => s + t.pnl, 0);
    const totalLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = totalLoss > 0 ? totalGain / totalLoss : totalGain > 0 ? 999 : 0;

    const realizedPnl = resolvedTrades.reduce((s, t) => s + t.pnl, 0);

    const brierScore = resolvedTrades.length > 0
      ? resolvedTrades.reduce((sum, t) => {
          const actual = t.pnl > 0 ? 1 : 0;
          return sum + (t.probability - actual) ** 2;
        }, 0) / resolvedTrades.length
      : null;

    return {
      address,
      venue: 'POLYMARKET',
      totalTrades: resolvedTrades.length,
      resolvedTrades: resolvedTrades.length,
      winRate,
      profitFactor,
      realizedPnl,
      brierScore: brierScore ?? 0.25,
      avgEdge: resolvedTrades.length > 0
        ? resolvedTrades.reduce((s, t) => s + Math.abs(t.probability - 0.5), 0) / resolvedTrades.length
        : 0,
    };
  }
}

export const walletIngestion = new WalletIngestionEngine();

export interface WalletEligibilityConfig {
  minResolvedTrades: number;
  minActiveDays: number;
  minProfitFactor: number;
  maxJackpotDependency: number;
  minWinRate: number;
  minBrierScore: number;
  maxDrawdown: number;
}

export const DEFAULT_WALLET_ELIGIBILITY: WalletEligibilityConfig = {
  minResolvedTrades: 50,
  minActiveDays: 30,
  minProfitFactor: 1.2,
  maxJackpotDependency: 0.4,
  minWinRate: 0.55,
  minBrierScore: 0.35,
  maxDrawdown: 0.5,
};

export interface WalletEligibilityResult {
  eligible: boolean;
  failures: string[];
  score: number;
}

export function checkWalletEligibility(
  wallet: {
    resolvedTrades: number;
    winRate: number | null;
    profitFactor: number | null;
    brierScore: number | null;
    drawdown: number | null;
    recentPerformance: number | null;
  },
  config?: Partial<WalletEligibilityConfig>
): WalletEligibilityResult {
  const cfg = { ...DEFAULT_WALLET_ELIGIBILITY, ...config };
  const failures: string[] = [];

  if (wallet.resolvedTrades < cfg.minResolvedTrades) {
    failures.push(
      `resolvedTrades (${wallet.resolvedTrades}) < minResolvedTrades (${cfg.minResolvedTrades})`
    );
  }

  const wr = wallet.winRate ?? 0;
  if (wr < cfg.minWinRate) {
    failures.push(
      `winRate (${wr.toFixed(3)}) < minWinRate (${cfg.minWinRate})`
    );
  }

  const pf = wallet.profitFactor ?? 0;
  if (pf < cfg.minProfitFactor) {
    failures.push(
      `profitFactor (${pf.toFixed(2)}) < minProfitFactor (${cfg.minProfitFactor})`
    );
  }

  const bs = wallet.brierScore ?? 1;
  if (bs > cfg.minBrierScore) {
    failures.push(
      `brierScore (${bs.toFixed(3)}) > max (${cfg.minBrierScore})`
    );
  }

  const dd = wallet.drawdown ?? 0;
  if (dd < -cfg.maxDrawdown) {
    failures.push(
      `drawdown (${(dd * 100).toFixed(1)}%) exceeds maxDrawdown (${(cfg.maxDrawdown * 100).toFixed(1)}%)`
    );
  }

  const winRateNorm = clamp01((wr - 0.4) / 0.4);
  const pfLog = pf > 0 ? Math.log(Math.max(0.5, pf)) : 0;
  const pfNorm = clamp01(pfLog / Math.log(3));
  const brierNorm = clamp01(1 - bs);
  const resolvedNorm = clamp01(
    wallet.resolvedTrades / Math.max(cfg.minResolvedTrades * 2, 200)
  );
  const recencyNorm =
    wallet.recentPerformance != null
      ? clamp01((wallet.recentPerformance + 1) / 2)
      : 0.5;

  const score = Math.round(
    (winRateNorm * 25 +
      pfNorm * 20 +
      brierNorm * 15 +
      resolvedNorm * 20 +
      recencyNorm * 20) *
      100
  );

  return {
    eligible: failures.length === 0,
    failures,
    score,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
