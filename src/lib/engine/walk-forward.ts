// ── Walk-Forward Validator (Phase 15) ──
// Rolling train/test windows over historical data.
// For each window: train on period A, test on period B, roll forward, repeat.
// Detects overfitting: test ROI drops >50% vs train ROI.

import { getBacktestEngine } from './backtest-engine';
import type { BacktestConfig, BacktestMetrics } from './backtest-engine';

// ── Types ──

export interface WalkForwardConfig {
  /** Overall start date for the entire walk-forward run */
  overallStart: Date;
  /** Overall end date for the entire walk-forward run */
  overallEnd: Date;
  /** Number of days in each training window */
  trainDays: number;
  /** Number of days in each test window */
  testDays: number;
  /** Number of days to step forward between windows */
  stepDays: number;
  /** Backtest configuration to use for all windows */
  strategyConfig: BacktestConfig;
  /** Optional strategy config version ID to link BacktestRun rows */
  strategyConfigVersionId?: string;
}

export interface WalkForwardWindow {
  /** 0-based index of this window */
  windowIndex: number;
  /** Train period start and end */
  trainPeriod: { start: Date; end: Date };
  /** Test period start and end */
  testPeriod: { start: Date; end: Date };
  /** Metrics from the train period backtest */
  trainMetrics: BacktestMetrics | null;
  /** Metrics from the test period backtest */
  testMetrics: BacktestMetrics | null;
  /** Whether test ROI dropped >50% vs train ROI (overfitting indicator) */
  isOverfit: boolean;
  /** Ratio of test ROI to train ROI. Values < 1 indicate performance decline. */
  metricsDecline: number | null;
}

export interface WalkForwardResult {
  /** The config used for the walk-forward */
  config: WalkForwardConfig;
  /** All rolling windows */
  windows: WalkForwardWindow[];
  /** Average ROI across all train periods */
  averageTrainROI: number;
  /** Average ROI across all test periods */
  averageTestROI: number;
  /** Correlation between train and test ROI across windows.
   * Positive = train performance predicts test. Negative = inverse. */
  trainTestCorrelation: number | null;
  /** Ratio of overfit windows to total windows */
  overfitScore: number;
}

// ── Core Function ──

/**
 * Run walk-forward validation across rolling train/test windows.
 *
 * Splits the overall period into overlapping windows:
 *   [trainDays][testDays] => step forward by stepDays => repeat
 *
 * For each window, runs a full backtest on the train period (mode: 'TRAIN')
 * and test period (mode: 'TEST'), compares performance, and flags overfitting.
 *
 * Gracefully handles empty periods: if no markets found in a window, yields
 * zero-metric results rather than throwing.
 */
export async function runWalkForward(config: WalkForwardConfig): Promise<WalkForwardResult> {
  const engine = getBacktestEngine();
  const windows: WalkForwardWindow[] = [];

  const msPerDay = 24 * 60 * 60 * 1000;
  const overallStartMs = config.overallStart.getTime();
  const overallEndMs = config.overallEnd.getTime();
  const trainMs = config.trainDays * msPerDay;
  const testMs = config.testDays * msPerDay;
  const stepMs = config.stepDays * msPerDay;

  let windowIndex = 0;

  // Slide forward in step increments
  for (
    let cursor = overallStartMs;
    cursor + trainMs + testMs <= overallEndMs;
    cursor += stepMs
  ) {
    const trainStart = new Date(cursor);
    const trainEnd = new Date(cursor + trainMs - 1);
    const testStart = new Date(cursor + trainMs);
    const testEnd = new Date(cursor + trainMs + testMs - 1);

    let trainMetrics: BacktestMetrics | null = null;
    let testMetrics: BacktestMetrics | null = null;

    // Run train backtest — catch empty-period gracefully
    try {
      const trainResult = await engine.runBacktest(config.strategyConfig, {
        periodStart: trainStart,
        periodEnd: trainEnd,
        strategyConfigId: config.strategyConfigVersionId,
        mode: 'TRAIN',
      });
      trainMetrics = trainResult.metrics;
    } catch (_err) {
      // Zero metrics for empty/no-snapshot periods
      trainMetrics = emptyMetrics();
    }

    // Run test backtest — catch empty-period gracefully
    try {
      const testResult = await engine.runBacktest(config.strategyConfig, {
        periodStart: testStart,
        periodEnd: testEnd,
        strategyConfigId: config.strategyConfigVersionId,
        mode: 'TEST',
      });
      testMetrics = testResult.metrics;
    } catch (_err) {
      testMetrics = emptyMetrics();
    }

    // Determine overfitting: test ROI drops >50% vs train ROI
    const trainROI = trainMetrics?.roi ?? 0;
    const testROI = testMetrics?.roi ?? 0;
    const isOverfit = trainROI > 0 && testROI < trainROI * 0.5;
    const metricsDecline = trainROI !== 0 && trainROI != null ? testROI / trainROI : null;

    windows.push({
      windowIndex,
      trainPeriod: { start: trainStart, end: trainEnd },
      testPeriod: { start: testStart, end: testEnd },
      trainMetrics,
      testMetrics,
      isOverfit,
      metricsDecline,
    });

    windowIndex++;
  }

  // Aggregate across windows
  const trainROIs = windows.map((w) => w.trainMetrics?.roi ?? 0);
  const testROIs = windows.map((w) => w.testMetrics?.roi ?? 0);

  const averageTrainROI =
    trainROIs.length > 0 ? trainROIs.reduce((a, b) => a + b, 0) / trainROIs.length : 0;
  const averageTestROI =
    testROIs.length > 0 ? testROIs.reduce((a, b) => a + b, 0) / testROIs.length : 0;

  const trainTestCorrelation = computeCorrelation(trainROIs, testROIs);

  const overfitCount = windows.filter((w) => w.isOverfit).length;
  const overfitScore = windows.length > 0 ? overfitCount / windows.length : 0;

  return {
    config,
    windows,
    averageTrainROI,
    averageTestROI,
    trainTestCorrelation,
    overfitScore,
  };
}

// ── Helpers ──

/** Return a zero-value BacktestMetrics for empty/no-snapshot periods. */
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

/**
 * Compute Pearson correlation coefficient between two arrays.
 * Returns null if fewer than 3 data points or zero variance in either array.
 */
function computeCorrelation(xs: number[], ys: number[]): number | null {
  if (xs.length < 3 || ys.length < 3) return null;

  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let cov = 0;
  let varX = 0;
  let varY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    cov += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  if (varX === 0 || varY === 0) return null;

  return cov / Math.sqrt(varX * varY);
}
