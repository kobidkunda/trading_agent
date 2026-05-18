// ── Phase 6: Ensemble Probability Engine ──
// Dynamic Brier-weighted averaging across LLM, TradingAgents, DeerFlow,
// MiroFish, wallet, related-market, orderbook, bias-adjusted baseline,
// and statistical baseline predictions.
// Weights sourced from ModelRegistryRecord (DB-persisted per category).
// Weak models auto-disabled after 100+ samples with rollingBrier > 0.3.
// Model disagreement detection triggers higher uncertainty.
// P1.11: Non-LLM signal sources (wallet, related-market, orderbook,
// bias-adjusted baseline, statistical baseline) contribute probability
// estimates with per-source confidence scores.

import { db } from '@/lib/db';
import { ModelRegistry } from '@/lib/engine/model-registry';
import { computeFreshWalletSignal } from '@/lib/engine/wallet-signal';
import { computeRelatedMarketSignal } from '@/lib/engine/related-market';
import { computeBiasAdjustedProb } from '@/lib/engine/bias-correction';

// ============================================================================
// Non-LLM Signal Converters (P1.11)
// ============================================================================

/**
 * Wallet signal → probability contribution.
 * Weight = min(signalScore / 20, 0.5). Confidence = 0.3 to 0.7 based on signal strength.
 */
export async function convertWalletSignalToProbability(
  marketId: string,
  marketPrice: number,
  category: string,
): Promise<ModelPrediction | null> {
  const fresh = await computeFreshWalletSignal(marketId);
  if (!fresh.hasTrustedSignal || fresh.score === 0) return null;

  const signalScore = fresh.score;
  const direction = fresh.signalReason.includes('YES') ? 'YES' : 'NO';
  const probAdjust = (signalScore / 20) * (direction === 'YES' ? 0.05 : -0.05);
  const predictedProb = Math.max(0.001, Math.min(0.999, marketPrice + probAdjust));
  const weight = Math.min(signalScore / 20, 0.5);
  const confidence = Math.max(0.3, Math.min(0.7, 0.3 + (signalScore / 20) * 0.4));

  return {
    source: 'WALLET_SIGNAL',
    predictedProb,
    confidence,
    weight,
    category,
  };
}

/**
 * Related-market violation score → probability contribution.
 * Weight = 0.3. Confidence = 0.2 to 0.5.
 */
export async function convertRelatedMarketToProbability(
  marketId: string,
  marketPrice: number,
  category: string,
): Promise<ModelPrediction | null> {
  const signal = await computeRelatedMarketSignal(marketId);
  if (signal.score === 0 || signal.contradictoryPairs === 0) return null;

  const violationScore = signal.score;
  const probAdjust = (violationScore / 10) * 0.03;
  const predictedProb = Math.max(0.001, Math.min(0.999, marketPrice + probAdjust));
  const weight = 0.3;
  const confidence = Math.max(0.2, Math.min(0.5, 0.2 + (violationScore / 20) * 0.3));

  return {
    source: 'RELATED_MARKET',
    predictedProb,
    confidence,
    weight,
    category,
  };
}

/**
 * Orderbook pressure → probability contribution.
 * Tight spread + bid pressure → +0.02, ask pressure → -0.02.
 * Weight = 0.25.
 */
export async function convertOrderbookToProbability(
  marketId: string,
  marketPrice: number,
  category: string,
): Promise<ModelPrediction | null> {
  const snapshot = await db.orderbookSnapshot.findFirst({
    where: { marketId },
    orderBy: { capturedAt: 'desc' },
  });

  if (!snapshot || snapshot.bestBid == null || snapshot.bestAsk == null) return null;

  const spreadRatio = snapshot.bestAsk > 0 ? snapshot.bestBid / snapshot.bestAsk : 0;
  const isTightSpread = spreadRatio > 0.98;

  if (!isTightSpread) return null;

  const depthImbalance = snapshot.depthImbalance ?? 0;
  const isBidPressure = depthImbalance > 0;

  const predictedProb = isBidPressure
    ? Math.max(0.001, Math.min(0.999, marketPrice + 0.02))
    : Math.max(0.001, Math.min(0.999, marketPrice - 0.02));

  const confidence = isTightSpread ? 0.4 : 0.25;

  return {
    source: 'ORDERBOOK',
    predictedProb,
    confidence,
    weight: 0.25,
    category,
  };
}

/**
 * Bias-adjusted baseline → probability contribution.
 * Weight = correctionConfidence from computeBiasAdjustedProb().
 */
export function biasAdjustedBaseline(
  marketPrice: number,
  category: string,
  timeToResolution: number,
  liquidity: number,
): ModelPrediction {
  const correction = computeBiasAdjustedProb({
    marketPrice,
    category,
    timeToResolution,
    liquidity,
  });

  return {
    source: 'BIAS_ADJUSTED_BASELINE',
    predictedProb: correction.biasAdjustedProb,
    confidence: correction.correctionConfidence,
    weight: correction.correctionConfidence,
    category,
  };
}

