import { DEFAULT_APLUS_CONFIG } from '@/lib/constants';
import type { APlusSignalConfig } from '@/lib/types';

export interface APlusGateInput {
  candidateScore: number;
  adjustedEdge: number;
  confidence: number;
  resolutionClarity: number;
  spread: number;
  liquidity: number;
  category: string;
  modelDisagreement: number;
  oracleRiskScore: number;
  tailRiskScore: number;
  correlationExposure: number;
  orderbookQuality: number;
  dataSource: 'REAL' | 'MOCK';
  spreadSource: 'REAL_ORDERBOOK' | 'ESTIMATED';
  oracleCheckPresent?: boolean;
}

export interface APlusGateResult {
  passed: boolean;
  reasons: string[];
  blocker: boolean;
}

function resolveCategoryLiquidity(category: string, config: APlusSignalConfig): number {
  return config.minLiquidityByCategory[category] ?? config.minLiquidityByCategory.other ?? 10000;
}

export function evaluateAPlusSignalGate(
  input: APlusGateInput,
  config: APlusSignalConfig = DEFAULT_APLUS_CONFIG,
): APlusGateResult {
  const reasons: string[] = [];

  if (input.candidateScore < config.minCandidateScore) {
    reasons.push(`candidateScore ${input.candidateScore.toFixed(1)} < ${config.minCandidateScore}`);
  }
  if (input.adjustedEdge < config.minAdjustedEdge) {
    reasons.push(`adjustedEdge ${(input.adjustedEdge * 100).toFixed(1)}% < ${(config.minAdjustedEdge * 100).toFixed(1)}%`);
  }
  if (input.confidence < config.minConfidence) {
    reasons.push(`confidence ${(input.confidence * 100).toFixed(1)}% < ${(config.minConfidence * 100).toFixed(1)}%`);
  }
  if (input.resolutionClarity < config.minResolutionClarity) {
    reasons.push(`resolutionClarity ${(input.resolutionClarity * 100).toFixed(1)}% < ${(config.minResolutionClarity * 100).toFixed(1)}%`);
  }
  if (input.spread > config.maxSpread) {
    reasons.push(`spread ${(input.spread * 100).toFixed(2)}% > ${(config.maxSpread * 100).toFixed(2)}%`);
  }
  if (input.liquidity < resolveCategoryLiquidity(input.category, config)) {
    reasons.push(`liquidity ${input.liquidity.toFixed(0)} below category minimum`);
  }
  if (input.modelDisagreement > config.maxModelDisagreement) {
    reasons.push(`modelDisagreement ${(input.modelDisagreement * 100).toFixed(1)}% > ${(config.maxModelDisagreement * 100).toFixed(1)}%`);
  }
  if (input.oracleCheckPresent === false) {
    reasons.push('oracleCheck missing');
  }
  if (input.oracleRiskScore > config.maxOracleRisk) {
    reasons.push(`oracleRiskScore ${(input.oracleRiskScore * 100).toFixed(1)}% > ${(config.maxOracleRisk * 100).toFixed(1)}%`);
  }
  if (input.tailRiskScore > config.maxTailRisk) {
    reasons.push(`tailRiskScore ${(input.tailRiskScore * 100).toFixed(1)}% > ${(config.maxTailRisk * 100).toFixed(1)}%`);
  }
  if (input.correlationExposure > config.maxCorrelationExposure) {
    reasons.push(`correlationExposure ${(input.correlationExposure * 100).toFixed(1)}% > ${(config.maxCorrelationExposure * 100).toFixed(1)}%`);
  }
  if (input.orderbookQuality < 12) {
    reasons.push(`orderbookQuality ${input.orderbookQuality.toFixed(1)} < 12`);
  }
  if (input.dataSource !== 'REAL') {
    reasons.push(`dataSource ${input.dataSource} is not REAL`);
  }
  if (input.spreadSource !== 'REAL_ORDERBOOK') {
    reasons.push(`spreadSource ${input.spreadSource} is not REAL_ORDERBOOK`);
  }

  return {
    passed: reasons.length === 0,
    reasons,
    blocker: reasons.some((reason) =>
      reason.includes('spreadSource') ||
      reason.includes('dataSource') ||
      reason.includes('modelDisagreement') ||
      reason.includes('oracleRiskScore'),
    ),
  };
}
