// ── Wang Transform Bias Correction Engine ──
// Converts naive market prices to bias-adjusted fair probabilities
// based on favorite-longshot bias observed in prediction markets.
import { db } from '@/lib/db';

export interface BiasModelVersion {
  version: number;
  createdAt: Date;
  resolvedMarketCount: number;
  categoryParams: Record<string, { wangLambda: number; offset: number }>;
  fallbackLambda: number;
  fallbackOffset: number;
  isActive: boolean;
}

export interface BiasModelVersionParams {
  category: string;
  probabilityBucketLow: number;
  probabilityBucketHigh: number;
  sampleSize: number;
  observedFrequency: number;
  marketFrequency: number;
  wangLambda: number;
  offset: number;
}

export type CorrectionType = 'HEURISTIC' | 'CATEGORY_CALIBRATED' | 'GLOBAL_CALIBRATED';

export interface BiasCorrectionInput {
  marketPrice: number;
  category: string;
  timeToResolution: number;
  liquidity: number;
  contractType?: string;
  modelVersion?: BiasModelVersion;
  /** Array of persisted BiasModelVersion bucket records for a category (or global 'ALL') */
  biasModel?: BiasModelVersionParams[];
}

export interface BiasCorrectionOutput {
  biasAdjustedProb: number;
  favoriteLongshotBias: number;
  correctionConfidence: number;
  correctionDirection: string;
  correctionMagnitude: number;
  usedModelVersion: boolean;
  sampleSufficient: boolean;
  correctionType: CorrectionType;
}

const MIN_SAMPLES_FOR_CATEGORY_CORRECTION = 50;

export function shouldTrustCategoryCorrection(category: string, sampleCount: number): boolean {
  const key = category.toLowerCase();
  return sampleCount >= MIN_SAMPLES_FOR_CATEGORY_CORRECTION && key in CATEGORY_BIAS_ADJ;
}

// ── Numerical helpers: erf / erfinv ──

/** Abramowitz & Stegun approximation for error function */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const a = 0.147;
  const ax = Math.abs(x);
  const t = 1 / (1 + a * ax);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** Inverse error function via simple Newton iteration */
function erfinv(y: number): number {
  if (y >= 1 - 1e-15) return 10;
  if (y <= -1 + 1e-15) return -10;
  let x = 0;
  for (let i = 0; i < 5; i++) {
    const e = erf(x);
    const diff = e - y;
    const deriv = (2 / Math.sqrt(Math.PI)) * Math.exp(-x * x);
    x -= diff / deriv;
  }
  return x;
}

// ── Standard Normal CDF & inverse ──

