import {
  RiskEngineInput,
  RiskEngineOutput,
  RiskReasonCode,
  OrderSide,
  StrategySettings,
  StageServiceMapping,
  ClusterExposure,
  TailRiskWarning,
} from '@/lib/types';

const MAX_POSITION_SIZE = 5000;
const URGENT_EDGE_THRESHOLD = 0.15;
const BID_EDGE_THRESHOLD = 0.05;
const WATCH_EDGE_THRESHOLD = 0.02;
const BID_CONFIDENCE_THRESHOLD = 0.6;
const WATCH_CONFIDENCE_THRESHOLD = 0.4;
const MAX_UNCERTAINTY_THRESHOLD = 0.35;
const MAX_DAILY_EXPOSURE = 50000;
const MAX_CATEGORY_EXPOSURE = 10000;
const MIN_LIQUIDITY = 1000;
const MAX_SPREAD = 0.05;
const MAX_CLUSTER_UTILIZATION = 0.8;
const MAX_CLUSTER_OVERLAP = 3;
const TAIL_RISK_MAX_SEEKED = 3;

// Absolute minimum confidence floors — cannot be overridden by DB settings.
// Prevents zeroed strategy thresholds from bypassing all quality gates.
const ABSOLUTE_MIN_BID_CONFIDENCE = 0.55;
const ABSOLUTE_MIN_WATCH_CONFIDENCE = 0.35;
const ABSOLUTE_MAX_UNCERTAINTY_THRESHOLD = 0.45;
const ABSOLUTE_MIN_LIQUIDITY = 1;

