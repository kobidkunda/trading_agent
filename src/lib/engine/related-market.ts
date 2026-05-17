import { db } from '@/lib/db';

// ────────────────────────────────────────────
// Entity Extraction
// ────────────────────────────────────────────

export interface ExtractedEntities {
  names: string[];
  tickers: string[];
  numbers: number[];
  thresholds: { operator: string; value: number; unit: string | null }[];
  dates: string[];
  outcomes: string[];
  allTokens: string[];
}

export function extractEntities(title: string): ExtractedEntities {
  const names: string[] = [];
  const tickers: string[] = [];
  const numbers: number[] = [];
  const thresholds: { operator: string; value: number; unit: string | null }[] = [];
  const dates: string[] = [];
  const outcomes: string[] = [];

  // Tickers: $BTC, $ETH, $SOL, etc.
  const tickerRe = /\$([A-Z]{2,10})\b/g;
  let m: RegExpExecArray | null;
  while ((m = tickerRe.exec(title)) !== null) {
    tickers.push(m[1]);
  }

  // Thresholds: >, >=, <, ≤, above, below, over, under, at least, at most
  const thresholdRe = /([><≥≤]|above|below|over|under|more\s+than|less\s+than|at\s+least|at\s+most)\s*\$?(\d[\d,\.]*)\s*(K|M|B|%|million|billion|bps)?/gi;
  while ((m = thresholdRe.exec(title)) !== null) {
    const op = m[1].toLowerCase();
    const val = parseFloat(m[2].replace(/,/g, ''));
    const rawUnit = m[3]?.toUpperCase() || null;
    let adjusted = val;
    if (rawUnit === 'K') adjusted = val * 1000;
    else if (rawUnit === 'M' || rawUnit === 'MILLION') adjusted = val * 1_000_000;
    else if (rawUnit === 'B' || rawUnit === 'BILLION') adjusted = val * 1_000_000_000;
    thresholds.push({ operator: op, value: adjusted, unit: rawUnit });
    numbers.push(adjusted);
  }

  // Standalone numbers
  const numRe = /(\d[\d,\.]*)/g;
  while ((m = numRe.exec(title)) !== null) {
    const val = parseFloat(m[1].replace(/,/g, ''));
    if (!isNaN(val) && !numbers.includes(val)) {
      numbers.push(val);
    }
  }

  // Dates: Month Day, Year
  const dateRe = /(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?\s*,?\s*(20\d{2})/gi;
  while ((m = dateRe.exec(title)) !== null) {
    dates.push(m[0]);
  }

  // Year mentions (only if no month-date already captured)
  const yearRe = /\b(20\d{2})\b/g;
  const capturedYears = new Set(dates.map(d => d.match(/\d{4}/)?.[0]).filter(Boolean));
  while ((m = yearRe.exec(title)) !== null) {
    if (!capturedYears.has(m[1])) {
      dates.push(m[1]);
    }
  }

  // Q-format dates: Q1 2026, Q3 2025
  const qRe = /\bQ[1-4]\s*'?\s*(20\d{2})\b/gi;
  while ((m = qRe.exec(title)) !== null) {
    dates.push(m[0]);
  }

  // Outcomes
  const outcomeRe = /\b(yes|no|win|lose|above|below|pass|fail|approved?|rejected?|elected?|defeated?|successful|unsuccessful|true|false)\b/gi;
  while ((m = outcomeRe.exec(title)) !== null) {
    outcomes.push(m[1].toLowerCase());
  }

  // Multi-word proper names (2+ capitalized words)
  const multiNameRe = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g;
  while ((m = multiNameRe.exec(title)) !== null) {
    names.push(m[0]);
  }

  // Single-word proper names (3+ letter capitalized)
  const singleNameRe = /\b[A-Z][a-z]{3,}\b/g;
  while ((m = singleNameRe.exec(title)) !== null) {
    if (!names.includes(m[0])) {
      names.push(m[0]);
    }
  }

  // All lowercase tokens for text similarity
  const allTokens = title.toLowerCase().match(/\b[a-z0-9]+\b/g) || [];

  return { names, tickers, numbers, thresholds, dates, outcomes, allTokens };
}

// ────────────────────────────────────────────
// Title Normalization (matches candidate-dedupe)
// ────────────────────────────────────────────

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, ' ')
    .replace(/,/g, '')
    .replace(/[$!?().:%'"`~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ────────────────────────────────────────────
// Similarity Helpers
// ────────────────────────────────────────────

function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1;
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

function bigramSimilarity(a: string, b: string): number {
  const bigrams = (s: string): Set<string> => {
    const result = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      result.add(s.slice(i, i + 2));
    }
    return result;
  };
  return jaccardSimilarity(bigrams(a), bigrams(b));
}

// ────────────────────────────────────────────
// Relationship Types
// ────────────────────────────────────────────

export type RelationshipType =
  | 'SAME_OUTCOME'
  | 'OPPOSITE_OUTCOME'
  | 'A_IMPLIES_B'
  | 'B_IMPLIES_A'
  | 'MUTUALLY_EXCLUSIVE'
  | 'COLLECTIVELY_EXHAUSTIVE'
  | 'NESTED_THRESHOLD'
  | 'RANGE_BUCKET'
  | 'DUPLICATE'
  | 'UNRELATED';

export interface RelationshipResult {
  type: RelationshipType;
  entityOverlap: number;
  textSimilarity: number;
  confidence: number;
  reason: string;
}

export type RelationshipSeverity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCK';
export type RelationshipAction = 'NONE' | 'FLAG' | 'DEEP_RESEARCH' | 'MANUAL_REVIEW' | 'BLOCK_A_PLUS';

export interface RelationshipEvaluation {
  relationshipType: RelationshipType;
  expectedRule: string;
  violationScore: number;
  confidence: number;
  severity: RelationshipSeverity;
  action: RelationshipAction;
  reason: string;
  formulaVersion: string;
  explanation: string;
  priceInconsistency: number | null;
  possibleEdge: number | null;
}

/** Check if outcome set contains positive-leaning terms */
function isPositiveOutcome(outcomes: Set<string>): boolean {
  return (
    outcomes.has('yes') ||
    outcomes.has('win') ||
    outcomes.has('pass') ||
    outcomes.has('above') ||
    outcomes.has('approved') ||
    outcomes.has('elected') ||
    outcomes.has('successful') ||
    outcomes.has('true')
  );
}

/** Check if outcome set contains negative-leaning terms */
function isNegativeOutcome(outcomes: Set<string>): boolean {
  return (
    outcomes.has('no') ||
    outcomes.has('lose') ||
    outcomes.has('fail') ||
    outcomes.has('below') ||
    outcomes.has('rejected') ||
    outcomes.has('defeated') ||
    outcomes.has('unsuccessful') ||
    outcomes.has('false')
  );
}

/** Check if threshold operator is upward (above/over/more than) */
function isUpwardThreshold(op: string): boolean {
  const upward = ['>', '≥', 'above', 'over', 'more than', 'at least'];
  return upward.includes(op.toLowerCase());
}

export function classifyRelationship(
  titleA: string,
  titleB: string,
  entitiesA: ExtractedEntities,
  entitiesB: ExtractedEntities,
): RelationshipResult {
  const normA = normalizeTitle(titleA);
  const normB = normalizeTitle(titleB);
  const textSim = bigramSimilarity(normA, normB);
  const entityOverlap = jaccardSimilarity(
    new Set(entitiesA.names),
    new Set(entitiesB.names),
  );

  // DUPLICATE: very high text similarity
  if (textSim > 0.90) {
    return {
      type: 'DUPLICATE',
      entityOverlap,
      textSimilarity: textSim,
      confidence: Math.min(1, 0.8 + textSim * 0.2),
      reason: 'Titles are highly similar (>90% bigram overlap)',
    };
  }

  const sameEntity = entityOverlap > 0.5 || textSim > 0.4;

  // RANGE: title mentions "between X and Y"
  const rangeRe = /between\s+\$?\d[\d,\.]*\s+(and|&)\s+\$?\d[\d,\.]*/i;
  if ((rangeRe.test(titleA) || rangeRe.test(titleB)) && sameEntity) {
    return {
      type: 'RANGE_BUCKET',
      entityOverlap,
      textSimilarity: textSim,
      confidence: clampConfidence((entityOverlap * 0.5) + (textSim * 0.5)),
      reason: 'Range market (between X and Y)',
    };
  }

  if (sameEntity) {
    const outcomesA = new Set(entitiesA.outcomes);
    const outcomesB = new Set(entitiesB.outcomes);

    const posA = isPositiveOutcome(outcomesA);
    const negA = isNegativeOutcome(outcomesA);
    const posB = isPositiveOutcome(outcomesB);
    const negB = isNegativeOutcome(outcomesB);

    // OPPOSITE_OUTCOME: one positive, other negative for same entity
    if ((posA && !negA && negB && !posB) || (negA && !posA && posB && !negB)) {
      return {
        type: 'OPPOSITE_OUTCOME',
        entityOverlap,
        textSimilarity: textSim,
        confidence: clampConfidence((entityOverlap * 0.6) + (textSim * 0.4)),
        reason: 'Same entity with opposite outcomes (YES vs NO)',
      };
    }

    // NESTED: same entity + thresholds with different values in same direction
    if (entitiesA.thresholds.length > 0 && entitiesB.thresholds.length > 0) {
      const dirA = entitiesA.thresholds[0].operator;
      const dirB = entitiesB.thresholds[0].operator;
      const valA = entitiesA.thresholds[0].value;
      const valB = entitiesB.thresholds[0].value;

      if (isUpwardThreshold(dirA) && isUpwardThreshold(dirB) && valA !== valB) {
        return {
        type: valA > valB ? 'A_IMPLIES_B' : 'B_IMPLIES_A',
        entityOverlap,
        textSimilarity: textSim,
        confidence: clampConfidence((entityOverlap * 0.45) + (textSim * 0.25) + 0.3),
        reason: `Same entity with nested thresholds (${valA} vs ${valB})`,
      };
      }
    }

    // SAME_OUTCOME: both positive or both negative
    if ((posA && posB) || (negA && negB)) {
      return {
        type: 'SAME_OUTCOME',
        entityOverlap,
        textSimilarity: textSim,
        confidence: clampConfidence((entityOverlap * 0.55) + (textSim * 0.45)),
        reason: 'Same entity with matching outcome direction',
      };
    }

    // SAME_OUTCOME fallback: neither has clear outcomes
    if (!posA && !negA && !posB && !negB) {
      return {
        type: 'SAME_OUTCOME',
        entityOverlap,
        textSimilarity: textSim,
        confidence: clampConfidence((entityOverlap * 0.45) + (textSim * 0.35) + 0.15),
        reason: 'Same entity with no explicit outcome indicators',
      };
    }
  }

  // MUTUALLY_EXCLUSIVE: moderate overlap but different key entities
  if (entityOverlap > 0.2 && textSim > 0.3 && entitiesA.names.length > 0 && entitiesB.names.length > 0) {
    const sharedNames = entitiesA.names.filter(n => entitiesB.names.includes(n));
    const hasDifferentKey = sharedNames.length < Math.min(entitiesA.names.length, entitiesB.names.length);
    // Also check if it's an election/race context
    const electionRe = /(election|primary|nomination|candidate|race|vote|poll)/i;
    const isElection = electionRe.test(titleA) || electionRe.test(titleB);
    if (hasDifferentKey || isElection) {
      return {
        type: 'MUTUALLY_EXCLUSIVE',
        entityOverlap,
        textSimilarity: textSim,
        confidence: clampConfidence((entityOverlap * 0.4) + (textSim * 0.3) + 0.2),
        reason: 'Different entities in similar market context',
      };
    }
  }

  // CALENDAR: similar text but different dates
  if (textSim > 0.5 && entitiesA.dates.length > 0 && entitiesB.dates.length > 0) {
    const sharedDates = entitiesA.dates.filter(d => entitiesB.dates.includes(d));
    if (sharedDates.length < Math.min(entitiesA.dates.length, entitiesB.dates.length)) {
      return {
        type: 'RANGE_BUCKET',
        entityOverlap,
        textSimilarity: textSim,
        confidence: clampConfidence((entityOverlap * 0.35) + (textSim * 0.4) + 0.2),
        reason: 'Similar question with different target dates',
      };
    }
  }

  // COLLECTIVELY_EXHAUSTIVE: check if outcomes cover all possibilities
  if (sameEntity && coversAllOutcomes(entitiesA.outcomes, entitiesB.outcomes)) {
    return {
      type: 'COLLECTIVELY_EXHAUSTIVE',
      entityOverlap,
      textSimilarity: textSim,
      confidence: clampConfidence((entityOverlap * 0.5) + (textSim * 0.3) + 0.2),
      reason: 'Markets appear to cover all possible outcomes',
    };
  }

  return {
    type: 'UNRELATED',
    entityOverlap,
    textSimilarity: textSim,
    confidence: 0,
    reason: 'No strong relationship detected',
  };
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));
}

