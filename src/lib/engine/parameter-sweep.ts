// ── Parameter Sweeper (Phase 16) ──
// Grid search across config thresholds. Generates Cartesian product of param ranges,
// runs backtest for each combination, sorts by ROI, stores best as StrategyConfigVersion.

import { db } from '@/lib/db';
import { getBacktestEngine } from './backtest-engine';
import type { BacktestConfig, BacktestMetrics } from './backtest-engine';

// ── Types ──

export interface ParamRange {
  paramName: string;
  values: number[];
}

export interface SweepConfig {
  /** Parameter ranges to sweep over */
  paramRanges: ParamRange[];
  /** Base configuration to clone and modify */
  baseConfig: BacktestConfig;
  /** Backtest period start */
  periodStart: Date;
  /** Backtest period end */
  periodEnd: Date;
  /** Strategy config ID to link backtest runs */
  strategyConfigId: string;
  /** Maximum combinations to test. If exceeded, random sampling is used. */
  maxCombinations: number;
}

export interface SweepEntry {
  config: BacktestConfig;
  metrics: BacktestMetrics;
  roi: number;
  brierScore: number;
  winRate: number;
  /** 1-based rank (1 = highest ROI) */
  rank: number;
}

export interface SweepResult {
  /** All sweep entries sorted by ROI descending */
  entries: SweepEntry[];
  /** Configuration with highest ROI */
  bestConfig: BacktestConfig;
  /** ROI of the best configuration */
  bestRoi: number;
  /** Total number of combinations tested */
  totalTested: number;
  /** When the sweep completed */
  timestamp: string;
}

// ── Constants ──

const DEFAULT_MAX_COMBINATIONS = 50;

// ── Core Function ──

export async function runParameterSweep(config: SweepConfig): Promise<SweepResult> {
  const engine = getBacktestEngine();

  // Generate all combinations
  let combinations = generateCombinations(config.paramRanges, config.baseConfig);

  // Randomly sample if too many
  const maxCombos = config.maxCombinations > 0 ? config.maxCombinations : DEFAULT_MAX_COMBINATIONS;
  if (combinations.length > maxCombos) {
    combinations = shuffleAndPick(combinations, maxCombos);
  }

  const entries: SweepEntry[] = [];

  for (const combo of combinations) {
    try {
      const { metrics } = await engine.runBacktest(combo, {
        periodStart: config.periodStart,
        periodEnd: config.periodEnd,
        strategyConfigId: config.strategyConfigId,
        mode: 'SWEEP',
      });

      entries.push({
        config: combo,
        metrics,
        roi: metrics.roi,
        brierScore: metrics.brierScore,
        winRate: metrics.winRate,
        rank: 0,
      });
    } catch (_err) {
      // Skip failed combinations — likely no markets in period
      entries.push({
        config: combo,
        metrics: emptyMetrics(),
        roi: 0,
        brierScore: 0,
        winRate: 0,
        rank: 0,
      });
    }
  }

  // Sort by ROI descending, assign ranks
  entries.sort((a, b) => b.roi - a.roi);
  for (let i = 0; i < entries.length; i++) {
    entries[i].rank = i + 1;
  }

  const bestEntry = entries[0];
  const bestConfig = bestEntry?.config ?? config.baseConfig;
  const bestRoi = bestEntry?.roi ?? 0;
  const totalTested = entries.length;

  try {
    const latest = await db.strategyConfigVersion.findFirst({
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const sweepMeta = {
      sweepTimestamp: new Date().toISOString(),
      totalTested,
      bestRoi,
      paramRanges: config.paramRanges.map((r) => ({
        paramName: r.paramName,
        values: r.values,
        sampled: combinations.length,
      })),
    };

    const created = await db.strategyConfigVersion.create({
      data: {
        version: nextVersion,
        name: `Sweep Best v${nextVersion} (ROI: ${(bestRoi * 100).toFixed(1)}%)`,
        config: JSON.stringify(bestConfig),
        status: 'DRAFT',
        notes: JSON.stringify(sweepMeta),
        aPlusROI: bestRoi,
        brierScore: bestEntry?.brierScore ?? undefined,
        drawdown: bestEntry?.metrics?.drawdown ?? undefined,
        sampleSize: totalTested,
        dateRangeStart: config.periodStart,
        dateRangeEnd: config.periodEnd,
      },
    });
    void created.id; // DB row stored, ID tracked for future promotion
  } catch (_err) {
    // Non-fatal: sweep results are still valid even if DB storage fails
  }

  return {
    entries,
    bestConfig,
    bestRoi,
    totalTested,
    timestamp: new Date().toISOString(),
  };
}

// ── Cartesian Product Generator ──

function generateCombinations(ranges: ParamRange[], base: BacktestConfig): BacktestConfig[] {
  if (ranges.length === 0 || ranges.every((r) => r.values.length === 0)) {
    return [deepCloneConfig(base)];
  }

  let combos: BacktestConfig[] = [deepCloneConfig(base)];

  for (const range of ranges) {
    const next: BacktestConfig[] = [];
    for (const combo of combos) {
      for (const value of range.values) {
        const modified = deepCloneConfig(combo);
        (modified as unknown as Record<string, number>)[range.paramName] = value;
        next.push(modified);
      }
    }
    combos = next;
  }

  return combos;
}

// ── Helpers ──

function deepCloneConfig(config: BacktestConfig): BacktestConfig {
  return {
    candidateScoreThreshold: config.candidateScoreThreshold,
    minAdjustedEdge: config.minAdjustedEdge,
    minLiquidity: config.minLiquidity,
    maxSpread: config.maxSpread,
    confidenceThreshold: config.confidenceThreshold,
    maxPositionSize: config.maxPositionSize,
  };
}

function shuffleAndPick<T>(arr: T[], n: number): T[] {
  const copy = [...arr];
  // Fisher-Yates shuffle
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function emptyMetrics(): BacktestMetrics {
  return {
    totalMarkets: 0,
    totalBets: 0,
    winRate: 0,
    roi: 0,
    brierScore: 0,
    drawdown: 0,
    sharpeRatio: 0,
    byCategory: {},
  };
}
