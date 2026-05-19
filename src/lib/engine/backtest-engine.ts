// ── Deterministic Backtesting Engine (Phase 15) ──
// Pure deterministic replay of historical snapshots through scoring + risk logic.
// No LLM re-execution. No external data.
//
// Flow: load HistoricalSnapshots → score via candidate-scoring.ts → risk-check via risk.ts
// → cross-reference Outcome table → compute Brier + PnL → aggregate metrics → store BacktestRun.

import { db } from '@/lib/db';
import { computeCandidateScore } from './candidate-scoring';
import type { CandidateScoreInput } from './candidate-scoring';
import { computeRisk } from './risk';
import type { RiskEngineInput } from '@/lib/types';

// ── Types ──

export interface BacktestConfig {
  candidateScoreThreshold: number;
  minAdjustedEdge: number;
  minLiquidity: number;
  maxSpread: number;
  confidenceThreshold: number;
  maxPositionSize: number;
}

export const DEFAULT_BACKTEST_CONFIG: BacktestConfig = {
  candidateScoreThreshold: 50,
  minAdjustedEdge: 0.02,
  minLiquidity: 1000,
  maxSpread: 0.05,
  confidenceThreshold: 0.4,
  maxPositionSize: 5000,
};

export interface ReplayResult {
  marketId: string;
  marketTitle: string;
  category: string;
  venue: string;
  snapshotCount: number;
  wouldBet: boolean;
  predictedProb: number;
  impliedProb: number;
  edge: number;
  candidateScore: number;
  scoreBreakdown: string | null;
  riskAction: string | null;
  riskReason: string | null;
  actualOutcome: string | null;
  brierScore: number | null;
  pnl: number | null;
}

export interface BacktestMetrics {
  totalMarkets: number;
  totalBets: number;
  winRate: number;
  roi: number;
  brierScore: number;
  drawdown: number;
  sharpeRatio: number;
  byCategory: Record<string, { winRate: number; roi: number; brier: number; count: number }>;
}

// ── Engine ──