export function computeRisk(
  input: RiskEngineInput,
  clusterOpts?: {
    clusterExposures?: ClusterExposure[];
    tailRiskWarnings?: TailRiskWarning[];
    clusterOverlapCount?: number;
  },
): RiskEngineOutput {
  const minLiquidity = Math.max(input.minLiquidity ?? MIN_LIQUIDITY, ABSOLUTE_MIN_LIQUIDITY);
  const maxSpread = input.maxSpread ?? MAX_SPREAD;
  const maxDailyExposure = input.maxDailyExposure ?? MAX_DAILY_EXPOSURE;
  const maxCategoryExposure = input.maxCategoryExposure ?? MAX_CATEGORY_EXPOSURE;
  const maxPositionSize = input.maxPositionSize ?? MAX_POSITION_SIZE;
  const bidEdgeThreshold = input.bidEdgeThreshold ?? BID_EDGE_THRESHOLD;
  const watchEdgeThreshold = input.watchEdgeThreshold ?? WATCH_EDGE_THRESHOLD;
  const bidConfidenceThreshold = Math.max(
    input.bidConfidenceThreshold ?? BID_CONFIDENCE_THRESHOLD,
    ABSOLUTE_MIN_BID_CONFIDENCE,
  );
  const watchConfidenceThreshold = Math.max(
    input.watchConfidenceThreshold ?? WATCH_CONFIDENCE_THRESHOLD,
    ABSOLUTE_MIN_WATCH_CONFIDENCE,
  );
  const maxUncertaintyThreshold = Math.min(input.maxUncertaintyThreshold ?? MAX_UNCERTAINTY_THRESHOLD, ABSOLUTE_MAX_UNCERTAINTY_THRESHOLD);
  const edge = Math.abs(input.judgeProbability - input.impliedProbability);
  const effectiveEdge = edge - input.fees - input.slippage;

  if (input.marketLiquidity < minLiquidity) {
    return skip('LOW_LIQUIDITY', `Market liquidity ${input.marketLiquidity} below minimum ${minLiquidity}`, edge, input);
  }

  if (input.marketSpread > maxSpread) {
    return skip('WIDE_SPREAD', `Market spread ${(input.marketSpread * 100).toFixed(2)}% exceeds max ${(maxSpread * 100).toFixed(2)}%`, edge, input);
  }

  if (input.dailyExposure >= maxDailyExposure) {
    return skip('DAILY_LIMIT_REACHED', `Daily exposure ${input.dailyExposure} reached limit ${maxDailyExposure}`, edge, input);
  }

  if (input.categoryExposure >= maxCategoryExposure) {
    return skip('CORRELATED_RISK', `Category exposure ${input.categoryExposure} reached limit ${maxCategoryExposure}`, edge, input);
  }

  // ── Phase 10: Cluster exposure limit check ──
  if (clusterOpts?.clusterExposures?.length) {
    for (const ce of clusterOpts.clusterExposures) {
      if (ce.utilization >= MAX_CLUSTER_UTILIZATION) {
        return skip(
          'CLUSTER_EXPOSURE_EXCEEDED',
          `Cluster "${ce.clusterKey}" (${ce.clusterType}) utilization ${(ce.utilization * 100).toFixed(0)}% exceeds ${(MAX_CLUSTER_UTILIZATION * 100).toFixed(0)}% limit`,
          edge,
          input,
        );
      }
    }
  }

  // ── Phase 10: Correlation cluster overlap check ──
  if (clusterOpts?.clusterOverlapCount != null && clusterOpts.clusterOverlapCount >= MAX_CLUSTER_OVERLAP) {
    return skip(
      'CORRELATION_CLUSTER_OVERLAP',
      `Market belongs to ${clusterOpts.clusterOverlapCount} overlapping risk clusters (max ${MAX_CLUSTER_OVERLAP})`,
      edge,
      input,
    );
  }

  // ── Phase 10: Tail-risk check ──
  if (!input.ignoreTailRiskWarnings && clusterOpts?.tailRiskWarnings?.length) {
    const criticalWarnings = clusterOpts.tailRiskWarnings.filter(
      w => w.severity === 'CRITICAL' || w.severity === 'HIGH',
    );
    if (criticalWarnings.length > 0) {
      const top = criticalWarnings[0];
      if (top.winsWiped >= TAIL_RISK_MAX_SEEKED) {
        return skip(
          'TAIL_RISK_HIGH',
          `Tail-risk critical: 1 loss on "${top.marketTitle ?? top.marketId}" ($${top.lossAmount.toFixed(0)}) wipes ${top.winsWiped} wins`,
          edge,
          input,
        );
      }
    }
  }

  if (input.catalystTiming === 'CLOSE') {
    return skip('CATALYST_TOO_CLOSE', 'Major catalyst expected within 2 hours, avoiding position', edge, input);
  }

  if (input.uncertainty > maxUncertaintyThreshold) {
    return watch('HIGH_UNCERTAINTY', `Uncertainty ${(input.uncertainty * 100).toFixed(0)}% exceeds ${(maxUncertaintyThreshold * 100).toFixed(0)}% — monitor for improvement`, edge, input);
  }

  if (effectiveEdge < 0) {
    return skip('LOW_EDGE', `Effective edge ${effectiveEdge.toFixed(4)} is negative after fees (${input.fees}) and slippage (${input.slippage})`, edge, input);
  }

  if (input.confidence < watchConfidenceThreshold) {
    return skip('LOW_CONFIDENCE', `Confidence ${(input.confidence * 100).toFixed(0)}% too low for any position`, edge, input);
  }

  // ── BID: Strong edge + high confidence ──
  if (effectiveEdge >= bidEdgeThreshold && input.confidence >= bidConfidenceThreshold) {
    const baseSize = computePositionSize(effectiveEdge, input.confidence, input.uncertainty);
    const adjustedSize = Math.min(
      baseSize,
      maxPositionSize,
      input.remainingMarketCapacity ?? maxPositionSize,
      input.remainingDailyCapacity ?? maxDailyExposure,
      input.remainingCategoryCapacity ?? maxCategoryExposure,
    );
    const side: OrderSide = input.judgeProbability > input.impliedProbability ? 'YES' : 'NO';
    const urgency = computeUrgency(effectiveEdge, input.confidence);
    return {
      action: 'BID',
      side,
      maxSize: baseSize,
      adjustedSize: Math.max(0, adjustedSize),
      urgency,
      reason: `Strong edge ${(effectiveEdge * 100).toFixed(1)}% with ${(input.confidence * 100).toFixed(0)}% confidence — BID`,
      edge: effectiveEdge,
      fees: input.fees,
      slippage: input.slippage,
    };
  }

  // ── WATCH: Moderate edge or moderate confidence ──
  if (effectiveEdge >= watchEdgeThreshold || (effectiveEdge >= 0 && input.confidence >= watchConfidenceThreshold && input.confidence < bidConfidenceThreshold)) {
    return watch(
      'MODERATE_EDGE',
      `Edge ${(effectiveEdge * 100).toFixed(1)}% with ${(input.confidence * 100).toFixed(0)}% confidence — WATCH for improvement`,
      edge,
      input,
    );
  }

  return skip('INSUFFICIENT_EDGE', `Edge ${(effectiveEdge * 100).toFixed(1)}% too thin with ${(input.confidence * 100).toFixed(0)}% confidence`, edge, input);
}