/** Φ(x) = cumulative standard normal distribution */
function phiNorm(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Φ⁻¹(p) = inverse standard normal CDF */
function phiNormInv(p: number): number {
  const safe = Math.max(1e-15, Math.min(1 - 1e-15, p));
  return Math.SQRT2 * erfinv(2 * safe - 1);
}

// ── Category bias adjustments ──
const CATEGORY_BIAS_ADJ: Record<string, number> = {
  politics: 0.05,
  sports: -0.05,
  crypto: 0.08,
  science: 0.0,
  entertainment: 0.02,
  economics: 0.03,
  technology: 0.02,
  health: 0.01,
  weather: -0.02,
};

function getCategoryAdjustment(category: string): number {
  const key = category.toLowerCase();
  return CATEGORY_BIAS_ADJ[key] ?? 0;
}

/** Compute λ using linear interpolation across probability bucket boundaries */
function getSmoothLambda(p: number): number {
  if (p <= 0.001) return 0.35;
  if (p >= 0.999) return -0.25;

  const thresholds = [0.001, 0.10, 0.30, 0.50, 0.70, 0.90, 0.999];
  const lambdas = [0.35, 0.30, 0.15, 0.0, -0.05, -0.15, -0.25];

  for (let i = 0; i < thresholds.length - 1; i++) {
    if (p >= thresholds[i] && p <= thresholds[i + 1]) {
      const t = (p - thresholds[i]) / (thresholds[i + 1] - thresholds[i]);
      return lambdas[i] + t * (lambdas[i + 1] - lambdas[i]);
    }
  }
  return 0;
}

// ── Wang Transform ──

function wangTransform(p: number, lambda: number): number {
  const safe = Math.max(1e-15, Math.min(1 - 1e-15, p));
  const z = phiNormInv(safe) - lambda;
  return phiNorm(z);
}

// ── Main exports ──

export function getBiasModelVersion(resolvedMarketCount: number): BiasModelVersion {
  return {
    version: 1,
    createdAt: new Date(Date.UTC(2026, 4, 17)),
    resolvedMarketCount,
    categoryParams: {
      politics: { wangLambda: 0.05, offset: 0.01 },
      sports: { wangLambda: -0.05, offset: -0.01 },
      crypto: { wangLambda: 0.08, offset: 0.02 },
      science: { wangLambda: 0.0, offset: 0.0 },
      entertainment: { wangLambda: 0.02, offset: 0.005 },
      economics: { wangLambda: 0.03, offset: 0.01 },
      technology: { wangLambda: 0.02, offset: 0.005 },
      health: { wangLambda: 0.01, offset: 0.0 },
      weather: { wangLambda: -0.02, offset: -0.005 },
    },
    fallbackLambda: 0.02,
    fallbackOffset: 0.0,
    isActive: resolvedMarketCount >= MIN_SAMPLES_FOR_CATEGORY_CORRECTION,
  };
}

function findBucket(p: number, buckets: BiasModelVersionParams[]): BiasModelVersionParams | null {
  for (const b of buckets) {
    if (p >= b.probabilityBucketLow && p < b.probabilityBucketHigh) return b;
  }
  if (p >= 0.9999) {
    const last = buckets[buckets.length - 1];
    if (last && last.probabilityBucketHigh >= 0.9999) return last;
  }
  return null;
}

export function computeBiasAdjustedProb(input: BiasCorrectionInput): BiasCorrectionOutput {
  const { marketPrice, category, timeToResolution, liquidity, modelVersion, biasModel } = input;

  const persistedBucket = biasModel ? findBucket(marketPrice, biasModel) : null;
  const usePersistedModel = persistedBucket !== null && persistedBucket.sampleSize >= MIN_SAMPLES_FOR_CATEGORY_CORRECTION;

  let correctionType: CorrectionType = 'HEURISTIC';
  if (usePersistedModel) {
    const isGlobal = biasModel!.some(b => b.category === 'ALL');
    correctionType = isGlobal ? 'GLOBAL_CALIBRATED' : 'CATEGORY_CALIBRATED';
  }

  const sampleSufficient = modelVersion
    ? modelVersion.isActive && modelVersion.resolvedMarketCount >= MIN_SAMPLES_FOR_CATEGORY_CORRECTION
    : false;
  const usedModelVersion = modelVersion !== undefined && sampleSufficient;

  const p = Math.max(0.0001, Math.min(0.9999, marketPrice));
  const baseLambda = getSmoothLambda(p);
  const timeFactor = Math.max(0.1, Math.min(1, timeToResolution / 30));
  const liquidityFactor = Math.max(0.2, Math.min(1, liquidity / 10000));

  let lambda: number;
  if (usePersistedModel) {
    lambda = persistedBucket!.wangLambda * timeFactor * liquidityFactor;
  } else {
    let categoryAdj: number;
    if (usedModelVersion) {
      const cp = modelVersion!.categoryParams[category.toLowerCase()];
      categoryAdj = cp ? cp.wangLambda : modelVersion!.fallbackLambda;
    } else {
      categoryAdj = getCategoryAdjustment(category);
    }
    lambda = baseLambda * timeFactor * liquidityFactor + categoryAdj * (1 - timeFactor * liquidityFactor);
  }

  const adjusted = wangTransform(p, lambda);
  const biasAdjustedProb = Math.max(0.0001, Math.min(0.9999, adjusted));
  const correctionMagnitude = Math.abs(biasAdjustedProb - p);

  let favoriteLongshotBias: number;
  let correctionDirection: string;

  if (lambda > 0.01) {
    favoriteLongshotBias = -Math.min(1, lambda / 0.5);
    correctionDirection = 'LONGSHOT';
  } else if (lambda < -0.01) {
    favoriteLongshotBias = Math.min(1, Math.abs(lambda) / 0.5);
    correctionDirection = 'FAVORITE';
  } else {
    favoriteLongshotBias = 0;
    correctionDirection = 'NONE';
  }

  const confidenceBase = liquidityFactor * 0.7 + timeFactor * 0.3;
  const correctionConfidence = Math.max(0.1, Math.min(1, confidenceBase * (1 - Math.exp(-liquidity / 5000))));

  return {
    biasAdjustedProb,
    favoriteLongshotBias,
    correctionConfidence,
    correctionDirection,
    correctionMagnitude,
    usedModelVersion,
    sampleSufficient,
    correctionType,
  };
}

// ── Persisted bias model training ──

const PROB_BUCKETS: Array<[number, number]> = [
  [0, 0.1], [0.1, 0.2], [0.2, 0.3], [0.3, 0.4], [0.4, 0.5],
  [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.0],
];

function getBucketIndex(p: number): number {
  return Math.max(0, Math.min(9, Math.floor(Math.max(0, Math.min(0.9999, p)) * 10)));
}

export async function trainBiasModelFromResolved(): Promise<number> {
  const resolvedBets = await db.paperBet.findMany({
    where: {
      actualOutcome: { not: null },
      executionStatus: { in: ['FILLED', 'PARTIAL'] },
    },
    include: { market: { select: { category: true } } },
  });
  if (resolvedBets.length === 0) return 0;

  const latestVersion = await db.biasModelVersion.findFirst({ orderBy: { version: 'desc' } });
  const nextVersion = (latestVersion?.version ?? 0) + 1;

  const catBuckets: Record<string, {
    category: string; bucketLow: number; bucketHigh: number;
    yesCount: number; totalCount: number; impliedSum: number;
  }> = {};

  const globalBuckets: Record<number, { yesCount: number; totalCount: number; impliedSum: number }> = {};

  for (const bet of resolvedBets) {
    const cat = (bet.market.category || 'uncategorized').toLowerCase();
    const bucketIdx = getBucketIndex(bet.impliedProb);
    const [bucketLow, bucketHigh] = PROB_BUCKETS[bucketIdx];

    const ck = `${cat}:${bucketLow}:${bucketHigh}`;
    if (!catBuckets[ck]) {
      catBuckets[ck] = { category: cat, bucketLow, bucketHigh, yesCount: 0, totalCount: 0, impliedSum: 0 };
    }
    catBuckets[ck].totalCount++;
    catBuckets[ck].impliedSum += bet.impliedProb;
    if (bet.actualOutcome === 'YES') catBuckets[ck].yesCount++;

    if (!globalBuckets[bucketIdx]) {
      globalBuckets[bucketIdx] = { yesCount: 0, totalCount: 0, impliedSum: 0 };
    }
    globalBuckets[bucketIdx].totalCount++;
    globalBuckets[bucketIdx].impliedSum += bet.impliedProb;
    if (bet.actualOutcome === 'YES') globalBuckets[bucketIdx].yesCount++;
  }

  let totalCreated = 0;
  const catTotals: Record<string, number> = {};

  for (const [, data] of Object.entries(catBuckets)) {
    const observedFreq = data.yesCount / data.totalCount;
    const marketFreq = data.impliedSum / data.totalCount;
    const lambda = phiNormInv(observedFreq) - phiNormInv(marketFreq);
    const offset = observedFreq - marketFreq;

    catTotals[data.category] = (catTotals[data.category] || 0) + data.totalCount;

    await db.biasModelVersion.create({
      data: {
        version: nextVersion,
        category: data.category,
        probabilityBucketLow: data.bucketLow,
        probabilityBucketHigh: data.bucketHigh,
        sampleSize: data.totalCount,
        observedFrequency: observedFreq,
        marketFrequency: marketFreq,
        wangLambda: lambda,
        offset,
        status: 'TESTING',
      },
    });
    totalCreated++;
  }

  for (const [cat, total] of Object.entries(catTotals)) {
    if (total >= MIN_SAMPLES_FOR_CATEGORY_CORRECTION) {
      await db.biasModelVersion.updateMany({
        where: { version: nextVersion, category: cat },
        data: { status: 'CATEGORY_CALIBRATED' },
      });
    }
  }

  if (resolvedBets.length >= 500) {
    for (let i = 0; i < 10; i++) {
      const data = globalBuckets[i];
      if (!data) continue;
      const [bucketLow, bucketHigh] = PROB_BUCKETS[i];
      const observedFreq = data.yesCount / data.totalCount;
      const marketFreq = data.impliedSum / data.totalCount;
      const lambda = phiNormInv(observedFreq) - phiNormInv(marketFreq);
      const offset = observedFreq - marketFreq;

      await db.biasModelVersion.create({
        data: {
          version: nextVersion,
          category: 'ALL',
          probabilityBucketLow: bucketLow,
          probabilityBucketHigh: bucketHigh,
          sampleSize: data.totalCount,
          observedFrequency: observedFreq,
          marketFrequency: marketFreq,
          wangLambda: lambda,
          offset,
          status: 'GLOBAL_CALIBRATED',
        },
      });
      totalCreated++;
    }
  }

  return totalCreated;
}

export async function getLatestBiasModel(category?: string): Promise<BiasModelVersionParams[] | null> {
  const latest = await db.biasModelVersion.findFirst({
    where: { status: { in: ['CATEGORY_CALIBRATED', 'GLOBAL_CALIBRATED'] } },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  if (!latest) return null;

  const whereFilter: Record<string, unknown> = {
    version: latest.version,
    status: { in: ['CATEGORY_CALIBRATED', 'GLOBAL_CALIBRATED'] },
  };
  if (category) whereFilter.category = category.toLowerCase();

  const records = await db.biasModelVersion.findMany({
    where: whereFilter,
    orderBy: { probabilityBucketLow: 'asc' },
  });

  if (records.length === 0) return null;

  return records.map((r) => ({
    category: r.category,
    probabilityBucketLow: r.probabilityBucketLow,
    probabilityBucketHigh: r.probabilityBucketHigh,
    sampleSize: r.sampleSize,
    observedFrequency: r.observedFrequency,
    marketFrequency: r.marketFrequency,
    wangLambda: r.wangLambda,
    offset: r.offset,
  }));
}