/**
 * Statistical baseline → simple moving average of last 10 snapshots.
 * Weight = 0.1.
 */
export async function statisticalBaseline(
  marketId: string,
  category: string,
): Promise<ModelPrediction | null> {
  const snapshots = await db.marketSnapshot.findMany({
    where: { marketId },
    orderBy: { capturedAt: 'desc' },
    take: 10,
    select: { impliedProb: true },
  });

  if (snapshots.length === 0) return null;

  const avgProb = snapshots.reduce((s, sn) => s + sn.impliedProb, 0) / snapshots.length;

  return {
    source: 'STATISTICAL_BASELINE',
    predictedProb: Math.max(0.001, Math.min(0.999, avgProb)),
    confidence: Math.min(0.3, snapshots.length / 50),
    weight: 0.1,
    category,
  };
}

// ============================================================================
// Types
// ============================================================================

export interface ModelPrediction {
  source: string; // modelName:version or legacy source label
  predictedProb: number;
  confidence: number;
  weight: number; // from ModelRegistry, default 1.0
  category: string | null;
  perSourceConfidence?: number; // P1.11: per-source confidence override
  flagForReview?: boolean; // P1.11: flag if confidence < 0.3
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

/** Detect model disagreement from a set of predictions using weighted std */
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

  // Weighted mean
  const totalWeight = predictions.reduce((s, p) => s + p.weight, 0);
  const weightedMean = predictions.reduce((s, p) => s + p.predictedProb * p.weight, 0) / totalWeight;

  // Weighted variance & std
  const weightedVariance =
    predictions.reduce((s, p) => s + p.weight * (p.predictedProb - weightedMean) ** 2, 0) /
    totalWeight;
  const std = Math.sqrt(weightedVariance);

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

  // P1.11: flag models with confidence < 0.3 for review
  const lowConfidenceModels = predictions.filter((p) => p.confidence < 0.3);
  const flaggedSources = lowConfidenceModels.map((p) => p.source);

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

