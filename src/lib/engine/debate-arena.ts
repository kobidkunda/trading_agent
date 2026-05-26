import { callLLMJson } from '@/lib/engine/llm-client';
import { callWithFallback } from '@/lib/engine/model-fallback';
import { getStageRouting, getModelForStage } from '@/lib/engine/service-routing';
import type { StageServiceMapping } from '@/lib/types';

export interface DebateRound {
  round: number;
  bullModel: string;
  bearModel: string;
  bullArgument: string;
  bearArgument: string;
  bullProbability: number;
  bearProbability: number;
  bullConfidence: number;
  bearConfidence: number;
}

export interface DebateArenaResult {
  rounds: DebateRound[];
  bullConsensus: {
    probability: number;
    confidence: number;
    keyArguments: string[];
  };
  bearConsensus: {
    probability: number;
    confidence: number;
    keyArguments: string[];
  };
  pointsOfAgreement: string[];
  pointsOfDisagreement: string[];
  debateOutcome: 'BULL_WINS' | 'BEAR_WINS' | 'SPLIT' | 'INCONCLUSIVE';
  finalProbability: number;
  finalConfidence: number;
  finalUncertainty: number;
  proEvidence: string[];
  antiEvidence: string[];
  recommendation: 'BID' | 'SKIP' | 'WATCH';
  recommendationReason: string;
}

export function buildDegradedDebateResult(marketTitle: string, impliedProbability: number, failureReason: string): DebateArenaResult {
  const reason = `ANALYSIS_DEGRADED: debate/judge unavailable for ${marketTitle}; forcing SKIP. ${failureReason}`;
  return {
    rounds: [],
    bullConsensus: { probability: impliedProbability, confidence: 0, keyArguments: ['Debate unavailable'] },
    bearConsensus: { probability: impliedProbability, confidence: 0, keyArguments: ['Debate unavailable'] },
    pointsOfAgreement: ['Analysis degraded'],
    pointsOfDisagreement: ['No validated debate output available'],
    debateOutcome: 'INCONCLUSIVE',
    finalProbability: impliedProbability,
    finalConfidence: 0,
    finalUncertainty: 1,
    proEvidence: [],
    antiEvidence: [],
    recommendation: 'SKIP',
    recommendationReason: reason,
  };
}

const BULL_SYSTEM = `You are an aggressive BULL analyst in a debate arena. You advocate FOR the prediction market outcome.

Your job:
- Build the strongest possible case that this event WILL happen
- Attack bear arguments with counter-evidence
- Adjust your probability estimate based on evidence quality
- Concede valid points but show why bull case still wins overall

Be precise with numbers. Always respond with valid JSON.`;

const BEAR_SYSTEM = `You are a skeptical BEAR analyst in a debate arena. You advocate AGAINST the prediction market outcome.

Your job:
- Build the strongest possible case that this event WILL NOT happen
- Attack bull arguments with counter-evidence
- Adjust your probability estimate based on evidence quality
- Concede valid points but show why bear case still wins overall

Be precise with numbers. Always respond with valid JSON.`;

const DEBATE_SIDE_TIMEOUT_MS = 60_000;
const ARBITER_TIMEOUT_MS = 90_000;

const ARBITER_SYSTEM = `You are the ARBITER of a multi-model debate about a prediction market.

You have received multiple rounds of debate between BULL and BEAR analysts. Your job:
1. Identify points where both sides AGREE (these are the most reliable signals)
2. Identify points where they DISAGREE (these need more scrutiny)
3. Determine who won the debate based on evidence quality and logical rigor
4. Produce a final probability estimate and recommendation

Recommendations:
- BID: High confidence edge exists (>5% after costs), strong evidence
- WATCH: Moderate edge (2-5%) or mixed signals — worth monitoring
- SKIP: No edge, low confidence, or strong contradictory evidence

Always respond with valid JSON.`;

interface BullResponse {
  argument: string;
  estimatedProbability: number;
  confidence: number;
  concededPoints: string[];
  newArguments: string[];
}

interface BearResponse {
  argument: string;
  estimatedProbability: number;
  confidence: number;
  concededPoints: string[];
  newArguments: string[];
}

