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

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Debate response missing required text field "${field}"`);
  }
  return value.trim();
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

function validateBullResponse(data: BullResponse, model: string, round: number): BullResponse {
  return {
    argument: requireText(data.argument, `bull.argument (${model}, round ${round})`),
    estimatedProbability: requireProbability(data.estimatedProbability, `bull.estimatedProbability (${model}, round ${round})`),
    confidence: requireProbability(data.confidence, `bull.confidence (${model}, round ${round})`),
    concededPoints: requireStringArray(data.concededPoints, `bull.concededPoints (${model}, round ${round})`),
    newArguments: requireStringArray(data.newArguments, `bull.newArguments (${model}, round ${round})`),
  };
}

function validateBearResponse(data: BearResponse, model: string, round: number): BearResponse {
  return {
    argument: requireText(data.argument, `bear.argument (${model}, round ${round})`),
    estimatedProbability: requireProbability(data.estimatedProbability, `bear.estimatedProbability (${model}, round ${round})`),
    confidence: requireProbability(data.confidence, `bear.confidence (${model}, round ${round})`),
    concededPoints: requireStringArray(data.concededPoints, `bear.concededPoints (${model}, round ${round})`),
    newArguments: requireStringArray(data.newArguments, `bear.newArguments (${model}, round ${round})`),
  };
}

function validateArbiterResponse(data: ArbiterResponse, model: string): ArbiterResponse {
  const outcome = data.debateOutcome;
  if (!['BULL_WINS', 'BEAR_WINS', 'SPLIT', 'INCONCLUSIVE'].includes(outcome)) {
    throw new Error(`Arbiter response missing valid debateOutcome (${model})`);
  }
  const recommendation = data.recommendation;
  if (!['BID', 'SKIP', 'WATCH'].includes(recommendation)) {
    throw new Error(`Arbiter response missing valid recommendation (${model})`);
  }
  return {
    pointsOfAgreement: requireStringArray(data.pointsOfAgreement, `arbiter.pointsOfAgreement (${model})`),
    pointsOfDisagreement: requireStringArray(data.pointsOfDisagreement, `arbiter.pointsOfDisagreement (${model})`),
    debateOutcome: outcome,
    finalProbability: requireProbability(data.finalProbability, `arbiter.finalProbability (${model})`),
    finalConfidence: requireProbability(data.finalConfidence, `arbiter.finalConfidence (${model})`),
    finalUncertainty: requireProbability(data.finalUncertainty, `arbiter.finalUncertainty (${model})`),
    proEvidence: requireStringArray(data.proEvidence, `arbiter.proEvidence (${model})`),
    antiEvidence: requireStringArray(data.antiEvidence, `arbiter.antiEvidence (${model})`),
    recommendation,
    recommendationReason: requireText(data.recommendationReason, `arbiter.recommendationReason (${model})`),
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
      callWithFallback('bull', (model) => callLLMJson<BullResponse>(bullPrompt, BULL_SYSTEM, model), 120000),
      callWithFallback('bear', (model) => callLLMJson<BearResponse>(bearPrompt, BEAR_SYSTEM, model), 120000),
    ]);

    if (!bullResult || !bearResult) {
      const failureReason = 'Bull/Bear models unavailable after fallback exhaustion';
      console.warn(`[DebateArena] ${failureReason} for ${marketTitle}; forcing degraded SKIP output`);
      return buildDegradedDebateResult(marketTitle, impliedProbability, failureReason);
    }

    const bullResp = bullResult.result;
    const bearResp = bearResult.result;

    const bull = validateBullResponse(bullResp.data, bullModel, round);
    const bear = validateBearResponse(bearResp.data, bearModel, round);

    prevBullArg = bull.argument;
    prevBearArg = bear.argument;

    bullContext += `\n\n[BULL Round ${round}]: ${bull.argument} (prob: ${bull.estimatedProbability}, conf: ${bull.confidence})`;
    bearContext += `\n\n[BEAR Round ${round}]: ${bear.argument} (prob: ${bear.estimatedProbability}, conf: ${bear.confidence})`;

    rounds.push({
      round,
      bullModel,
      bearModel,
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
  const arbiterResult = await callWithFallback('judge', (model) => callLLMJson<ArbiterResponse>(arbiterPrompt, ARBITER_SYSTEM, model), 180000);
  if (!arbiterResult) {
    const failureReason = 'Arbiter agent failed after exhausting all fallback models';
    console.warn(`[DebateArena] ${failureReason} for ${marketTitle}; forcing degraded SKIP output`);
    return buildDegradedDebateResult(marketTitle, impliedProbability, failureReason);
  }
  arbiter = validateArbiterResponse(arbiterResult.result.data, arbiterResult.modelUsed);

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
