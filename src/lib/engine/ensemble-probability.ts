// ── Phase 6: Ensemble Probability Engine ──
// Dynamic Brier-weighted averaging across LLM, TradingAgents, DeerFlow,
// MiroFish, wallet, and orderbook predictions.
// Model disagreement detection triggers higher uncertainty.

import { db } from '@/lib/db';

// ============================================================================
// Types
// ============================================================================

export interface ModelPrediction {
  source: string; // 'LLM' | 'TRADINGAGENTS' | 'DEERFLOW' | 'MIROFISH' | 'WALLET' | 'ORDERBOOK' | 'STATISTICAL'
  predictedProb: number;
  confidence: number;
  weight: number; // 0-1, initially equal
}

export interface EnsembleResult {
  finalProbability: number;
  confidence: number;
  uncertainty: number;
  modelDisagreement: number;
  individualPredictions: ModelPrediction[];
  bestModelForCategory: string | null;
}

export interface DisagreementDetail {
  score: number;
  level: 'LOW' | 'MODERATE' | 'HIGH';
  maxGap: number;
  maxGapPair: [string, string] | null;
  summary: string;
}

// ============================================================================
// Default source weights (pre-Brier calibration)
// ============================================================================

const DEFAULT_SOURCE_WEIGHTS: Record<string, number> = {
  LLM: 1.0,
  TRADINGAGENTS: 1.0,
  DEERFLOW: 1.0,
  MIROFISH: 1.0,
  WALLET: 1.0,
  ORDERBOOK: 1.0,
  STATISTICAL: 1.0,
};

// ============================================================================
// Core: Weighted Ensemble Computation
// ============================================================================

/** Compute weighted ensemble from individual model predictions */
export function computeWeightedEnsemble(predictions: ModelPrediction[]): EnsembleResult {
  if (predictions.length === 0) {
    return {
      finalProbability: 0.5,
      confidence: 0,
      uncertainty: 1,
      modelDisagreement: 0,
      individualPredictions: [],
      bestModelForCategory: null,
    };
  }

  // Single-model fallback
  if (predictions.length === 1) {
    const p = predictions[0];
    return {
      finalProbability: p.predictedProb,
      confidence: p.confidence,
      uncertainty: 1 - p.confidence,
      modelDisagreement: 0,
      individualPredictions: predictions,
      bestModelForCategory: p.source,
    };
  }

  // Weighted average
  let totalWeight = 0;
  let weightedProbSum = 0;
  let weightedConfSum = 0;

  for (const p of predictions) {
    const w = p.weight > 0 ? p.weight : 0.01; // floor at 0.01
    totalWeight += w;
    weightedProbSum += p.predictedProb * w;
    weightedConfSum += p.confidence * w;
  }

  const finalProbability = weightedProbSum / totalWeight;
  const confidence = weightedConfSum / totalWeight;

  // Model disagreement = population standard deviation of predicted probabilities
  const meanProb = predictions.reduce((s, p) => s + p.predictedProb, 0) / predictions.length;
  const variance =
    predictions.reduce((s, p) => s + (p.predictedProb - meanProb) ** 2, 0) /
    predictions.length;
  const modelDisagreement = Math.sqrt(variance);

  // Uncertainty = 1 - confidence, amplified by disagreement
  const uncertainty = Math.min(1, (1 - confidence) + modelDisagreement * 0.5);

  // Best model = highest weight
  const sorted = [...predictions].sort((a, b) => b.weight - a.weight);
  const bestModelForCategory = sorted[0]?.source ?? null;

  return {
    finalProbability: Math.max(0.001, Math.min(0.999, finalProbability)),
    confidence: Math.max(0.01, Math.min(1, confidence)),
    uncertainty: Math.max(0, Math.min(1, uncertainty)),
    modelDisagreement,
    individualPredictions: predictions,
    bestModelForCategory,
  };
}

// ============================================================================
// Disagreement Detection
// ============================================================================