function coversAllOutcomes(outcomesA: string[], outcomesB: string[]): boolean {
  const setA = new Set(outcomesA);
  const setB = new Set(outcomesB);
  // One has YES, other has NO for same entity
  const aHasYes = isPositiveOutcome(setA) && !isNegativeOutcome(setA);
  const aHasNo = isNegativeOutcome(setA) && !isPositiveOutcome(setA);
  const bHasYes = isPositiveOutcome(setB) && !isNegativeOutcome(setB);
  const bHasNo = isNegativeOutcome(setB) && !isPositiveOutcome(setB);
  return (aHasYes && bHasNo) || (aHasNo && bHasYes);
}

// ────────────────────────────────────────────
// Contradiction Detection
// ────────────────────────────────────────────

export function evaluateRelationship(
  relationship: RelationshipResult,
  marketA: { impliedProb: number },
  marketB: { impliedProb: number },
): RelationshipEvaluation {
  const { type, confidence } = relationship;
  const formulaVersion = 'trusted-paper-v1';
  const probA = marketA.impliedProb;
  const probB = marketB.impliedProb;

  let expectedRule = '';
  let violationScore = 0;
  let priceInconsistency: number | null = null;
  let possibleEdge: number | null = null;
  let explanation = relationship.reason;

  switch (type) {
    case 'DUPLICATE':
    case 'SAME_OUTCOME':
      expectedRule = 'P(A) should approximately equal P(B)';
      violationScore = Math.abs(probA - probB);
      priceInconsistency = violationScore;
      possibleEdge = violationScore > 0.03 ? violationScore / 2 : null;
      break;
    case 'OPPOSITE_OUTCOME':
      expectedRule = 'P(A) + P(B) should approximately equal 1';
      violationScore = Math.abs((probA + probB) - 1);
      priceInconsistency = violationScore;
      possibleEdge = violationScore > 0.03 ? violationScore / 2 : null;
      break;
    case 'A_IMPLIES_B':
    case 'NESTED_THRESHOLD':
      expectedRule = 'P(A) must be less than or equal to P(B)';
      violationScore = Math.max(0, probA - probB);
      priceInconsistency = violationScore;
      possibleEdge = violationScore > 0.03 ? violationScore : null;
      break;
    case 'B_IMPLIES_A':
      expectedRule = 'P(B) must be less than or equal to P(A)';
      violationScore = Math.max(0, probB - probA);
      priceInconsistency = violationScore;
      possibleEdge = violationScore > 0.03 ? violationScore : null;
      break;
    case 'MUTUALLY_EXCLUSIVE': {
      const total = probA + probB;
      expectedRule = 'Sum of mutually exclusive probabilities must be <= 1';
      violationScore = Math.max(0, total - 1);
      priceInconsistency = violationScore;
      possibleEdge = violationScore > 0.03 ? violationScore : null;
      explanation = `Mutually exclusive outcomes total ${(total * 100).toFixed(1)}%`;
      break;
    }
    case 'COLLECTIVELY_EXHAUSTIVE':
    case 'RANGE_BUCKET': {
      const total = probA + probB;
      expectedRule = 'Exhaustive outcome probabilities should sum to approximately 1';
      violationScore = Math.abs(total - 1);
      priceInconsistency = violationScore;
      possibleEdge = violationScore > 0.05 ? violationScore / 2 : null;
      explanation = `Combined exhaustive probability ${(total * 100).toFixed(1)}%`;
      break;
    }
    case 'UNRELATED':
    default:
      expectedRule = 'No deterministic pricing rule';
      violationScore = 0;
      priceInconsistency = null;
      possibleEdge = null;
      break;
  }

  const severity = deriveSeverity(type, violationScore);
  const action = deriveAction(confidence, severity);
  const reason = buildReason(type, violationScore, severity, confidence);

  return {
    relationshipType: type,
    expectedRule,
    violationScore,
    confidence,
    severity,
    action,
    reason,
    formulaVersion,
    explanation,
    priceInconsistency,
    possibleEdge,
  };
}