function skip(reasonCode: RiskReasonCode, reason: string, edge: number, input: RiskEngineInput): RiskEngineOutput {
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

function watch(reasonCode: RiskReasonCode, reason: string, edge: number, input: RiskEngineInput): RiskEngineOutput {
  return {
    action: 'WATCH',
    maxSize: 0,
    adjustedSize: 0,
    urgency: 'MEDIUM',
    reasonCode,
    reason,
    edge,
    fees: input.fees,
    slippage: input.slippage,
  };
}

export function computePositionSize(edge: number, confidence: number, uncertainty: number): number {
  if (uncertainty >= 0.9999 || edge < 0) {
    return 0;
  }
  const kellyFraction = edge / (1 - uncertainty);
  const conservativeKelly = kellyFraction * 0.25;
  const confidenceMultiplier = 0.5 + confidence * 0.5;
  const size = MAX_POSITION_SIZE * conservativeKelly * confidenceMultiplier;
  const rounded = Math.round(Math.max(0, Math.min(size, MAX_POSITION_SIZE)) * 100) / 100;
  if (rounded > 0) return rounded;
  if (edge > 0 && confidence >= 0.1) return 100;
  return 0;
}

function computeUrgency(edge: number, confidence: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMEDIATE' {
  if (edge >= URGENT_EDGE_THRESHOLD && confidence >= 0.8) return 'IMMEDIATE';
  if (edge >= 0.1 && confidence >= 0.7) return 'HIGH';
  if (edge >= 0.05) return 'MEDIUM';
  return 'LOW';
}

export const DEFAULT_STAGE_ROUTING: StageServiceMapping = {
  // All model fields left undefined — model-fallback.ts auto-discovers from LLM endpoint
  triageModel: undefined,
  bullModel: undefined,
  bearModel: undefined,
  contradictionModel: undefined,
  judgeModel: undefined,
  // deerflowModel / deerflowFallbackModels removed — DeerFlow disabled
  newsAnalystModel: undefined,
  sentimentAnalystModel: undefined,
  technicalAnalystModel: undefined,
  analystDeepThinkLlm: undefined,
  analystQuickThinkLlm: undefined,
  analystLlmProvider: 'openai',
  analystMaxDebateRounds: 3,
  searchService: undefined,
  searchMaxResults: 100,
  vectorDbCollection: undefined,
  embeddingProvider: undefined,
  researchDepth: 'FULL',
  agentReachEnabled: true,
  agentReachServiceUrl: process.env.AGENT_REACH_URL || '',
  agentReachToolName: 'web_read',
  mirofishPredictionModel: undefined,
  researchFallbackProvider: 'firecrawl',
};

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
  defaultModel: undefined,
  triageModel: undefined,
  researchModel: undefined,
  judgeModel: undefined,
  maxMarketsPerScan: 500,
  maxPagesPerVenue: 10,
  scanUntilNoCursor: false,
  scanMode: 'INCREMENTAL_SCAN',
  scanRateLimitMs: 500,
  scanTimeoutMs: 15000,
  orderExpiryMinutes: 1440,
  orderbookPenaltyMode: 'STRICT',
  missingOrderbookPenalty: 15,
  stageRouting: DEFAULT_STAGE_ROUTING,
};