interface ArbiterResponse {
  pointsOfAgreement: string[];
  pointsOfDisagreement: string[];
  debateOutcome: 'BULL_WINS' | 'BEAR_WINS' | 'SPLIT' | 'INCONCLUSIVE';
  finalProbability: number;
  finalConfidence: number;
  finalUncertainty: number;
  proEvidence: string[];
  antiEvidence: string[];
  recommendation: 'BID' | 'SKIP' | 'WATCH';
  recommendationReason: string;
}

interface DebateSideResult {
  argument: string;
  estimatedProbability: number;
  confidence: number;
  concededPoints: string[];
  newArguments: string[];
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Debate response missing required text field "${field}"`);
  }
  return value.trim();
}

function coerceText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function requireProbability(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Debate response missing valid probability field "${field}"`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Debate response missing required array field "${field}"`);
  }
  return value.map((item) => String(item)).filter((item) => item.trim().length > 0);
}

function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function validateBullResponse(data: BullResponse, model: string, round: number): BullResponse {
  const raw = data as unknown as Record<string, unknown>;
  const concededPoints = Array.isArray(data.concededPoints) ? requireStringArray(data.concededPoints, `bull.concededPoints (${model}, round ${round})`) : [];
  const newArguments = Array.isArray(data.newArguments) ? requireStringArray(data.newArguments, `bull.newArguments (${model}, round ${round})`) : [];
  const fallbackArgument =
    coerceText(raw.thesis) ??
    coerceText(raw.summary) ??
    coerceText(raw.reasoning) ??
    [...newArguments, ...concededPoints].join(' ').trim();
  return {
    argument: requireText(data.argument ?? fallbackArgument, `bull.argument (${model}, round ${round})`),
    estimatedProbability: requireProbability(data.estimatedProbability, `bull.estimatedProbability (${model}, round ${round})`),
    confidence: requireProbability(data.confidence, `bull.confidence (${model}, round ${round})`),
    concededPoints,
    newArguments,
  };
}

function validateBearResponse(data: BearResponse, model: string, round: number): BearResponse {
  const raw = data as unknown as Record<string, unknown>;
  const concededPoints = Array.isArray(data.concededPoints) ? requireStringArray(data.concededPoints, `bear.concededPoints (${model}, round ${round})`) : [];
  const newArguments = Array.isArray(data.newArguments) ? requireStringArray(data.newArguments, `bear.newArguments (${model}, round ${round})`) : [];
  const fallbackArgument =
    coerceText(raw.thesis) ??
    coerceText(raw.summary) ??
    coerceText(raw.reasoning) ??
    [...newArguments, ...concededPoints].join(' ').trim();
  return {
    argument: requireText(data.argument ?? fallbackArgument, `bear.argument (${model}, round ${round})`),
    estimatedProbability: requireProbability(data.estimatedProbability, `bear.estimatedProbability (${model}, round ${round})`),
    confidence: requireProbability(data.confidence, `bear.confidence (${model}, round ${round})`),
    concededPoints,
    newArguments,
  };
}

function validateArbiterResponse(data: ArbiterResponse, model: string): ArbiterResponse {
  const raw = data as unknown as Record<string, unknown>;
  let outcome = data.debateOutcome ?? raw.outcome ?? raw.winner;
  if (!['BULL_WINS', 'BEAR_WINS', 'SPLIT', 'INCONCLUSIVE'].includes(String(outcome))) {
    const finalProbability = typeof data.finalProbability === 'number' ? data.finalProbability : typeof raw.finalProbability === 'number' ? Number(raw.finalProbability) : 0.5;
    outcome = finalProbability > 0.55 ? 'BULL_WINS' : finalProbability < 0.45 ? 'BEAR_WINS' : 'SPLIT';
  }
  const recommendation = data.recommendation;
  if (!['BID', 'SKIP', 'WATCH'].includes(recommendation)) {
    throw new Error(`Arbiter response missing valid recommendation (${model})`);
  }
  return {
    pointsOfAgreement: Array.isArray(data.pointsOfAgreement) ? requireStringArray(data.pointsOfAgreement, `arbiter.pointsOfAgreement (${model})`) : [],
    pointsOfDisagreement: Array.isArray(data.pointsOfDisagreement) ? requireStringArray(data.pointsOfDisagreement, `arbiter.pointsOfDisagreement (${model})`) : [],
    debateOutcome: outcome as ArbiterResponse['debateOutcome'],
    finalProbability: requireProbability(data.finalProbability, `arbiter.finalProbability (${model})`),
    finalConfidence: requireProbability(data.finalConfidence, `arbiter.finalConfidence (${model})`),
    finalUncertainty: requireProbability(data.finalUncertainty, `arbiter.finalUncertainty (${model})`),
    proEvidence: Array.isArray(data.proEvidence) ? requireStringArray(data.proEvidence, `arbiter.proEvidence (${model})`) : [],
    antiEvidence: Array.isArray(data.antiEvidence) ? requireStringArray(data.antiEvidence, `arbiter.antiEvidence (${model})`) : [],
    recommendation,
    recommendationReason: requireText(data.recommendationReason, `arbiter.recommendationReason (${model})`),
  };
}

function buildFallbackSide(
  side: 'bull' | 'bear',
  marketTitle: string,
  impliedProbability: number,
  round: number,
  counterpart?: DebateSideResult | null,
): DebateSideResult {
  const fallbackProbability = counterpart
    ? clampProbability((impliedProbability + (1 - counterpart.estimatedProbability)) / 2)
    : impliedProbability;
  const counterLabel = counterpart ? `Counterpart unavailable in round ${round}; preserving debate continuity from market prior.` : `Model unavailable in round ${round}; using prior baseline.`;
  return {
    argument: `${side.toUpperCase()} fallback for "${marketTitle}". ${counterLabel}`,
    estimatedProbability: fallbackProbability,
    confidence: counterpart ? Math.max(0.2, Math.min(0.35, counterpart.confidence * 0.7)) : 0.2,
    concededPoints: [],
    newArguments: [],
  };
}

function synthesizeArbiterFromRounds(
  marketTitle: string,
  impliedProbability: number,
  rounds: DebateRound[],
): ArbiterResponse {
  const bullProb = rounds.reduce((sum, round) => sum + round.bullProbability, 0) / rounds.length;
  const bearProb = rounds.reduce((sum, round) => sum + round.bearProbability, 0) / rounds.length;
  const bullConf = rounds.reduce((sum, round) => sum + round.bullConfidence, 0) / rounds.length;
  const bearConf = rounds.reduce((sum, round) => sum + round.bearConfidence, 0) / rounds.length;
  const finalProbability = clampProbability((bullProb + bearProb) / 2);
  const finalConfidence = Math.max(0.2, Math.min(0.75, Math.max(bullConf, bearConf)));
  const gap = Math.abs(bullProb - bearProb);
  const edgeVsMarket = Math.abs(finalProbability - impliedProbability);
  const debateOutcome: ArbiterResponse['debateOutcome'] = gap < 0.03 ? 'SPLIT' : finalProbability > impliedProbability ? 'BULL_WINS' : 'BEAR_WINS';
  const recommendation: ArbiterResponse['recommendation'] = edgeVsMarket >= 0.05 && finalConfidence >= 0.35 ? 'WATCH' : 'SKIP';

  return {
    pointsOfAgreement: ['Partial debate transcript available'],
    pointsOfDisagreement: [`Bull/Bear probability gap ${(gap * 100).toFixed(1)}%`],
    debateOutcome,
    finalProbability,
    finalConfidence,
    finalUncertainty: Math.max(0, 1 - finalConfidence),
    proEvidence: rounds.map((round) => round.bullArgument).filter(Boolean).slice(0, 3),
    antiEvidence: rounds.map((round) => round.bearArgument).filter(Boolean).slice(0, 3),
    recommendation,
    recommendationReason: `Synthesized arbiter result for ${marketTitle} from ${rounds.length} debate round(s) after arbiter failure.`,
  };
}

export async function runDebateArena(
  marketTitle: string,
  impliedProbability: number,
  researchContext: string,
  routing?: StageServiceMapping,
): Promise<DebateArenaResult> {
  const effectiveRouting = routing || await getStageRouting();
  const bullModel = getModelForStage('bull', effectiveRouting) || 'paper_lite';
  const bearModel = getModelForStage('bear', effectiveRouting) || 'paper_lite';

  const maxRounds = Math.max(1, effectiveRouting.analystMaxDebateRounds || 3);
  const rounds: DebateRound[] = [];

  let bullContext = researchContext;
  let bearContext = researchContext;
  let prevBullArg = '';
  let prevBearArg = '';

  for (let round = 1; round <= maxRounds; round++) {
    const roundLabel = round === 1 ? 'opening' : `rebuttal round ${round}`;
    const bullOpponent = round === 1 ? '' : `\n\nBEAR'S PREVIOUS ARGUMENT:\n${prevBearArg}\n\nYou must address and counter the bear's points.`;
    const bearOpponent = round === 1 ? '' : `\n\nBULL'S PREVIOUS ARGUMENT:\n${prevBullArg}\n\nYou must address and counter the bull's points.`;

    const bullPrompt = `Market: ${marketTitle}
Current Implied Probability: ${(impliedProbability * 100).toFixed(1)}%
Round: ${roundLabel}

RESEARCH EVIDENCE:
${bullContext.slice(0, 8000)}
${bullOpponent}

${round === 1 ? 'Make your opening bull case.' : 'Make your rebuttal. Address the bear\'s counter-arguments and strengthen your position.'}

Respond in JSON:
{
  "argument": "Your main argument (2-3 sentences)",
  "estimatedProbability": 0.XX,
  "confidence": 0.XX,
  "concededPoints": ["point you concede to the other side"],
  "newArguments": ["new evidence or angle you're introducing"]
}`;

    const bearPrompt = `Market: ${marketTitle}
Current Implied Probability: ${(impliedProbability * 100).toFixed(1)}%
Round: ${roundLabel}

RESEARCH EVIDENCE:
${bearContext.slice(0, 8000)}
${bearOpponent}

${round === 1 ? 'Make your opening bear case.' : 'Make your rebuttal. Address the bull\'s arguments and strengthen your position.'}

Respond in JSON:
{
  "argument": "Your main argument (2-3 sentences)",
  "estimatedProbability": 0.XX,
  "confidence": 0.XX,
  "concededPoints": ["point you concede to the other side"],
  "newArguments": ["new evidence or angle you're introducing"]
}`;

    const [bullResult, bearResult] = await Promise.all([
      callWithFallback('bull', async (model) => {
        const response = await callLLMJson<BullResponse>(bullPrompt, BULL_SYSTEM, model, DEBATE_SIDE_TIMEOUT_MS);
        return validateBullResponse(response.data, model, round);
      }, DEBATE_SIDE_TIMEOUT_MS),
      callWithFallback('bear', async (model) => {
        const response = await callLLMJson<BearResponse>(bearPrompt, BEAR_SYSTEM, model, DEBATE_SIDE_TIMEOUT_MS);
        return validateBearResponse(response.data, model, round);
      }, DEBATE_SIDE_TIMEOUT_MS),
    ]);

    if (!bullResult || !bearResult) {
      if (!bullResult && !bearResult) {
        if (rounds.length > 0) {
          console.warn(`[DebateArena] Both sides failed in round ${round} for ${marketTitle}; keeping ${rounds.length} prior round(s)`);
          break;
        }
        const failureReason = 'Bull/Bear models unavailable after fallback exhaustion';
        console.warn(`[DebateArena] ${failureReason} for ${marketTitle}; forcing degraded SKIP output`);
        return buildDegradedDebateResult(marketTitle, impliedProbability, failureReason);
      }
    }

    const bear = bearResult?.result ?? buildFallbackSide('bear', marketTitle, impliedProbability, round, bullResult?.result ?? null);
    const bull = bullResult?.result ?? buildFallbackSide('bull', marketTitle, impliedProbability, round, bearResult?.result ?? null);

    prevBullArg = bull.argument;
    prevBearArg = bear.argument;

    bullContext += `\n\n[BULL Round ${round}]: ${bull.argument} (prob: ${bull.estimatedProbability}, conf: ${bull.confidence})`;
    bearContext += `\n\n[BEAR Round ${round}]: ${bear.argument} (prob: ${bear.estimatedProbability}, conf: ${bear.confidence})`;

    rounds.push({
      round,
      bullModel: bullResult?.modelUsed ?? 'system-fallback',
      bearModel: bearResult?.modelUsed ?? 'system-fallback',
      bullArgument: bull.argument,
      bearArgument: bear.argument,
      bullProbability: bull.estimatedProbability,
      bearProbability: bear.estimatedProbability,
      bullConfidence: bull.confidence,
      bearConfidence: bear.confidence,
    });

    const convergence = Math.abs(bull.estimatedProbability - bear.estimatedProbability);
    if (round > 1 && convergence < 0.03) {
      console.log(`[DebateArena] Convergence reached at round ${round} (gap: ${(convergence * 100).toFixed(1)}%)`);
      break;
    }
  }

  const finalBullProb = rounds[rounds.length - 1].bullProbability;
  const finalBearProb = rounds[rounds.length - 1].bearProbability;
  const finalBullConf = rounds[rounds.length - 1].bullConfidence;
  const finalBearConf = rounds[rounds.length - 1].bearConfidence;

  const arbiterPrompt = `Market: ${marketTitle}
Current Implied Probability: ${(impliedProbability * 100).toFixed(1)}%

DEBATE TRANSCRIPT (${rounds.length} rounds):
${rounds.map((r) => `
--- Round ${r.round} (Bull: ${r.bullModel}, Bear: ${r.bearModel}) ---
BULL (${(r.bullProbability * 100).toFixed(1)}%, conf ${(r.bullConfidence * 100).toFixed(0)}%): ${r.bullArgument}
BEAR (${(r.bearProbability * 100).toFixed(1)}%, conf ${(r.bearConfidence * 100).toFixed(0)}%): ${r.bearArgument}`).join('\n')}

RESEARCH EVIDENCE:
${researchContext.slice(0, 6000)}

Analyze this debate. Who made stronger arguments? Where do they agree? Where do they disagree?

Respond in JSON:
{
  "pointsOfAgreement": ["point1", "point2"],
  "pointsOfDisagreement": ["point1", "point2"],
  "debateOutcome": "BULL_WINS" | "BEAR_WINS" | "SPLIT" | "INCONCLUSIVE",
  "finalProbability": 0.XX,
  "finalConfidence": 0.XX,
  "finalUncertainty": 0.XX,
  "proEvidence": ["strongest bull evidence"],
  "antiEvidence": ["strongest bear evidence"],
  "recommendation": "BID" | "SKIP" | "WATCH",
  "recommendationReason": "Why this recommendation"
}`;

  let arbiter: ArbiterResponse;
  const arbiterResult = await callWithFallback(
    'judge',
    async (model) => {
      const response = await callLLMJson<ArbiterResponse>(arbiterPrompt, ARBITER_SYSTEM, model, ARBITER_TIMEOUT_MS);
      return validateArbiterResponse(response.data, model);
    },
    ARBITER_TIMEOUT_MS,
  );
  if (!arbiterResult) {
    const failureReason = 'Arbiter agent failed after exhausting all fallback models';
    if (rounds.length === 0) {
      console.warn(`[DebateArena] ${failureReason} for ${marketTitle}; forcing degraded SKIP output`);
      return buildDegradedDebateResult(marketTitle, impliedProbability, failureReason);
    }
    console.warn(`[DebateArena] ${failureReason} for ${marketTitle}; synthesizing arbiter result from ${rounds.length} round(s)`);
    arbiter = synthesizeArbiterFromRounds(marketTitle, impliedProbability, rounds);
  } else {
    arbiter = arbiterResult.result;
  }

  return {
    rounds,
    bullConsensus: {
      probability: finalBullProb,
      confidence: finalBullConf,
      keyArguments: rounds.map((r) => r.bullArgument),
    },
    bearConsensus: {
      probability: finalBearProb,
      confidence: finalBearConf,
      keyArguments: rounds.map((r) => r.bearArgument),
    },
    pointsOfAgreement: arbiter.pointsOfAgreement,
    pointsOfDisagreement: arbiter.pointsOfDisagreement,
    debateOutcome: arbiter.debateOutcome,
    finalProbability: arbiter.finalProbability,
    finalConfidence: arbiter.finalConfidence,
    finalUncertainty: arbiter.finalUncertainty,
    proEvidence: arbiter.proEvidence,
    antiEvidence: arbiter.antiEvidence,
    recommendation: arbiter.recommendation,
    recommendationReason: arbiter.recommendationReason,
  };
}