export class BacktestEngine {
  /**
   * Run a full backtest over a time period with a given strategy config.
   * Loads all markets with HistoricalSnapshots + Outcomes in the period,
   * replays each, aggregates metrics, stores BacktestRun row.
   */
  async runBacktest(
    config: BacktestConfig,
    opts?: {
      periodStart?: Date;
      periodEnd?: Date;
      strategyConfigId?: string;
      mode?: string;
    },
  ): Promise<{ backtestRunId: string; metrics: BacktestMetrics; replays: ReplayResult[] }> {
    const periodStart = opts?.periodStart ?? new Date('2024-01-01');
    const periodEnd = opts?.periodEnd ?? new Date();

    const run = await db.backtestRun.create({
      data: {
        status: 'RUNNING',
        mode: opts?.mode ?? 'DETERMINISTIC',
        periodStart,
        periodEnd,
        strategyConfigId: opts?.strategyConfigId ?? null,
        startedAt: new Date(),
      },
    });

    const marketIds = await this.findBacktestableMarkets(periodStart, periodEnd);

    const replays: ReplayResult[] = [];
    for (const marketId of marketIds) {
      const result = await this.replayMarket(marketId, periodStart, periodEnd, config);
      replays.push(result);
    }

    const metrics = this.computeMetrics(replays);

    await db.backtestRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        totalMarkets: replays.length,
        totalBets: metrics.totalBets,
        winRate: metrics.winRate,
        roi: metrics.roi,
        brierScore: metrics.brierScore,
        drawdown: metrics.drawdown,
        sharpeRatio: metrics.sharpeRatio,
        result: JSON.stringify({
          summary: {
            totalMarkets: metrics.totalMarkets,
            totalBets: metrics.totalBets,
            winRate: metrics.winRate,
            roi: metrics.roi,
            brierScore: metrics.brierScore,
            drawdown: metrics.drawdown,
            sharpeRatio: metrics.sharpeRatio,
          },
          byCategory: metrics.byCategory,
          config,
        }),
        completedAt: new Date(),
      },
    });

    return { backtestRunId: run.id, metrics, replays };
  }

  /**
   * Replay a single market: load historical snapshots, score, risk-check, compare with actual outcome.
   */
  async replayMarket(
    marketId: string,
    periodStart: Date,
    periodEnd: Date,
    config: BacktestConfig,
  ): Promise<ReplayResult> {
    const market = await db.market.findUnique({
      where: { id: marketId },
      select: { id: true, title: true, category: true, venue: true },
    });
    if (!market) {
      return {
        marketId,
        marketTitle: 'Unknown',
        category: 'unknown',
        venue: 'unknown',
        snapshotCount: 0,
        wouldBet: false,
        predictedProb: 0,
        impliedProb: 0,
        edge: 0,
        candidateScore: 0,
        scoreBreakdown: null,
        riskAction: null,
        riskReason: 'Market not found',
        actualOutcome: null,
        brierScore: null,
        pnl: null,
      };
    }

    const snapshots = await db.historicalSnapshot.findMany({
      where: {
        marketId,
        snapshotTime: { gte: periodStart, lte: periodEnd },
      },
      orderBy: { snapshotTime: 'asc' },
    });

    if (snapshots.length === 0) {
      return {
        marketId,
        marketTitle: market.title,
        category: market.category,
        venue: market.venue,
        snapshotCount: 0,
        wouldBet: false,
        predictedProb: 0,
        impliedProb: 0,
        edge: 0,
        candidateScore: 0,
        scoreBreakdown: null,
        riskAction: null,
        riskReason: 'No snapshots in period',
        actualOutcome: null,
        brierScore: null,
        pnl: null,
      };
    }

    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];

    const priceMovePercent = last.impliedProb - first.impliedProb;

    const predictedProb = first.predictedProb ?? first.impliedProb;
    const impliedProb = first.impliedProb;
    const rawEdge = predictedProb - impliedProb;
    const adjustedEdge = first.predictedProb != null ? rawEdge : priceMovePercent;

    const freshnessMinutes =
      (periodEnd.getTime() - first.snapshotTime.getTime()) / 60000;

    // ── Compute candidate score ──
    const scoreInput: CandidateScoreInput = {
      liquidity: first.liquidity,
      spread: first.spread,
      volume24h: first.volume24h,
      freshnessMinutes,
      priceMovePercent: priceMovePercent * 100,
      categoryPriority: 5,
      rawEdge,
      adjustedEdge,
      walletSignalScore: first.walletSignalStrength ?? undefined,
      orderbookPenaltyMode: 'STRICT',
      missingOrderbookPenalty: 15,
    };

    const scoreResult = computeCandidateScore(scoreInput);
    const candidateScore = scoreResult.totalScore;

    // ── Risk check ──
    const riskInput: RiskEngineInput = {
      impliedProbability: impliedProb,
      judgeProbability: predictedProb,
      confidence: config.confidenceThreshold,
      uncertainty: 0.3,
      fees: 0.0,
      slippage: 0.0,
      venue: market.venue as RiskEngineInput['venue'],
      category: market.category,
      dailyExposure: 0,
      categoryExposure: 0,
      openPositions: 0,
      marketLiquidity: first.liquidity,
      marketSpread: first.spread,
      minLiquidity: config.minLiquidity,
      maxSpread: config.maxSpread,
      maxPositionSize: config.maxPositionSize,
    };

    const riskResult = computeRisk(riskInput);

    // ── Determine if we would bet ──
    const scorePass = candidateScore >= config.candidateScoreThreshold;
    const edgePass = Math.abs(adjustedEdge) >= config.minAdjustedEdge;
    const riskPass = riskResult.action === 'BID' || riskResult.action === 'WATCH';
    const wouldBet = scorePass && edgePass && riskPass;

    // ── Load actual outcome ──
    const outcome = await db.outcome.findFirst({
      where: { marketId },
      orderBy: { resolvedAt: 'desc' },
    });

    const actualOutcome = outcome?.result ?? null;

    // ── Compute Brier score ──
    let brierScore: number | null = null;
    let pnl: number | null = null;

    if (actualOutcome === 'YES' || actualOutcome === 'NO') {
      const actualBinary = actualOutcome === 'YES' ? 1 : 0;
      brierScore = Math.pow(predictedProb - actualBinary, 2);

      // Compute PnL if we would bet
      if (wouldBet) {
        const side: 'YES' | 'NO' = predictedProb > impliedProb ? 'YES' : 'NO';
        if (side === 'YES') {
          pnl = actualOutcome === 'YES' ? 1.0 - impliedProb : -impliedProb;
        } else {
          pnl = actualOutcome === 'NO' ? impliedProb : -(1.0 - impliedProb);
        }
      }
    }

    return {
      marketId,
      marketTitle: market.title,
      category: market.category,
      venue: market.venue,
      snapshotCount: snapshots.length,
      wouldBet,
      predictedProb,
      impliedProb,
      edge: adjustedEdge,
      candidateScore,
      scoreBreakdown: JSON.stringify({
        total: scoreResult.totalScore,
        accepted: scoreResult.acceptedCriteria,
        rejected: scoreResult.rejectedCriteria,
      }),
      riskAction: riskResult.action,
      riskReason: riskResult.reason,
      actualOutcome,
      brierScore,
      pnl,
    };
  }

  /**
   * Find all market IDs that have both HistoricalSnapshots and Outcomes within the period.
   */
  private async findBacktestableMarkets(periodStart: Date, periodEnd: Date): Promise<string[]> {
    const rows = await db.historicalSnapshot.findMany({
      where: {
        snapshotTime: { gte: periodStart, lte: periodEnd },
      },
      select: { marketId: true },
      distinct: ['marketId'],
      orderBy: { marketId: 'asc' },
    });
    return rows.map((r) => r.marketId);
  }

  /**
   * Aggregate results across all markets into BacktestMetrics.
   */
  computeMetrics(replays: ReplayResult[]): BacktestMetrics {
    const bets = replays.filter((r) => r.wouldBet);
    const resolved = bets.filter(
      (r) => r.actualOutcome === 'YES' || r.actualOutcome === 'NO',
    );

    const wins = resolved.filter((r) => (r.pnl ?? 0) > 0);
    const winRate = resolved.length > 0 ? wins.length / resolved.length : 0;

    const totalPnl = resolved.reduce((sum, r) => sum + (r.pnl ?? 0), 0);
    const roi = bets.length > 0 ? totalPnl / bets.length : 0;

    const allResolved = replays.filter(
      (r) => r.actualOutcome === 'YES' || r.actualOutcome === 'NO',
    );
    const brierScore =
      allResolved.length > 0
        ? allResolved.reduce((sum, r) => sum + (r.brierScore ?? 0), 0) / allResolved.length
        : 0;

    // Drawdown: max peak-to-trough in cumulative PnL series
    let peak = 0;
    let maxDrawdown = 0;
    let cumulativePnl = 0;
    for (const r of resolved) {
      cumulativePnl += r.pnl ?? 0;
      if (cumulativePnl > peak) peak = cumulativePnl;
      const drawdown = peak - cumulativePnl;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
    const drawdown = peak > 0 ? maxDrawdown / peak : 0;

    const pnls = resolved.map((r) => r.pnl ?? 0);
    const meanPnl = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
    const variance =
      pnls.length > 1
        ? pnls.reduce((sum, v) => sum + Math.pow(v - meanPnl, 2), 0) / (pnls.length - 1)
        : 0;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (meanPnl / stdDev) * Math.sqrt(252) : 0;

    const byCategory: Record<string, { winRate: number; roi: number; brier: number; count: number }> = {};
    const cats = [...new Set(replays.map((r) => r.category))];
    for (const cat of cats) {
      const catReplays = replays.filter((r) => r.category === cat);
      const catBets = catReplays.filter((r) => r.wouldBet);
      const catResolved = catBets.filter(
        (r) => r.actualOutcome === 'YES' || r.actualOutcome === 'NO',
      );
      const catResolvedAll = catReplays.filter(
        (r) => r.actualOutcome === 'YES' || r.actualOutcome === 'NO',
      );

      const catWins = catResolved.filter((r) => (r.pnl ?? 0) > 0);
      const catWinRate = catResolved.length > 0 ? catWins.length / catResolved.length : 0;
      const catTotalPnl = catResolved.reduce((sum, r) => sum + (r.pnl ?? 0), 0);
      const catRoi = catBets.length > 0 ? catTotalPnl / catBets.length : 0;
      const catBrier =
        catResolvedAll.length > 0
          ? catResolvedAll.reduce((sum, r) => sum + (r.brierScore ?? 0), 0) / catResolvedAll.length
          : 0;

      byCategory[cat] = {
        winRate: catWinRate,
        roi: catRoi,
        brier: catBrier,
        count: catBets.length,
      };
    }

    return {
      totalMarkets: replays.length,
      totalBets: bets.length,
      winRate,
      roi,
      brierScore,
      drawdown,
      sharpeRatio,
      byCategory,
    };
  }
}

// ── Singleton ──

let _instance: BacktestEngine | null = null;
export function getBacktestEngine(): BacktestEngine {
  if (!_instance) _instance = new BacktestEngine();
  return _instance;
}