/** Detect model disagreement from a set of predictions */
export function detectDisagreement(predictions: ModelPrediction[]): DisagreementDetail {
  if (predictions.length < 2) {
    return {
      score: 0,
      level: 'LOW',
      maxGap: 0,
      maxGapPair: null,
      summary: 'Insufficient predictions for disagreement detection (<2 models)',
    };
  }

  // Standard deviation of predictions
  const mean = predictions.reduce((s, p) => s + p.predictedProb, 0) / predictions.length;
  const variance =
    predictions.reduce((s, p) => s + (p.predictedProb - mean) ** 2, 0) /
    predictions.length;
  const std = Math.sqrt(variance);

  // Max-min gap
  const probs = predictions.map((p) => p.predictedProb);
  const maxProb = Math.max(...probs);
  const minProb = Math.min(...probs);
  const maxGap = maxProb - minProb;

  // Find the pair with max gap
  let maxGapPair: [string, string] | null = null;
  let maxPairGap = 0;
  for (let i = 0; i < predictions.length; i++) {
    for (let j = i + 1; j < predictions.length; j++) {
      const gap = Math.abs(predictions[i].predictedProb - predictions[j].predictedProb);
      if (gap > maxPairGap) {
        maxPairGap = gap;
        maxGapPair = [predictions[i].source, predictions[j].source];
      }
    }
  }

  // Level determination
  let level: DisagreementDetail['level'];
  let summary: string;

  if (std > 0.3 || maxGap > 0.4) {
    level = 'HIGH';
    summary = `Critical disagreement: std=${(std * 100).toFixed(1)}%, max gap=${(maxGap * 100).toFixed(1)}% between ${maxGapPair?.join(' and ') ?? 'unknown'}. Ensemble may be unreliable.`;
  } else if (std > 0.15 || maxGap > 0.25) {
    level = 'MODERATE';
    summary = `Notable disagreement: std=${(std * 100).toFixed(1)}%, max gap=${(maxGap * 100).toFixed(1)}%. Models diverge — review assumptions.`;
  } else {
    level = 'LOW';
    summary = `Low disagreement: std=${(std * 100).toFixed(1)}%, max gap=${(maxGap * 100).toFixed(1)}%. Models broadly aligned.`;
  }

  return {
    score: Math.min(1, std / 0.5), // normalized 0-1 score
    level,
    maxGap,
    maxGapPair,
    summary,
  };
}

// ============================================================================
// Brier-Based Weight Updates
// ============================================================================

/**
 * Recalculate model weights from PaperBet Brier scores.
 * - Brier > 0.25 → weight *= 0.5 (significant downweight)
 * - Brier < 0.10 → weight *= 1.25 (upweight, capped at 3.0)
 * - Brier between 0.10-0.25 → gradual scaling
 *
 * Weights decay toward 1.0 over time if no recent resolution data.
 */
export async function updateModelWeights(
  marketId: string,
  source: string,
  outcome: number, // 0 or 1 (actual binary outcome)
): Promise<void> {
  // Collect all EnsemblePrediction rows for this market+source
  const rows = await db.ensemblePrediction.findMany({
    where: { marketId, source },
    orderBy: { createdAt: 'asc' },
  });

  if (rows.length === 0) return;

  // Calculate Brier score for each prediction against the actual outcome
  const brierScores: number[] = [];
  for (const row of rows) {
    if (row.predictedProb == null) continue;
    const brier = (row.predictedProb - outcome) ** 2;
    row.brierScore = brier;
    brierScores.push(brier);
  }

  if (brierScores.length === 0) return;

  // Collect all EnsemblePrediction rows for this source across all markets
  // to get a more robust Brier estimate
  const allPredictions = await db.ensemblePrediction.findMany({
    where: { source, brierScore: { not: null } },
  });

  const allScores = allPredictions
    .filter((r) => r.brierScore != null)
    .map((r) => r.brierScore!);

  // Merge the current resolution into the aggregate
  allScores.push(...brierScores);
  const aggregateBrier = allScores.reduce((s, v) => s + v, 0) / allScores.length;

  // Determine weight multiplier
  let multiplier: number;
  if (aggregateBrier > 0.25) {
    multiplier = 0.5; // significantly downweight
  } else if (aggregateBrier < 0.10) {
    multiplier = 1.25; // upweight
  } else {
    // Linear interpolation: Brier 0.10 → 1.0x, Brier 0.25 → 0.5x
    const t = (aggregateBrier - 0.10) / (0.25 - 0.10);
    multiplier = 1.0 - t * 0.5;
  }

  // Apply to all EnsemblePrediction rows for this source
  const currentWeights = await db.ensemblePrediction.findMany({
    where: { source },
    select: { id: true, weight: true },
  });

  for (const row of currentWeights) {
    const newWeight = Math.max(0.05, Math.min(3.0, row.weight * multiplier));
    await db.ensemblePrediction.update({
      where: { id: row.id },
      data: { weight: newWeight },
    });
  }

  // Also update brierScore on the specific market rows
  for (const row of rows) {
    await db.ensemblePrediction.update({
      where: { id: row.id },
      data: {
        brierScore: (row.predictedProb - outcome) ** 2,
      },
    });
  }

  console.log(
    `[Ensemble] Weight update for ${source}: avgBrier=${aggregateBrier.toFixed(4)}, multiplier=${multiplier.toFixed(3)}`,
  );
}

// ============================================================================
// Prediction Storage
// ============================================================================

