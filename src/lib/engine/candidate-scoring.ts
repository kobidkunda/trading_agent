// ── 15-Factor Candidate Scoring Engine ──
// Upgraded from 6 components → full 15-factor score with 7 penalty types.
// Integrates signal feeds from T3-T7 modules.
// Produces acceptedCriteria / rejectedCriteria arrays + auto-generated skipReason.

export interface CandidateScoreInput {
  // ── Base 6 (original) ──
  liquidity: number;
  spread: number;
  volume24h: number;
  freshnessMinutes: number;
  priceMovePercent: number;
  categoryPriority: number;

  // ── Signal scores (T3-T7 feeds, all optional → default 0) ──
  rawEdge?: number;
  adjustedEdge?: number;
  biasAdjustedProb?: number;
  confidence?: number;
  sourceQuality?: number;
  resolutionClarity?: number;
  recency?: number;
  walletSignalScore?: number;
  relatedMarketSignalScore?: number;

  // ── Quality inputs ──
  orderbookQuality?: number;       // 0–20 quality score (higher = better)
  oracleRiskLevel?: string;        // 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCK'

  // ── Penalties (direct pass-through) ──
  duplicatePenalty?: number;
  stalePenalty?: number;
  alreadyProcessedPenalty?: number;
  uncertaintyPenalty?: number;
  contradictionPenalty?: number;
  correlationRiskPenalty?: number;
  manipulationRiskPenalty?: number;
}

export interface CandidateScoreBreakdown {
  // ── Base 6 scores ──
  liquidityScore: number;
  spreadScore: number;
  volumeScore: number;
  freshnessScore: number;
  priceMoveScore: number;
  categoryPriorityScore: number;

  // ── Signal scores (7 new) ──
  edgeScore: number;
  confidenceScore: number;
  sourceQualityScore: number;
  resolutionClarityScore: number;
  recencyScore: number;
  walletSignalScore: number;
  relatedMarketSignalScore: number;

  // ── Penalties ──
  orderbookQualityPenalty: number;
  uncertaintyPenalty: number;
  contradictionPenalty: number;
  oracleRiskPenalty: number;
  correlationRiskPenalty: number;
  manipulationRiskPenalty: number;
  duplicatePenalty: number;
  stalePenalty: number;
  alreadyProcessedPenalty: number;

  // ── Result ──
  totalScore: number;
  acceptedCriteria: string[];
  rejectedCriteria: string[];
  skipReason: string;
}

export type CandidateScoreAction = 'SKIP' | 'SNAPSHOT_ONLY' | 'TRIAGE' | 'TRIAGE_AND_RESEARCH' | 'FULL_RESEARCH';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const ORACLE_RISK_MAP: Record<string, number> = {
  LOW: 0,
  MEDIUM: 3,
  HIGH: 8,
  BLOCK: 20,
};

