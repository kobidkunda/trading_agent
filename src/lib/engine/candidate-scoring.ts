export interface CandidateScoreInput {
  liquidity: number;
  spread: number;
  volume24h: number;
  freshnessMinutes: number;
  priceMovePercent: number;
  categoryPriority: number;
  duplicatePenalty: number;
  stalePenalty: number;
  alreadyProcessedPenalty: number;
}

export interface CandidateScoreBreakdown {
  liquidityScore: number;
  spreadScore: number;
  volumeScore: number;
  freshnessScore: number;
  priceMoveScore: number;
  categoryPriorityScore: number;
  totalScore: number;
}

export type CandidateScoreAction = 'SKIP' | 'SNAPSHOT_ONLY' | 'TRIAGE' | 'TRIAGE_AND_RESEARCH' | 'FULL_RESEARCH';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeCandidateScore(input: CandidateScoreInput): CandidateScoreBreakdown {
  const liquidityScore = clamp(input.liquidity / 10000, 0, 22);
  const spreadScore = clamp((0.06 - input.spread) * 280, 0, 20);
  const volumeScore = clamp(input.volume24h / 10000, 0, 18);
  const freshnessScore = clamp(16 - input.freshnessMinutes / 4, 0, 16);
  const priceMoveScore = clamp(input.priceMovePercent * 2, 0, 12);
  const categoryPriorityScore = clamp(input.categoryPriority, 0, 10);

  const penalties = input.duplicatePenalty + input.stalePenalty + input.alreadyProcessedPenalty;
  const totalScore = clamp(
    liquidityScore + spreadScore + volumeScore + freshnessScore + priceMoveScore + categoryPriorityScore - penalties,
    0,
    100,
  );

  return {
    liquidityScore,
    spreadScore,
    volumeScore,
    freshnessScore,
    priceMoveScore,
    categoryPriorityScore,
    totalScore,
  };
}

export function classifyCandidateScore(score: number): CandidateScoreAction {
  if (score < 50) return 'SKIP';
  if (score < 70) return 'SNAPSHOT_ONLY';
  if (score < 85) return 'TRIAGE';
  if (score < 90) return 'TRIAGE_AND_RESEARCH';
  return 'FULL_RESEARCH';
}
