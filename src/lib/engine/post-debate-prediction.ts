/**
 * Post-Debate Prediction Module
 * 
 * Synthesizes debate arena results + research context via MiroFish LLM
 * to generate final trading predictions.
 */

import type { DebateArenaResult } from './debate-arena.js';

// ============================================================================
// Types
// ============================================================================

export interface PostDebatePredictionResult {
  summary: string;
  keyInsights: string[];
  finalProbabilityAdjustment: number;  // +/- adjustment to debate probability
  finalConfidence: number;
  recommendation: 'STRONG_BID' | 'BID' | 'WATCH' | 'SKIP' | 'FADE';
  recommendationReason: string;
  riskFlags: string[];
  modelUsed: string;
}

// ============================================================================
// Constants
// ============================================================================

const MIROFISH_BASE_URL = process.env.MIROFISH_URL || '';
const MIROFISH_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = 'free_ling';

const FALLBACK_MODELS = [
  'free_hy3',
  'free_glm51',
  'free_deepseek_pro',
  'paper_lite',
] as const;

// ============================================================================
// Prompt Builder
// ============================================================================

function buildPredictionPrompt(
  debateResult: DebateArenaResult,
  researchContext: string
): string {
  const marketTitle = 'Unknown Market';

  // Build bull/bear argument strings from rounds
  const bullArgs = debateResult.rounds
    .map(r => r.bullArgument)
    .filter(Boolean);
    
  const bearArgs = debateResult.rounds
    .map(r => r.bearArgument)
    .filter(Boolean);

  const bullConsensusText = debateResult.bullConsensus
    ? `Probability: ${debateResult.bullConsensus.probability.toFixed(2)}, Confidence: ${debateResult.bullConsensus.confidence.toFixed(2)}\nKey Arguments:\n${debateResult.bullConsensus.keyArguments.map(a => `- ${a}`).join('\n')}`
    : 'No bull consensus';
    
  const bearConsensusText = debateResult.bearConsensus
    ? `Probability: ${debateResult.bearConsensus.probability.toFixed(2)}, Confidence: ${debateResult.bearConsensus.confidence.toFixed(2)}\nKey Arguments:\n${debateResult.bearConsensus.keyArguments.map(a => `- ${a}`).join('\n')}`
    : 'No bear consensus';

  const debateProbability = debateResult.finalProbability ?? 0.5;
  const debateConfidence = debateResult.finalConfidence ?? 0.5;

  return `You are a market prediction synthesizer. Given the following debate results and research context, provide a final trading prediction.

## MARKET
${marketTitle}

## DEBATE SUMMARY

### Bull Consensus:
${bullConsensusText}

### Bear Consensus:
${bearConsensusText}

### Debate Outcome: ${debateResult.debateOutcome ?? 'N/A'}
### Final Debate Probability: ${debateProbability.toFixed(2)}
### Final Debate Confidence: ${debateConfidence.toFixed(2)}

### Points of Agreement:
${debateResult.pointsOfAgreement?.map(p => `- ${p}`).join('\n') || 'None'}

### Points of Disagreement:
${debateResult.pointsOfDisagreement?.map(p => `- ${p}`).join('\n') || 'None'}

## RESEARCH CONTEXT:
${researchContext || 'No additional research context provided'}

## YOUR TASK:
Provide a JSON response with the following fields:
{
  "summary": "2-3 sentence synthesis of the debate and research",
  "keyInsights": ["insight 1", "insight 2", "insight 3"],
  "finalProbabilityAdjustment": number between -0.3 and 0.3 (adjustment to ${debateProbability.toFixed(2)} based on synthesis),
  "finalConfidence": number between 0 and 1,
  "recommendation": "STRONG_BID" | "BID" | "WATCH" | "SKIP" | "FADE",
  "recommendationReason": "1 sentence explaining the recommendation",
  "riskFlags": ["risk flag 1", "risk flag 2"]
}

Return ONLY valid JSON, no markdown formatting.`;
}

// ============================================================================
// Response Parsing
// ============================================================================

interface MiroFishResponse {
  summary?: string;
  keyInsights?: string[];
  finalProbabilityAdjustment?: number;
  finalConfidence?: number;
  recommendation?: PostDebatePredictionResult['recommendation'];
  recommendationReason?: string;
  riskFlags?: string[];
}

