import {
  RiskEngineInput,
  RiskEngineOutput,
  RiskReasonCode,
  OrderSide,
  StrategySettings,
} from '@/lib/types';

const MAX_POSITION_SIZE = 5000; // USDC
const URGENT_EDGE_THRESHOLD = 0.15;
const MIN_CONFIDENCE_THRESHOLD = 0.4;
const MAX_UNCERTAINTY_THRESHOLD = 0.35;
const MAX_DAILY_EXPOSURE = 50000;
const MAX_CATEGORY_EXPOSURE = 10000;
const MIN_LIQUIDITY = 1000;
const MAX_SPREAD = 0.05;
const CATALYST_CLOSE_HOURS = 2;

export function computeRisk(input: RiskEngineInput): RiskEngineOutput {
  const edge = Math.abs(input.judgeProbability - input.impliedProbability);
  const effectiveEdge = edge - input.fees - input.slippage;

  // Check: Low liquidity
  if (input.marketLiquidity < MIN_LIQUIDITY) {
    return skip(
      'LOW_LIQUIDITY',
      `Market liquidity ${input.marketLiquidity} below minimum ${MIN_LIQUIDITY}`,
      edge,
      input,
    );
  }

  // Check: Wide spread
  if (input.marketSpread > MAX_SPREAD) {
    return skip(
      'WIDE_SPREAD',
      `Market spread ${(input.marketSpread * 100).toFixed(2)}% exceeds maximum ${(MAX_SPREAD * 100).toFixed(2)}%`,
      edge,
      input,
    );
  }

  // Check: Low edge after costs
  if (effectiveEdge < 0) {
    return skip(
      'LOW_EDGE',
      `Effective edge ${effectiveEdge.toFixed(4)} is negative after fees (${input.fees}) and slippage (${input.slippage})`,
      edge,
      input,
    );
  }

  // Check: Low confidence
  if (input.confidence < MIN_CONFIDENCE_THRESHOLD) {
    return skip(
      'LOW_CONFIDENCE',
      `Judge confidence ${input.confidence.toFixed(2)} below threshold ${MIN_CONFIDENCE_THRESHOLD}`,
      edge,
      input,
    );
  }

  // Check: High uncertainty
  if (input.uncertainty > MAX_UNCERTAINTY_THRESHOLD) {
    return skip(
      'HIGH_UNCERTAINTY',
      `Uncertainty ${input.uncertainty.toFixed(2)} exceeds threshold ${MAX_UNCERTAINTY_THRESHOLD}`,
      edge,
      input,
    );
  }

  // Check: Daily limit reached
  if (input.dailyExposure >= MAX_DAILY_EXPOSURE) {
    return skip(
      'DAILY_LIMIT_REACHED',
      `Daily exposure ${input.dailyExposure} reached limit ${MAX_DAILY_EXPOSURE}`,
      edge,
      input,
    );
  }

  // Check: Category limit reached
  if (input.categoryExposure >= MAX_CATEGORY_EXPOSURE) {
    return skip(
      'CORRELATED_RISK',
      `Category exposure ${input.categoryExposure} reached limit ${MAX_CATEGORY_EXPOSURE}`,
      edge,
      input,
    );
  }

  // Check: Catalyst too close
  if (input.catalystTiming === 'CLOSE') {
    return skip(
      'CATALYST_TOO_CLOSE',
      'Major catalyst expected within 2 hours, avoiding position',
      edge,
      input,
    );
  }

  // All checks passed - compute position sizing
  const baseSize = computePositionSize(effectiveEdge, input.confidence, input.uncertainty);
  const adjustedSize = Math.min(baseSize, MAX_POSITION_SIZE - input.openPositions);
  const side: OrderSide = input.judgeProbability > input.impliedProbability ? 'YES' : 'NO';
  const urgency = computeUrgency(effectiveEdge, input.confidence);

  return {
    action: 'BUY',
    side,
    maxSize: baseSize,
    adjustedSize: Math.max(0, adjustedSize),
    urgency,
    reason: `Positive edge of ${effectiveEdge.toFixed(4)} with confidence ${input.confidence.toFixed(2)}`,
    edge: effectiveEdge,
    fees: input.fees,
    slippage: input.slippage,
  };
}

function skip(
  reasonCode: RiskReasonCode,
  reason: string,
  edge: number,
  input: RiskEngineInput,
): RiskEngineOutput {
  return {
    action: 'SKIP',
    maxSize: 0,
    adjustedSize: 0,
    urgency: 'LOW',
    reasonCode,
    reason,
    edge,
    fees: input.fees,
    slippage: input.slippage,
  };
}

function computePositionSize(edge: number, confidence: number, uncertainty: number): number {
  // Kelly-inspired sizing with conservative multiplier
  const kellyFraction = edge / (1 - uncertainty);
  const conservativeKelly = kellyFraction * 0.25; // Quarter Kelly for safety
  const confidenceMultiplier = 0.5 + confidence * 0.5; // 0.5x to 1x based on confidence
  const size = MAX_POSITION_SIZE * conservativeKelly * confidenceMultiplier;
  return Math.round(Math.max(0, Math.min(size, MAX_POSITION_SIZE)) * 100) / 100;
}

function computeUrgency(
  edge: number,
  confidence: number,
): 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMEDIATE' {
  if (edge >= URGENT_EDGE_THRESHOLD && confidence >= 0.8) return 'IMMEDIATE';
  if (edge >= 0.1 && confidence >= 0.7) return 'HIGH';
  if (edge >= 0.05) return 'MEDIUM';
  return 'LOW';
}

// Default strategy settings
export const DEFAULT_STRATEGY: StrategySettings = {
  enabledVenues: ['POLYMARKET', 'KALSHI'],
  enabledCategories: ['politics', 'sports', 'crypto', 'science', 'entertainment'],
  minLiquidity: 1000,
  targetEdge: 0.05,
  maxSpread: 0.05,
  maxExposurePerMarket: 5000,
  maxDailyExposure: 50000,
  maxCategoryExposure: 10000,
  researchEscalationThreshold: 0.08,
  dryRun: true,
  promptVersion: {
    triage: 1,
    bull: 1,
    bear: 1,
    contradiction: 1,
    judge: 1,
    postmortem: 1,
  },
};
