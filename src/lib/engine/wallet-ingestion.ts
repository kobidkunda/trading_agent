import { db } from '@/lib/db';
import type { Venue } from '@/lib/types';
import type { WalletSourceMode } from '@/lib/engine/wallet-source';

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
  sourceMode?: WalletSourceMode;
  sourceName?: string;
  trustedSource?: boolean;
}

interface IngestedWalletStats {
  address: string;
  venue: string;
  totalTrades: number;
  resolvedTrades: number;
  activeDays?: number;
  winRate: number;
  profitFactor: number;
  realizedPnl: number;
  brierScore: number;
  avgEdge?: number;
  avgPositionSize?: number;
  avgHoldTimeMs?: number;
  drawdown?: number;
  jackpotDependency?: number;
  reliabilityScore?: number;
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
    venue: Venue = 'POLYMARKET',
    sourceContext?: {
      sourceMode?: WalletSourceMode;
      sourceName?: string;
      trustedSource?: boolean;
    },
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
                where: { venue_address: { venue, address: wallet.address } },
                create: {
                  address: wallet.address,
                  venue,
                  totalTrades: wallet.totalTrades,
                  resolvedTrades: wallet.resolvedTrades,
                  activeDays: wallet.activeDays ?? computeActiveDays(wallet.trades),
                  winRate: wallet.winRate,
                  profitFactor: wallet.profitFactor,
                  realizedPnl: wallet.realizedPnl,
                  brierScore: wallet.brierScore,
                  avgEdge: wallet.avgEdge ?? null,
                  avgPositionSize: wallet.avgPositionSize ?? null,
                  avgHoldTimeMs: wallet.avgHoldTimeMs ?? null,
                  drawdown: wallet.drawdown ?? null,
                  jackpotDependency: wallet.jackpotDependency ?? computeJackpotDependency(wallet.trades),
                  reliabilityScore: wallet.reliabilityScore ?? null,
                  lastActivityAt: new Date(),
                },
                update: {
                  totalTrades: wallet.totalTrades,
                  resolvedTrades: wallet.resolvedTrades,
                  activeDays: wallet.activeDays ?? computeActiveDays(wallet.trades),
                  winRate: wallet.winRate,
                  profitFactor: wallet.profitFactor,
                  realizedPnl: wallet.realizedPnl,
                  brierScore: wallet.brierScore,
                  avgEdge: wallet.avgEdge ?? null,
                  avgPositionSize: wallet.avgPositionSize ?? null,
                  avgHoldTimeMs: wallet.avgHoldTimeMs ?? null,
                  drawdown: wallet.drawdown ?? null,
                  jackpotDependency: wallet.jackpotDependency ?? computeJackpotDependency(wallet.trades),
                  reliabilityScore: wallet.reliabilityScore ?? null,
                  lastActivityAt: new Date(),
                },
              });

              result.walletsUpserted++;

              if (wallet.trades.length === 0) continue;

              const tradeIds = wallet.trades.map(
                (t) => `${upserted.id}:${venue}:${t.externalMarketId}:${t.tradeTimestamp.toISOString()}:${t.side}`
              );

              const existing = await tx.walletTrade.findMany({
                where: {
                  walletId: upserted.id,
                  externalMarketId: { in: wallet.trades.map((t) => t.externalMarketId) },
                },
                select: { externalMarketId: true, tradeTimestamp: true, side: true },
              });

              const existingKeys = new Set(
                existing.map((e) => `${upserted.id}:${venue}:${e.externalMarketId}:${e.tradeTimestamp.toISOString()}:${e.side}`)
              );

              const newTrades = wallet.trades.filter(
                (_, idx) => !existingKeys.has(tradeIds[idx])
              );

              if (newTrades.length > 0) {
                const linkedMarkets = await tx.market.findMany({
                  where: {
                    venue,
                    externalId: { in: newTrades.map((trade) => trade.externalMarketId) },
                  },
                  select: { id: true, externalId: true },
                });
                const marketIdByExternalId = new Map(
                  linkedMarkets.map((market) => [market.externalId, market.id]),
                );

                await tx.walletTrade.createMany({
                  data: newTrades.map((t) => ({
                    walletId: upserted.id,
                    externalMarketId: t.externalMarketId,
                    marketId: marketIdByExternalId.get(t.externalMarketId) ?? null,
                    side: t.side,
                    quantity: t.quantity,
                    price: t.price,
                    tradeTimestamp: t.tradeTimestamp,
                    category: t.category ?? null,
                    resolutionDate: t.resolutionDate ?? null,
                    currentPosition: t.currentPosition ?? null,
                    realizedPnl: t.realizedPnl ?? null,
                    unrealizedPnl: t.unrealizedPnl ?? null,
                    sourceMode: t.sourceMode ?? sourceContext?.sourceMode ?? 'DISABLED',
                    sourceName: t.sourceName ?? sourceContext?.sourceName ?? 'unknown',
                    trustedSource: t.trustedSource ?? sourceContext?.trustedSource ?? false,
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
      activeDays: 0,
      jackpotDependency: computeJackpotDependencyFromResolved(resolvedTrades),
      reliabilityScore: computeReliabilityScore({
        resolvedTrades: resolvedTrades.length,
        activeDays: 0,
        profitFactor,
        winRate,
        brierScore: brierScore ?? 0.25,
        jackpotDependency: computeJackpotDependencyFromResolved(resolvedTrades),
      }),
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
    activeDays?: number | null;
    winRate: number | null;
    profitFactor: number | null;
    brierScore: number | null;
    drawdown: number | null;
    jackpotDependency?: number | null;
    reliabilityScore?: number | null;
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

  const activeDays = wallet.activeDays ?? 0;
  if (activeDays < cfg.minActiveDays) {
    failures.push(
      `activeDays (${activeDays}) < minActiveDays (${cfg.minActiveDays})`
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

  const jackpotDependency = wallet.jackpotDependency ?? 1;
  if (jackpotDependency > cfg.maxJackpotDependency) {
    failures.push(
      `jackpotDependency (${jackpotDependency.toFixed(3)}) > maxJackpotDependency (${cfg.maxJackpotDependency})`
    );
  }

  const winRateNorm = clamp01((wr - 0.4) / 0.4);
  const pfLog = pf > 0 ? Math.log(Math.max(0.5, pf)) : 0;
  const pfNorm = clamp01(pfLog / Math.log(3));
  const brierNorm = clamp01(1 - bs);
  const resolvedNorm = clamp01(
    wallet.resolvedTrades / Math.max(cfg.minResolvedTrades * 2, 200)
  );
  const activeDaysNorm = clamp01(
    activeDays / Math.max(cfg.minActiveDays * 2, 120)
  );
  const recencyNorm =
    wallet.recentPerformance != null
      ? clamp01((wallet.recentPerformance + 1) / 2)
      : 0.5;

  const jackpotNorm = clamp01(1 - jackpotDependency);

  const score = Math.round(
    (winRateNorm * 25 +
      pfNorm * 20 +
      brierNorm * 15 +
      resolvedNorm * 10 +
      activeDaysNorm * 10 +
      recencyNorm * 10 +
      jackpotNorm * 10) *
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

function computeActiveDays(trades: IngestedWalletTrade[]): number {
  const days = new Set(
    trades.map((trade) => trade.tradeTimestamp.toISOString().slice(0, 10))
  );
  return days.size;
}

function computeJackpotDependency(trades: IngestedWalletTrade[]): number {
  const pnls = trades
    .map((trade) => trade.realizedPnl)
    .filter((value): value is number => typeof value === 'number' && value > 0);
  if (pnls.length === 0) return 1;
  const total = pnls.reduce((sum, value) => sum + value, 0);
  const top = Math.max(...pnls);
  return total > 0 ? top / total : 1;
}

function computeJackpotDependencyFromResolved(
  trades: { pnl: number }[],
): number {
  const positivePnls = trades
    .map((trade) => trade.pnl)
    .filter((value) => value > 0);
  if (positivePnls.length === 0) return 1;
  const total = positivePnls.reduce((sum, value) => sum + value, 0);
  return total > 0 ? Math.max(...positivePnls) / total : 1;
}

function computeReliabilityScore(input: {
  resolvedTrades: number;
  activeDays: number;
  profitFactor: number;
  winRate: number;
  brierScore: number;
  jackpotDependency: number;
}): number {
  const resolvedNorm = clamp01(input.resolvedTrades / 200);
  const activeNorm = clamp01(input.activeDays / 120);
  const pfNorm = clamp01(Math.log(Math.max(input.profitFactor, 0.5)) / Math.log(3));
  const winNorm = clamp01((input.winRate - 0.4) / 0.4);
  const brierNorm = clamp01(1 - input.brierScore);
  const jackpotNorm = clamp01(1 - input.jackpotDependency);

  return Math.round(
    (resolvedNorm * 0.2 +
      activeNorm * 0.15 +
      pfNorm * 0.2 +
      winNorm * 0.15 +
      brierNorm * 0.15 +
      jackpotNorm * 0.15) *
      10000
  ) / 100;
}