function deriveSeverity(type: RelationshipType, violationScore: number): RelationshipSeverity {
  if (violationScore <= 0) return 'NONE';

  const blockThreshold = type === 'COLLECTIVELY_EXHAUSTIVE' || type === 'RANGE_BUCKET' ? 0.10 : 0.10;
  const highThreshold = type === 'COLLECTIVELY_EXHAUSTIVE' || type === 'RANGE_BUCKET' ? 0.06 : 0.06;
  const mediumThreshold = type === 'COLLECTIVELY_EXHAUSTIVE' || type === 'RANGE_BUCKET' ? 0.03 : 0.03;

  if (violationScore > blockThreshold) return 'BLOCK';
  if (violationScore > highThreshold) return 'HIGH';
  if (violationScore > mediumThreshold) return 'MEDIUM';
  return 'LOW';
}

function deriveAction(confidence: number, severity: RelationshipSeverity): RelationshipAction {
  if (confidence < 0.7) return 'NONE';
  if (severity === 'BLOCK') return 'BLOCK_A_PLUS';
  if (severity === 'HIGH') return 'DEEP_RESEARCH';
  if (severity === 'MEDIUM' || severity === 'LOW') return 'FLAG';
  return 'NONE';
}

function buildReason(
  type: RelationshipType,
  violationScore: number,
  severity: RelationshipSeverity,
  confidence: number,
): string {
  if (severity === 'NONE') {
    return `${type} relationship is within tolerance`;
  }

  const percent = (violationScore * 100).toFixed(1);
  return `${type} violation ${percent}% at ${severity} severity with ${(confidence * 100).toFixed(0)}% confidence`;
}

