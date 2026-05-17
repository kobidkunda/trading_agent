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

export function computeRisk(
  input: RiskEngineInput,
  clusterOpts?: {
    clusterExposures?: ClusterExposure[];
    tailRiskWarnings?: TailRiskWarning[];
    clusterOverlapCount?: number;
  },
): RiskEngineOutput {
  const minLiquidity = input.minLiquidity ?? MIN_LIQUIDITY;
  const maxSpread = input.maxSpread ?? MAX_SPREAD;
  const maxDailyExposure = input.maxDailyExposure ?? MAX_DAILY_EXPOSURE;
  const maxCategoryExposure = input.maxCategoryExposure ?? MAX_CATEGORY_EXPOSURE;
  const maxPositionSize = input.maxPositionSize ?? MAX_POSITION_SIZE;
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
  if (clusterOpts?.tailRiskWarnings?.length) {
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

  if (input.uncertainty > MAX_UNCERTAINTY_THRESHOLD) {
    return watch('HIGH_UNCERTAINTY', `Uncertainty ${(input.uncertainty * 100).toFixed(0)}% exceeds ${(MAX_UNCERTAINTY_THRESHOLD * 100).toFixed(0)}% — monitor for improvement`, edge, input);
  }

  if (effectiveEdge < 0) {
    return skip('LOW_EDGE', `Effective edge ${effectiveEdge.toFixed(4)} is negative after fees (${input.fees}) and slippage (${input.slippage})`, edge, input);
  }

  if (input.confidence < WATCH_CONFIDENCE_THRESHOLD) {
    return skip('LOW_CONFIDENCE', `Confidence ${(input.confidence * 100).toFixed(0)}% too low for any position`, edge, input);
  }

  // ── BID: Strong edge + high confidence ──
  if (effectiveEdge >= BID_EDGE_THRESHOLD && input.confidence >= BID_CONFIDENCE_THRESHOLD) {
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
  if (effectiveEdge >= WATCH_EDGE_THRESHOLD || (effectiveEdge >= 0 && input.confidence >= WATCH_CONFIDENCE_THRESHOLD && input.confidence < BID_CONFIDENCE_THRESHOLD)) {
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
  const kellyFraction = edge / (1 - uncertainty);
  const conservativeKelly = kellyFraction * 0.25;
  const confidenceMultiplier = 0.5 + confidence * 0.5;
  const size = MAX_POSITION_SIZE * conservativeKelly * confidenceMultiplier;
  return Math.round(Math.max(0, Math.min(size, MAX_POSITION_SIZE)) * 100) / 100;
}

function computeUrgency(edge: number, confidence: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'IMMEDIATE' {
  if (edge >= URGENT_EDGE_THRESHOLD && confidence >= 0.8) return 'IMMEDIATE';
  if (edge >= 0.1 && confidence >= 0.7) return 'HIGH';
  if (edge >= 0.05) return 'MEDIUM';
  return 'LOW';
}

export const DEFAULT_STAGE_ROUTING: StageServiceMapping = {
  triageModel: 'paper_prokimi',
  triageFallbackModels: ['paper_proglm', 'paper_flashmimi', 'paper_lite'],
  bullModel: 'paper_prokimi',
  bullFallbackModels: ['paper_proglm', 'paper_flashmimi', 'paper_lite'],
  bearModel: 'paper_prokimi',
  bearFallbackModels: ['paper_proglm', 'paper_flashmimi', 'paper_lite'],
  contradictionModel: 'paper_proglm',
  contradictionFallbackModels: ['paper_prokimi', 'paper_flashmimi', 'paper_lite'],
  judgeModel: 'paper_proglm',
  judgeFallbackModels: ['paper_prokimi', 'paper_flashmimi', 'paper_lite'],
  deerflowModel: 'paper_proglm',
  deerflowFallbackModels: ['paper_prokimi', 'paper_flashmimi', 'paper_lite'],
  newsAnalystModel: 'paper_prokimi',
  newsAnalystFallbackModels: ['paper_proglm', 'paper_flashmimi', 'paper_lite'],
  sentimentAnalystModel: 'paper_prokimi',
  sentimentAnalystFallbackModels: ['paper_proglm', 'paper_flashmimi', 'paper_lite'],
  technicalAnalystModel: 'paper_prokimi',
  technicalAnalystFallbackModels: ['paper_proglm', 'paper_flashmimi', 'paper_lite'],
  analystDeepThinkLlm: 'paper_proglm',
  analystDeepThinkFallbackModels: ['paper_prokimi', 'paper_flashmimi', 'paper_lite'],
  analystQuickThinkLlm: 'paper_prokimi',
  analystQuickThinkFallbackModels: ['paper_proglm', 'paper_flashmimi', 'paper_lite'],
  analystLlmProvider: 'openai',
  analystMaxDebateRounds: 3,
  searchService: undefined,
  searchMaxResults: 100,
  vectorDbCollection: undefined,
  embeddingProvider: undefined,
  deerflowSearchIterations: 3,
  deerflowQuestionsPerIteration: 3,
  deerflowMaxDepth: 3,
  researchDepth: 'FULL',
  agentReachEnabled: true,
  agentReachServiceUrl: process.env.AGENT_REACH_URL || 'http://192.168.88.96:7234',
  agentReachToolName: 'web_read',
  mirofishPredictionModel: 'free_ling',
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
  defaultModel: 'paper_lite',
  triageModel: 'paper_prokimi',
  researchModel: 'paper_lite',
  judgeModel: 'paper_proglm',
  stageRouting: DEFAULT_STAGE_ROUTING,
};
