import { callLLMJson } from '@/lib/engine/llm-client';
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

export async function runDebateArena(
  marketTitle: string,
  impliedProbability: number,
  researchContext: string,
  routing?: StageServiceMapping,
): Promise<DebateArenaResult> {
  const effectiveRouting = routing || await getStageRouting();
  const bullModel = getModelForStage('bull', effectiveRouting) || 'paper_lite';
  const bearModel = getModelForStage('bear', effectiveRouting) || 'paper_lite';
  const judgeModel = getModelForStage('judge', effectiveRouting) || 'paper_proglm';

  const maxRounds = Math.max(1, Math.min(effectiveRouting.analystMaxDebateRounds || 3, 1));
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

    const bullStart = Date.now();
    const bearStart = Date.now();
    const [bullResp, bearResp] = await Promise.all([
      callLLMJson<BullResponse>(bullPrompt, BULL_SYSTEM, bullModel).catch(() => ({
        data: { argument: 'Bull analysis unavailable', estimatedProbability: impliedProbability + 0.05, confidence: 0.4, concededPoints: [], newArguments: [] } as BullResponse,
        meta: { model: bullModel, tokenCount: 0, latencyMs: Date.now() - bullStart },
      })),
      callLLMJson<BearResponse>(bearPrompt, BEAR_SYSTEM, bearModel).catch(() => ({
        data: { argument: 'Bear analysis unavailable', estimatedProbability: impliedProbability - 0.05, confidence: 0.4, concededPoints: [], newArguments: [] } as BearResponse,
        meta: { model: bearModel, tokenCount: 0, latencyMs: Date.now() - bearStart },
      })),
    ]);

    const bull = bullResp.data;
    const bear = bearResp.data;

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
      bullProbability: typeof bull.estimatedProbability === 'number' ? bull.estimatedProbability : impliedProbability + 0.05,
      bearProbability: typeof bear.estimatedProbability === 'number' ? bear.estimatedProbability : impliedProbability - 0.05,
      bullConfidence: typeof bull.confidence === 'number' ? bull.confidence : 0.4,
      bearConfidence: typeof bear.confidence === 'number' ? bear.confidence : 0.4,
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
  try {
    const { data } = await callLLMJson<ArbiterResponse>(arbiterPrompt, ARBITER_SYSTEM, judgeModel);
    arbiter = data;
  } catch {
    const w = finalBullConf + finalBearConf || 1;
    const blendedProb = (finalBullProb * finalBullConf + finalBearProb * finalBearConf) / w;
    const edge = Math.abs(blendedProb - impliedProbability);
    arbiter = {
      pointsOfAgreement: [],
      pointsOfDisagreement: ['Bull and bear could not reach consensus'],
      debateOutcome: 'INCONCLUSIVE',
      finalProbability: Math.max(0.05, Math.min(0.95, blendedProb)),
      finalConfidence: 0.3,
      finalUncertainty: 0.5,
      proEvidence: [],
      antiEvidence: [],
      recommendation: edge > 0.05 ? 'WATCH' : 'SKIP',
      recommendationReason: 'Arbiter analysis failed — using blended estimate as fallback',
    };
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
    pointsOfAgreement: arbiter.pointsOfAgreement || [],
    pointsOfDisagreement: arbiter.pointsOfDisagreement || [],
    debateOutcome: arbiter.debateOutcome || 'INCONCLUSIVE',
    finalProbability: typeof arbiter.finalProbability === 'number' ? arbiter.finalProbability : impliedProbability,
    finalConfidence: typeof arbiter.finalConfidence === 'number' ? arbiter.finalConfidence : 0.5,
    finalUncertainty: typeof arbiter.finalUncertainty === 'number' ? arbiter.finalUncertainty : 0.3,
    proEvidence: arbiter.proEvidence || [],
    antiEvidence: arbiter.antiEvidence || [],
    recommendation: arbiter.recommendation || 'SKIP',
    recommendationReason: arbiter.recommendationReason || 'No reason provided',
  };
}