  if (flaggedSources.length > 0) {
    summary += ` Flagged for review (confidence < 0.3): ${flaggedSources.join(', ')}.`;
    if (level === 'LOW' && flaggedSources.length >= predictions.length / 2) {
      level = 'MODERATE';
    }
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
 * Persists weight updates to ModelRegistryRecord via ModelRegistry.evaluateModel()
 * AND to EnsemblePrediction rows for backward compatibility.
 * Weak models (rollingBrier>0.3 with 100+ samples) get status=DISABLED.
 */
export async function updateModelWeights(
  marketId: string,
  source: string,
  outcome: number, // 0 or 1 (actual binary outcome)
  category?: string | null,
): Promise<void> {
  const rows = await db.ensemblePrediction.findMany({
    where: { marketId, source },
    orderBy: { createdAt: 'asc' },
  });

  if (rows.length === 0) return;

  // Calculate Brier score for each prediction against the actual outcome
  const brierScores: number[] = [];
  const resolvedCategory = category ?? rows.find((r) => r.category)?.category ?? null;

  for (const row of rows) {
    if (row.predictedProb == null) continue;
    const brier = (row.predictedProb - outcome) ** 2;
    row.brierScore = brier;
    brierScores.push(brier);
  }

  if (brierScores.length === 0) return;

  // Collect all EnsemblePrediction rows for this source across all markets
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
    multiplier = 0.5;
  } else if (aggregateBrier < 0.10) {
    multiplier = 1.25;
  } else {
    // Linear interpolation: Brier 0.10 → 1.0x, Brier 0.25 → 0.5x
    const t = (aggregateBrier - 0.10) / (0.25 - 0.10);
    multiplier = 1.0 - t * 0.5;
  }

  // Persist to ModelRegistryRecord per resolved category
  if (resolvedCategory) {
    try {
      // Evaluate using average Brier of this batch against the model registry
      const avgBrier = brierScores.reduce((s, v) => s + v, 0) / brierScores.length;
      await ModelRegistry.evaluateModel(source, resolvedCategory, avgBrier);
    } catch (e) {
      console.error(`[Ensemble] ModelRegistry.evaluateModel failed for ${source}/${resolvedCategory}:`, e);
    }
  }

  // Also update brierScore on EnsemblePrediction rows (backward compat)
  for (const row of rows) {
    await db.ensemblePrediction.update({
      where: { id: row.id },
      data: {
        brierScore: (row.predictedProb - outcome) ** 2,
      },
    });
  }

  // Apply multiplier to all EnsemblePrediction rows for this source
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
        confidence: pred.perSourceConfidence ?? pred.confidence ?? null,
        weight: pred.weight,
        brierScore: null,
        category: pred.category ?? null,
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
 *
 * When AgentOutput has modelUsed, source becomes "modelUsed:category".
 * Weights come from ModelRegistryRecord.getWeights(category), not from
 * stale EnsemblePrediction rows.
 */
export async function collectPredictionsFromAgentOutputs(
  researchRunId: string,
  category: string,
): Promise<ModelPrediction[]> {
  const outputs = await db.agentOutput.findMany({
    where: { researchRunId },
    orderBy: { createdAt: 'desc' },
  });

  const registryWeights = await ModelRegistry.getWeights(category);

  const predictions: ModelPrediction[] = [];
  const seenSources = new Set<string>();

  for (const output of outputs) {
    // Determine source — prefer modelUsed:version:category if available,
    // fall back to legacy provider-based labels
    let source: string | null = null;
    if (output.modelUsed) {
      // modelUsed may already be "modelName:version" or just "modelName"
      source = output.modelUsed.startsWith('LLM') || output.modelUsed === 'LLM'
        ? 'LLM'
        : output.provider === 'tradingagents'
          ? 'TRADINGAGENTS'
          : output.provider === 'deerflow'
            ? 'DEERFLOW'
            : output.provider === 'mirofish'
              ? 'MIROFISH'
              : output.modelUsed;
    } else if (output.role === 'DEBATE_ARBITER' || output.role === 'JUDGE') {
      source = 'LLM';
    } else if (output.role === 'TRADINGAGENTS_NATIVE') {
      source = 'TRADINGAGENTS_NATIVE';
    } else if (output.provider === 'tradingagents') {
      source = 'TRADINGAGENTS';
    } else if (output.provider === 'deerflow') {
      source = 'DEERFLOW';
    } else if (output.provider === 'mirofish') {
      source = 'MIROFISH';
    }

    if (!source || seenSources.has(source)) continue;

    // Resolve weight from ModelRegistry, keyed as "modelName:category"
    let weight = registryWeights[`${source}:${category}`];
    if (weight == null) {
      // Try exact source match (legacy labels)
      weight = registryWeights[source];
    }
    if (weight == null) {
      // Native graph analysis: lower weight since it's read-only supplementary signal
      if (source === 'TRADINGAGENTS_NATIVE') {
        weight = 0.15;
      } else {
        weight = 1.0;
      }
    }

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

    predictions.push({
      source,
      predictedProb: Math.max(0.001, Math.min(0.999, predictedProb)),
      confidence: confidence != null ? Math.max(0.01, Math.min(1, confidence)) : 0.5,
      weight,
      category,
    });

    seenSources.add(source);
  }

  return predictions;
}

// ============================================================================
// Full Ensemble Pipeline (orchestrator)
// ============================================================================

/** Run full ensemble: collect → merge non-LLM signals → compute → store → detect disagreement */
export async function runEnsemblePipeline(
  marketId: string,
  candidateId: string | null,
  researchRunId: string,
  category: string,
): Promise<{ result: EnsembleResult; disagreement: DisagreementDetail }> {
  const llmPredictions = await collectPredictionsFromAgentOutputs(researchRunId, category);

  const market = await db.market.findUnique({
    where: { id: marketId },
    select: { latestPrice: true, latestLiquidity: true, resolutionTime: true },
  });

  const marketPrice = market?.latestPrice ?? 0.5;
  const liquidity = market?.latestLiquidity ?? 1000;
  const timeToResolution = market?.resolutionTime
    ? Math.max(1, (new Date(market.resolutionTime).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : 30;

  const nonLlmPredictions: ModelPrediction[] = [];

  const walletPred = await convertWalletSignalToProbability(marketId, marketPrice, category);
  if (walletPred) nonLlmPredictions.push(walletPred);

  const relatedPred = await convertRelatedMarketToProbability(marketId, marketPrice, category);
  if (relatedPred) nonLlmPredictions.push(relatedPred);

  const orderbookPred = await convertOrderbookToProbability(marketId, marketPrice, category);
  if (orderbookPred) nonLlmPredictions.push(orderbookPred);

  const biasBaseline = biasAdjustedBaseline(marketPrice, category, timeToResolution, liquidity);
  nonLlmPredictions.push(biasBaseline);

  const statBaseline = await statisticalBaseline(marketId, category);
  if (statBaseline) nonLlmPredictions.push(statBaseline);

  const allPredictions = [...llmPredictions, ...nonLlmPredictions];

  const result = computeWeightedEnsemble(allPredictions);
  const disagreement = detectDisagreement(allPredictions);

  await storePredictions(marketId, candidateId, allPredictions);

  return { result, disagreement };
}

// ============================================================================
// Weight Resolution on Market Settlement
// ============================================================================

/**
 * Called when a market resolves. Updates all model weights based on
 * how close each source's predictions were to the actual outcome.
 * Persists to both EnsemblePrediction rows and ModelRegistryRecord.
 */
export async function resolveEnsembleWeights(
  marketId: string,
  actualOutcome: 0 | 1,
): Promise<void> {
  const sources = await db.ensemblePrediction.findMany({
    where: { marketId },
    select: { source: true, category: true },
    distinct: ['source'],
  });

  for (const { source, category } of sources) {
    await updateModelWeights(marketId, source, actualOutcome, category);
  }
}
