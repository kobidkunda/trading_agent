// ── Wang Transform Bias Correction Engine ──
// Converts naive market prices to bias-adjusted fair probabilities
// based on favorite-longshot bias observed in prediction markets.

export interface BiasModelVersion {
  version: number;
  createdAt: Date;
  resolvedMarketCount: number;
  categoryParams: Record<string, { wangLambda: number; offset: number }>;
  fallbackLambda: number;
  fallbackOffset: number;
  isActive: boolean;
}

export interface BiasCorrectionInput {
  marketPrice: number;
  category: string;
  timeToResolution: number;
  liquidity: number;
  contractType?: string;
  modelVersion?: BiasModelVersion;
}

export interface BiasCorrectionOutput {
  biasAdjustedProb: number;
  favoriteLongshotBias: number;
  correctionConfidence: number;
  correctionDirection: string;
  correctionMagnitude: number;
  usedModelVersion: boolean;
  sampleSufficient: boolean;
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

export function computeBiasAdjustedProb(input: BiasCorrectionInput): BiasCorrectionOutput {
  const { marketPrice, category, timeToResolution, liquidity, modelVersion } = input;

  const sampleSufficient = modelVersion
    ? modelVersion.isActive && modelVersion.resolvedMarketCount >= MIN_SAMPLES_FOR_CATEGORY_CORRECTION
    : false;
  const usedModelVersion = modelVersion !== undefined && sampleSufficient;

  const p = Math.max(0.0001, Math.min(0.9999, marketPrice));
  const baseLambda = getSmoothLambda(p);
  const timeFactor = Math.max(0.1, Math.min(1, timeToResolution / 30));
  const liquidityFactor = Math.max(0.2, Math.min(1, liquidity / 10000));

  let categoryAdj: number;
  if (usedModelVersion) {
    const cp = modelVersion!.categoryParams[category.toLowerCase()];
    categoryAdj = cp ? cp.wangLambda : modelVersion!.fallbackLambda;
  } else {
    categoryAdj = getCategoryAdjustment(category);
  }

  const lambda = baseLambda * timeFactor * liquidityFactor + categoryAdj * (1 - timeFactor * liquidityFactor);
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
  };
}