// ────────────────────────────────────────────
// Signal Score Computation
// ────────────────────────────────────────────

export interface RelatedMarketSignal {
  score: number; // 0-20
  totalRelated: number;
  contradictoryPairs: number;
  topAlert: string | null;
  relationshipBreakdown: Record<string, number>;
}

export async function computeRelatedMarketSignal(
  marketId: string,
): Promise<RelatedMarketSignal> {
  const related = await db.relatedMarket.findMany({
    where: {
      OR: [{ marketIdA: marketId }, { marketIdB: marketId }],
    },
  });

  if (related.length === 0) {
    return {
      score: 0,
      totalRelated: 0,
      contradictoryPairs: 0,
      topAlert: null,
      relationshipBreakdown: {},
    };
  }

  let cumulativeScore = 0;
  let contradictory = 0;
  let maxAlert: string | null = null;
  let maxAlertScore = 0;
  const breakdown: Record<string, number> = {};

  for (const rel of related) {
    breakdown[rel.relationshipType] = (breakdown[rel.relationshipType] || 0) + 1;

    if ((rel.violationScore ?? rel.contradictionScore ?? 0) > 0) {
      contradictory++;
      const score = rel.violationScore ?? rel.contradictionScore ?? 0;
      cumulativeScore += score * 10;
      if (rel.alertText && score > maxAlertScore) {
        maxAlert = rel.alertText;
        maxAlertScore = score;
      }
    }
  }

  return {
    score: Math.min(20, cumulativeScore),
    totalRelated: related.length,
    contradictoryPairs: contradictory,
    topAlert: maxAlert,
    relationshipBreakdown: breakdown,
  };
}