function parseMiroFishResponse(raw: string): MiroFishResponse | null {
  try {
    const cleaned = raw
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
      
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ============================================================================
// Fallback Synthesis (when MiroFish is unavailable)
// ============================================================================

function synthesizeFromDebate(
  debateResult: DebateArenaResult,
  researchContext: string
): PostDebatePredictionResult {
  const outcome = debateResult.debateOutcome ?? 'INCONCLUSIVE';
  const bullProb = debateResult.bullConsensus?.probability ?? 0.5;
  const bearProb = debateResult.bearConsensus?.probability ?? 0.5;
  const baseConfidence = debateResult.finalConfidence ?? 0.5;

  // Determine sentiment from debate outcome
  const bullish = outcome === 'BULL_WINS' || (outcome === 'SPLIT' && bullProb > bearProb);
  const bearish = outcome === 'BEAR_WINS' || (outcome === 'SPLIT' && bearProb > bullProb);
  const sentiment = bullish ? 'bullish' : bearish ? 'bearish' : 'neutral';

  // Calculate probability adjustment based on consensus divergence
  const probGap = Math.abs(bullProb - bearProb);
  const adjustment = bullish ? probGap * 0.3 : bearish ? -probGap * 0.3 : 0;

  // Confidence boost from consensus agreement
  const consensusStrength = debateResult.pointsOfAgreement?.length ?? 0;
  const confidence = Math.min(0.9, baseConfidence + consensusStrength * 0.05);

  // Determine recommendation
  let recommendation: PostDebatePredictionResult['recommendation'];
  if (sentiment === 'bullish' && confidence > 0.65) {
    recommendation = confidence > 0.8 ? 'STRONG_BID' : 'BID';
  } else if (sentiment === 'bearish' && confidence > 0.65) {
    recommendation = 'FADE';
  } else if (sentiment === 'neutral' || outcome === 'INCONCLUSIVE') {
    recommendation = 'SKIP';
  } else {
    recommendation = 'WATCH';
  }

  return {
    summary: `Debate concluded with ${outcome} verdict. Bull consensus at ${(bullProb * 100).toFixed(0)}%, bear at ${(bearProb * 100).toFixed(0)}%. Sentiment: ${sentiment}. Research context ${researchContext ? 'was' : 'was not'} available for synthesis.`,
    keyInsights: [
      `Debate outcome: ${outcome}`,
      debateResult.pointsOfAgreement?.[0] ? `Key agreement: ${debateResult.pointsOfAgreement[0]}` : null,
      debateResult.pointsOfDisagreement?.[0] ? `Key disagreement: ${debateResult.pointsOfDisagreement[0]}` : null,
    ].filter((x): x is string => x !== null),
    finalProbabilityAdjustment: Math.max(-0.3, Math.min(0.3, adjustment)),
    finalConfidence: confidence,
    recommendation,
    recommendationReason: `${sentiment.charAt(0).toUpperCase() + sentiment.slice(1)} stance based on ${outcome} with ${(confidence * 100).toFixed(0)}% confidence`,
    riskFlags: [
      outcome === 'INCONCLUSIVE' ? 'Inconclusive debate outcome' : null,
      outcome === 'SPLIT' ? 'Split verdict - bull/bear disagreement significant' : null,
      confidence < 0.4 ? 'Low confidence - proceed with caution' : null,
      Math.abs(adjustment) > 0.2 ? 'Large probability shift from consensus divergence' : null,
    ].filter((x): x is string => x !== null),
    modelUsed: 'fallback-synthesis',
  };
}

// ============================================================================
// MiroFish API
// ============================================================================

async function callMiroFish(
  model: string,
  prompt: string,
  signal?: AbortSignal
): Promise<string> {
  const url = `${MIROFISH_BASE_URL}/api/llm/test/${encodeURIComponent(model)}?prompt=${encodeURIComponent(prompt)}`;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), MIROFISH_TIMEOUT_MS);
  const combinedSignal = signal 
    ? anySignal([signal, controller.signal])
    : controller.signal;

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: combinedSignal,
      headers: {
        'Accept': 'application/json, text/plain, */*',
      },
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`MiroFish returned ${response.status}: ${response.statusText}`);
    }
    
    return await response.text();
  } catch (err) {
    clearTimeout(timeoutId);
    
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('MiroFish request timed out');
    }
    throw err;
  }
}

function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const s of signals) {
    s.addEventListener('abort', () => controller.abort());
  }
  return controller.signal;
}

// ============================================================================
// Main Function
// ============================================================================

export async function runPostDebatePrediction(
  debateResult: DebateArenaResult,
  researchContext: string,
  mirofishModel?: string
): Promise<PostDebatePredictionResult> {
  const model = mirofishModel || DEFAULT_MODEL;
  const prompt = buildPredictionPrompt(debateResult, researchContext);

  const attemptWithModel = async (modelName: string): Promise<PostDebatePredictionResult | null> => {
    try {
      const rawResponse = await callMiroFish(modelName, prompt);
      const parsed = parseMiroFishResponse(rawResponse);

      if (parsed && parsed.summary && parsed.recommendation) {
        return {
          summary: parsed.summary,
          keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [],
          finalProbabilityAdjustment: Math.max(-0.3, Math.min(0.3, parsed.finalProbabilityAdjustment ?? 0)),
          finalConfidence: Math.max(0, Math.min(1, parsed.finalConfidence ?? 0.5)),
          recommendation: isValidRecommendation(parsed.recommendation)
            ? parsed.recommendation
            : 'WATCH',
          recommendationReason: parsed.recommendationReason || 'No reasoning provided',
          riskFlags: Array.isArray(parsed.riskFlags) ? parsed.riskFlags : [],
          modelUsed: modelName,
        };
      }
    } catch (err) {
      console.warn(`[PostDebatePrediction] MiroFish(${modelName}) failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    return null;
  };

  // Try primary model
  const primaryResult = await attemptWithModel(model);
  if (primaryResult) return primaryResult;

  // Try fallback models
  for (const fallbackModel of FALLBACK_MODELS) {
    if (fallbackModel === model) continue;
    const fallbackResult = await attemptWithModel(fallbackModel);
    if (fallbackResult) return fallbackResult;
  }

  // Ultimate fallback: synthesize from debate data
  console.warn('[PostDebatePrediction] All MiroFish models failed. Using fallback synthesis.');
  return synthesizeFromDebate(debateResult, researchContext);
}

function isValidRecommendation(value: string): value is PostDebatePredictionResult['recommendation'] {
  return ['STRONG_BID', 'BID', 'WATCH', 'SKIP', 'FADE'].includes(value);
}