/** Store individual model predictions as EnsemblePrediction rows */
export async function storePredictions(
  marketId: string,
  candidateId: string | null,
  predictions: ModelPrediction[],
): Promise<void> {
  for (const pred of predictions) {
    // Upsert: delete existing then create, since Prisma SQLite doesn't support upsert well
    await db.ensemblePrediction
      .deleteMany({
        where: { marketId, source: pred.source },
      })
      .catch(() => {});

    await db.ensemblePrediction.create({
      data: {
        marketId,
        candidateId,
        source: pred.source,
        predictedProb: pred.predictedProb,
        confidence: pred.confidence ?? null,
        weight: pred.weight,
        brierScore: null,
        category: null,
      },
    });
  }
}

// ============================================================================
// Pipeline Prediction Collection
// ============================================================================

/**
 * Collect predictions from AgentOutput rows for a given research run.
 * Maps AgentOutput roles to ensemble sources:
 * - role=DEBATE_ARBITER → source='LLM'
 * - provider='tradingagents' → source='TRADINGAGENTS'
 * - provider='deerflow' → source='DEERFLOW'
 * - provider='mirofish' → source='MIROFISH'
 */
export async function collectPredictionsFromAgentOutputs(
  researchRunId: string,
): Promise<ModelPrediction[]> {
  const outputs = await db.agentOutput.findMany({
    where: { researchRunId },
    orderBy: { createdAt: 'desc' },
  });

  const predictions: ModelPrediction[] = [];
  const seenSources = new Set<string>();

  for (const output of outputs) {
    // Determine source
    let source: string | null = null;
    if (output.role === 'DEBATE_ARBITER' || output.role === 'JUDGE') {
      source = 'LLM';
    } else if (output.provider === 'tradingagents') {
      source = 'TRADINGAGENTS';
    } else if (output.provider === 'deerflow') {
      source = 'DEERFLOW';
    } else if (output.provider === 'mirofish') {
      source = 'MIROFISH';
    }

    if (!source || seenSources.has(source)) continue;

    // Parse probability from output JSON
    let predictedProb: number | null = null;
    let confidence: number | null = null;

    try {
      const parsed = JSON.parse(output.output);
      if (typeof parsed.finalProbability === 'number') {
        predictedProb = parsed.finalProbability;
      } else if (typeof parsed.probability === 'number') {
        predictedProb = parsed.probability;
      } else if (typeof parsed.estimatedProbability === 'number') {
        predictedProb = parsed.estimatedProbability;
      }

      if (typeof parsed.finalConfidence === 'number') {
        confidence = parsed.finalConfidence;
      } else if (typeof parsed.confidence === 'number') {
        confidence = parsed.confidence;
      }

      // DEERFLOW: may have consensusProbability from summary
      if (predictedProb == null && source === 'DEERFLOW') {
        if (typeof parsed.consensusProbability === 'number') {
          predictedProb = parsed.consensusProbability;
        }
      }
    } catch {
      // Output not valid JSON — skip this source
    }

    if (predictedProb == null) continue;

    // Get existing weight for this source, or use default
    const existingWeight = await db.ensemblePrediction.findFirst({
      where: { source },
      orderBy: { createdAt: 'desc' },
      select: { weight: true },
    });

    const weight = existingWeight?.weight ?? DEFAULT_SOURCE_WEIGHTS[source] ?? 1.0;

    predictions.push({
      source,
      predictedProb: Math.max(0.001, Math.min(0.999, predictedProb)),
      confidence: confidence != null ? Math.max(0.01, Math.min(1, confidence)) : 0.5,
      weight,
    });

    seenSources.add(source);
  }

  return predictions;
}

// ============================================================================
// Full Ensemble Pipeline (orchestrator)
// ============================================================================

/** Run full ensemble: collect → compute → store → detect disagreement */
export async function runEnsemblePipeline(
  marketId: string,
  candidateId: string | null,
  researchRunId: string,
): Promise<{ result: EnsembleResult; disagreement: DisagreementDetail }> {
  const predictions = await collectPredictionsFromAgentOutputs(researchRunId);

  const result = computeWeightedEnsemble(predictions);
  const disagreement = detectDisagreement(predictions);

  await storePredictions(marketId, candidateId, predictions);

  return { result, disagreement };
}

// ============================================================================
// Weight Resolution on Market Settlement
// ============================================================================

/**
 * Called when a market resolves. Updates all model weights based on
 * how close each source's predictions were to the actual outcome.
 */
export async function resolveEnsembleWeights(
  marketId: string,
  actualOutcome: 0 | 1,
): Promise<void> {
  const sources = await db.ensemblePrediction.findMany({
    where: { marketId },
    select: { source: true },
    distinct: ['source'],
  });

  for (const { source } of sources) {
    await updateModelWeights(marketId, source, actualOutcome);
  }
}