// ────────────────────────────────────────────
// Main Scanner Entry Point
// ────────────────────────────────────────────

export async function scanRelatedMarkets(marketId: string): Promise<number> {
  const market = await db.market.findUnique({
    where: { id: marketId },
    select: {
      id: true,
      title: true,
      latestPrice: true,
    },
  });

  if (!market) return 0;

  // Get recently active markets (last 100, excluding self)
  const recentMarkets = await db.market.findMany({
    where: {
      id: { not: marketId },
      isActive: true,
    },
    orderBy: { lastSeenAt: 'desc' },
    take: 100,
    select: {
      id: true,
      title: true,
      latestPrice: true,
    },
  });

  if (recentMarkets.length === 0) return 0;

  const entitiesA = extractEntities(market.title);
  let pairCount = 0;

  for (const other of recentMarkets) {
    const entitiesB = extractEntities(other.title);
    const relationship = classifyRelationship(
      market.title,
      other.title,
      entitiesA,
      entitiesB,
    );

    if (relationship.type === 'UNRELATED') continue;

    const evaluation = evaluateRelationship(
      relationship,
      { impliedProb: market.latestPrice ?? 0.5 },
      { impliedProb: other.latestPrice ?? 0.5 },
    );

    // Deterministic pair ordering: A < B lexicographically
    const pair = [market.id, other.id].sort();

    await db.relatedMarket.upsert({
      where: {
        marketIdA_marketIdB: {
          marketIdA: pair[0],
          marketIdB: pair[1],
        },
      },
        create: {
          marketIdA: pair[0],
          marketIdB: pair[1],
          relationshipType: relationship.type,
          relationshipConfidence: relationship.confidence,
          expectedRule: evaluation.expectedRule,
          formulaVersion: evaluation.formulaVersion,
          violationScore: evaluation.violationScore,
          violationSeverity: evaluation.severity,
          action: evaluation.action,
          explanation: evaluation.explanation,
          priceInconsistency: evaluation.priceInconsistency,
          contradictionScore: evaluation.violationScore,
          possibleEdge: evaluation.possibleEdge,
          alertText: evaluation.reason,
        },
        update: {
          relationshipType: relationship.type,
          relationshipConfidence: relationship.confidence,
          expectedRule: evaluation.expectedRule,
          formulaVersion: evaluation.formulaVersion,
          violationScore: evaluation.violationScore,
          violationSeverity: evaluation.severity,
          action: evaluation.action,
          explanation: evaluation.explanation,
          priceInconsistency: evaluation.priceInconsistency,
          contradictionScore: evaluation.violationScore,
          possibleEdge: evaluation.possibleEdge,
          alertText: evaluation.reason,
        },
      });

    pairCount++;
  }

  return pairCount;
}

/** Convenience: get the 0-20 signal score directly */
export async function getRelatedMarketSignalScore(marketId: string): Promise<number> {
  const signal = await computeRelatedMarketSignal(marketId);
  return signal.score;
}