export function computeCandidateScore(input: CandidateScoreInput): CandidateScoreBreakdown {
  // ── Base 6 scores (unchanged formulas) ──
  const liquidityScore = clamp(input.liquidity / 10000, 0, 22);
  const spreadScore = clamp((0.06 - input.spread) * 280, 0, 20);
  const volumeScore = clamp(input.volume24h / 10000, 0, 18);
  const freshnessScore = clamp(16 - input.freshnessMinutes / 4, 0, 16);
  const priceMoveScore = clamp(input.priceMovePercent * 2, 0, 12);
  const categoryPriorityScore = clamp(input.categoryPriority, 0, 10);

  // ── Signal scores (T3-T7 feeds) ──
  const adjustedEdge = input.adjustedEdge ?? input.rawEdge ?? 0;
  const edgeScore = clamp(Math.abs(adjustedEdge) * 250, 0, 15);
  const confidenceScore = clamp((input.confidence ?? 0) * 15, 0, 15);
  const sourceQualityScore = clamp((input.sourceQuality ?? 0) * 0.1, 0, 10);
  const resolutionClarityScore = clamp((input.resolutionClarity ?? 0) * 0.1, 0, 8);
  const recencyScore = clamp(8 - input.freshnessMinutes / 8, 0, 8);
  const walletSignalScore = clamp((input.walletSignalScore ?? 0) * 0.5, 0, 10);
  const relatedMarketSignalScore = clamp((input.relatedMarketSignalScore ?? 0) * 0.5, 0, 8);

  // ── Penalties ──
  const orderbookQualityRaw = input.orderbookQuality ?? 0;
  const orderbookQualityPenalty = clamp(20 - orderbookQualityRaw, 0, 15);

  const oracleRiskPenalty =
    ORACLE_RISK_MAP[input.oracleRiskLevel ?? 'LOW'] ?? 0;

  const uncertaintyPenalty = clamp((input.uncertaintyPenalty ?? 0) * 15, 0, 10);
  const contradictionPenalty = clamp((input.contradictionPenalty ?? 0) * 10, 0, 8);
  const correlationRiskPenalty = clamp(input.correlationRiskPenalty ?? 0, 0, 20);
  const manipulationRiskPenalty = clamp(input.manipulationRiskPenalty ?? 0, 0, 20);
  const duplicatePenalty = input.duplicatePenalty ?? 0;
  const stalePenalty = input.stalePenalty ?? 0;
  const alreadyProcessedPenalty = input.alreadyProcessedPenalty ?? 0;

  // ── Total ──
  const positiveSum =
    liquidityScore +
    spreadScore +
    volumeScore +
    freshnessScore +
    priceMoveScore +
    categoryPriorityScore +
    edgeScore +
    confidenceScore +
    sourceQualityScore +
    resolutionClarityScore +
    recencyScore +
    walletSignalScore +
    relatedMarketSignalScore;

  const negativeSum =
    orderbookQualityPenalty +
    oracleRiskPenalty +
    uncertaintyPenalty +
    contradictionPenalty +
    correlationRiskPenalty +
    manipulationRiskPenalty +
    duplicatePenalty +
    stalePenalty +
    alreadyProcessedPenalty;

  const totalScore = clamp(positiveSum - negativeSum, 0, 100);

  // ── Criteria tracking ──
  const acceptedCriteria: string[] = [];
  const rejectedCriteria: string[] = [];

  // Positive criteria
  if (liquidityScore > 3) acceptedCriteria.push('LIQUIDITY');
  if (spreadScore > 3) acceptedCriteria.push('SPREAD');
  if (volumeScore > 3) acceptedCriteria.push('VOLUME');
  if (freshnessScore > 3) acceptedCriteria.push('FRESHNESS');
  if (priceMoveScore > 2) acceptedCriteria.push('PRICE_MOVE');
  if (categoryPriorityScore > 2) acceptedCriteria.push('CATEGORY');

  if (edgeScore > 3) acceptedCriteria.push('EDGE');
  if (confidenceScore > 3) acceptedCriteria.push('CONFIDENCE');
  if (sourceQualityScore > 2) acceptedCriteria.push('SOURCE_QUALITY');
  if (resolutionClarityScore > 2) acceptedCriteria.push('RESOLUTION_CLARITY');
  if (recencyScore > 2) acceptedCriteria.push('RECENCY');
  if (walletSignalScore > 2) acceptedCriteria.push('WALLET_SIGNAL');
  if (relatedMarketSignalScore > 2) acceptedCriteria.push('RELATED_MARKET');

  // Negative criteria
  if (orderbookQualityPenalty > 5) rejectedCriteria.push('ORDERBOOK_QUALITY');
  if (uncertaintyPenalty > 2) rejectedCriteria.push('UNCERTAINTY');
  if (contradictionPenalty > 2) rejectedCriteria.push('CONTRADICTION');
  if (oracleRiskPenalty > 0) rejectedCriteria.push('ORACLE_RISK');
  if (correlationRiskPenalty > 3) rejectedCriteria.push('CORRELATION_RISK');
  if (manipulationRiskPenalty > 3) rejectedCriteria.push('MANIPULATION_RISK');
  if (duplicatePenalty > 5) rejectedCriteria.push('DUPLICATE');
  if (stalePenalty > 5) rejectedCriteria.push('STALE');
  if (alreadyProcessedPenalty > 5) rejectedCriteria.push('ALREADY_PROCESSED');

  // Auto-generated skip reason
  let skipReason = '';
  if (totalScore < 50) {
    skipReason =
      rejectedCriteria.length > 0
        ? `Score too low (${totalScore}/100). Rejected: ${rejectedCriteria.join(', ')}`
        : `Score too low (${totalScore}/100). Insufficient positive criteria.`;
  }

  return {
    liquidityScore,
    spreadScore,
    volumeScore,
    freshnessScore,
    priceMoveScore,
    categoryPriorityScore,
    edgeScore,
    confidenceScore,
    sourceQualityScore,
    resolutionClarityScore,
    recencyScore,
    walletSignalScore,
    relatedMarketSignalScore,
    orderbookQualityPenalty,
    uncertaintyPenalty,
    contradictionPenalty,
    oracleRiskPenalty,
    correlationRiskPenalty,
    manipulationRiskPenalty,
    duplicatePenalty,
    stalePenalty,
    alreadyProcessedPenalty,
    totalScore,
    acceptedCriteria,
    rejectedCriteria,
    skipReason,
  };
}

export function classifyCandidateScore(score: number): CandidateScoreAction {
  if (score < 50) return 'SKIP';
  if (score < 70) return 'SNAPSHOT_ONLY';
  if (score < 85) return 'TRIAGE';
  if (score < 90) return 'TRIAGE_AND_RESEARCH';
  return 'FULL_RESEARCH';
}
