import { Prisma } from '@prisma/client';
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
  | 'TITLE_DUPLICATE'
  | 'VENUE_DUPLICATE'
  | 'DUPLICATE'
  | 'UNRELATED';

export interface RelationshipResult {
  type: RelationshipType;
  entityOverlap: number;
  textSimilarity: number;
  confidence: number;
  reason: string;
  /** True when TITLE_DUPLICATE spans different venues — set by scanRelatedMarkets post-classify */
  crossVenueDuplicate?: boolean;
}

export type RelationshipSeverity = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCK';
export type RelationshipAction = 'NONE' | 'FLAG' | 'DEEP_RESEARCH' | 'MANUAL_REVIEW' | 'BLOCK_A_PLUS';

/**
 * Signal quality indicator for related market evaluations.
 * - FRESH_PRICE: both markets have prices updated within 6 hours — usable for trading signals
 * - STALE_PRICE: prices present but older than 6 hours — store relationship but do NOT use for signals
 * - MISSING_PRICE: one or both markets lack price data — skip evaluation entirely
 */
export type RelationSignalSource = 'FRESH_PRICE' | 'STALE_PRICE' | 'MISSING_PRICE';

const VIOLATION_MISSING_PRICE = -1;

/**
 * For directional relationships (A_IMPLIES_B, NESTED_THRESHOLD):
 * marketIdA is always the source (implying market) and marketIdB is the
 * target (implied market). The relationship is evaluated in that direction only.
 *
 * Example: "BTC > $120K" (A, source) implies "BTC > $100K" (B, target).
 * P(A) must be ≤ P(B) — the harder condition is less probable.
 * The lower threshold does NOT imply the higher one.
 *
 * Non-directional relationships (SAME_OUTCOME, OPPOSITE_OUTCOME, DUPLICATE,
 * MUTUALLY_EXCLUSIVE, COLLECTIVELY_EXHAUSTIVE, RANGE_BUCKET) have marketIdA/B
 * sorted alphabetically for deterministic storage.
 */

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

  // TITLE_DUPLICATE: very high text similarity (venue-aware promotion to VENUE_DUPLICATE happens in scanRelatedMarkets)
  if (textSim > 0.90) {
    return {
      type: 'TITLE_DUPLICATE',
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
  marketA: { impliedProb: number | null; signalSource: RelationSignalSource },
  marketB: { impliedProb: number | null; signalSource: RelationSignalSource },
): RelationshipEvaluation {
  const { type, confidence } = relationship;
  const formulaVersion = 'trusted-paper-v2';

  const signalSource = (
    marketA.signalSource === 'MISSING_PRICE' || marketB.signalSource === 'MISSING_PRICE'
  ) ? 'MISSING_PRICE' as const
    : (marketA.signalSource === 'STALE_PRICE' || marketB.signalSource === 'STALE_PRICE')
      ? 'STALE_PRICE' as const
      : 'FRESH_PRICE' as const;

  if (signalSource === 'MISSING_PRICE') {
    return {
      relationshipType: type,
      expectedRule: JSON.stringify({ rule: 'MISSING_PRICE', note: 'Cannot evaluate without price data' }),
      violationScore: VIOLATION_MISSING_PRICE,
      confidence,
      severity: 'NONE',
      action: 'NONE',
      reason: 'Missing price data for one or both markets',
      formulaVersion,
      explanation: relationship.reason,
      priceInconsistency: null,
      possibleEdge: null,
    };
  }

  const probA = marketA.impliedProb;
  const probB = marketB.impliedProb;

  let expectedRuleObj: Record<string, unknown> = { source: signalSource };
  let violationScore = 0;
  let priceInconsistency: number | null = null;
  let possibleEdge: number | null = null;
  let explanation = relationship.reason;

  switch (type) {
    case 'DUPLICATE':
    case 'TITLE_DUPLICATE':
    case 'VENUE_DUPLICATE':
    case 'SAME_OUTCOME':
      expectedRuleObj = { ...expectedRuleObj, rule: 'P(A) ≈ P(B)', direction: 'symmetric' };
      violationScore = Math.abs((probA ?? 0) - (probB ?? 0));
      priceInconsistency = violationScore;
      possibleEdge = violationScore > 0.03 ? violationScore / 2 : null;
      break;
    case 'OPPOSITE_OUTCOME':
      expectedRuleObj = { ...expectedRuleObj, rule: 'P(A) + P(B) ≈ 1', direction: 'symmetric' };
      violationScore = Math.abs(((probA ?? 0) + (probB ?? 0)) - 1);
      priceInconsistency = violationScore;
      possibleEdge = violationScore > 0.03 ? violationScore / 2 : null;
      break;
    case 'A_IMPLIES_B':
    case 'NESTED_THRESHOLD':
      expectedRuleObj = { ...expectedRuleObj, rule: 'P(A) ≤ P(B)', direction: 'A→B', sourceMarket: 'marketIdA', targetMarket: 'marketIdB' };
      violationScore = Math.max(0, (probA ?? 0) - (probB ?? 0));
      priceInconsistency = violationScore;
      possibleEdge = violationScore > 0.03 ? violationScore : null;
      break;
    case 'B_IMPLIES_A':
      expectedRuleObj = { ...expectedRuleObj, rule: 'P(B) ≤ P(A)', direction: 'B→A', sourceMarket: 'marketIdB', targetMarket: 'marketIdA' };
      violationScore = Math.max(0, (probB ?? 0) - (probA ?? 0));
      priceInconsistency = violationScore;
      possibleEdge = violationScore > 0.03 ? violationScore : null;
      break;
    case 'MUTUALLY_EXCLUSIVE': {
      const total = (probA ?? 0) + (probB ?? 0);
      expectedRuleObj = { ...expectedRuleObj, rule: 'P(A) + P(B) ≤ 1', direction: 'symmetric' };
      violationScore = Math.max(0, total - 1);
      priceInconsistency = violationScore;
      possibleEdge = violationScore > 0.03 ? violationScore : null;
      explanation = `Mutually exclusive outcomes total ${(total * 100).toFixed(1)}%`;
      break;
    }
    case 'COLLECTIVELY_EXHAUSTIVE':
    case 'RANGE_BUCKET': {
      const total = (probA ?? 0) + (probB ?? 0);
      expectedRuleObj = { ...expectedRuleObj, rule: 'P(A) + P(B) ≈ 1', direction: 'symmetric' };
      violationScore = Math.abs(total - 1);
      priceInconsistency = violationScore;
      possibleEdge = violationScore > 0.05 ? violationScore / 2 : null;
      explanation = `Combined exhaustive probability ${(total * 100).toFixed(1)}%`;
      break;
    }
    case 'UNRELATED':
    default:
      expectedRuleObj = { ...expectedRuleObj, rule: 'NONE', direction: 'none' };
      violationScore = 0;
      priceInconsistency = null;
      possibleEdge = null;
      break;
  }

  const expectedRule = JSON.stringify(expectedRuleObj);

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

    const violation = rel.violationScore ?? rel.contradictionScore ?? 0;
    if (violation > 0 && violation !== VIOLATION_MISSING_PRICE) {
      contradictory++;
      cumulativeScore += violation * 10;
      if (rel.alertText && violation > maxAlertScore) {
        maxAlert = rel.alertText;
        maxAlertScore = violation;
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

/** Check freshness: returns signalSource based on lastSeenAt age */
function freshnessToSignalSource(lastSeenAt: Date | null, latestPrice: number | null): RelationSignalSource {
  if (latestPrice == null) return 'MISSING_PRICE';
  if (!lastSeenAt) return 'MISSING_PRICE';
  const ageHours = (Date.now() - lastSeenAt.getTime()) / (1000 * 60 * 60);
  if (ageHours > 6) return 'STALE_PRICE';
  return 'FRESH_PRICE';
}

// ────────────────────────────────────────────
// Entity-Based Filter Builder
// ────────────────────────────────────────────

/** Minimum number of entity-filtered candidates before fallback kicks in */
const MIN_ENTITY_CANDIDATES = 20;
/** Max entities used when building Prisma OR filter (excess entities truncated) */
const MAX_ENTITY_FILTER_TERMS = 30;

/**
 * Build a Prisma where clause that matches markets sharing entities with the
 * extracted entity set. Uses `contains` so partial title matches work.
 */
function buildEntityFilter(entities: ExtractedEntities, _excludeId: string): Prisma.MarketWhereInput[] {
  const ors: Prisma.MarketWhereInput[] = [];

  for (const ticker of entities.tickers.slice(0, MAX_ENTITY_FILTER_TERMS)) {
    ors.push({ title: { contains: `$${ticker}` } });
  }

  for (const name of entities.names.slice(0, MAX_ENTITY_FILTER_TERMS)) {
    ors.push({ title: { contains: name } });
  }

  for (const t of entities.thresholds.slice(0, MAX_ENTITY_FILTER_TERMS)) {
    const valStr = String(t.value);
    if (valStr.length >= 2) {
      ors.push({ title: { contains: valStr } });
    }
  }

  for (const date of entities.dates.slice(0, MAX_ENTITY_FILTER_TERMS)) {
    const yearMatch = date.match(/(20\d{2})/);
    const needle = yearMatch ? yearMatch[1] : date;
    ors.push({ title: { contains: needle } });
  }

  for (const outcome of entities.outcomes.slice(0, MAX_ENTITY_FILTER_TERMS)) {
    ors.push({ title: { contains: outcome } });
  }

  return ors;
}

// ────────────────────────────────────────────
// Scan Counter
// ────────────────────────────────────────────

let relationScanRunCounter = 0;

/** Return current scan counter value for observability */
export function getRelationScanRunCounter(): number {
  return relationScanRunCounter;
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
      category: true,
      venue: true,
      latestPrice: true,
      lastSeenAt: true,
    },
  });

  if (!market) return 0;

  relationScanRunCounter++;

  const entitiesA = extractEntities(market.title);

  // ── Phase 1: Entity-filtered markets (up to 200) ──
  const entityOrs = buildEntityFilter(entitiesA, marketId);

  let entityMarkets: { id: string; title: string; category: string; venue: string; latestPrice: number | null; lastSeenAt: Date }[] = [];

  if (entityOrs.length > 0) {
    entityMarkets = await db.market.findMany({
      where: {
        id: { not: marketId },
        isActive: true,
        OR: entityOrs,
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 200,
      select: {
        id: true,
        title: true,
        category: true,
        venue: true,
        latestPrice: true,
        lastSeenAt: true,
      },
    });
  }

  // ── Phase 2: Fallback — recent-active (last 100) if entity filter yields too few ──
  let recentMarkets: { id: string; title: string; category: string; venue: string; latestPrice: number | null; lastSeenAt: Date }[] = [];

  if (entityMarkets.length < MIN_ENTITY_CANDIDATES) {
    recentMarkets = await db.market.findMany({
      where: {
        id: { not: marketId },
        isActive: true,
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        category: true,
        venue: true,
        latestPrice: true,
        lastSeenAt: true,
      },
    });
  }

  // ── Phase 3: Combine & deduplicate by id ──
  const seen = new Set<string>();
  const combined: { id: string; title: string; category: string; venue: string; latestPrice: number | null; lastSeenAt: Date }[] = [];

  for (const m of entityMarkets) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      combined.push(m);
    }
  }
  for (const m of recentMarkets) {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      combined.push(m);
    }
  }

  if (combined.length === 0) return 0;

  // ── Phase 4: Also include same-category markets for better coverage ──
  if (market.category) {
    const sameCategoryMarkets = await db.market.findMany({
      where: {
        id: { not: marketId },
        isActive: true,
        category: market.category,
      },
      orderBy: { lastSeenAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        category: true,
        venue: true,
        latestPrice: true,
        lastSeenAt: true,
      },
    });

    for (const m of sameCategoryMarkets) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        combined.push(m);
      }
    }
  }

  // ── Phase 5: Stale relation cleanup — warn for records untouched > 7 days ──
  const staleThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const staleRelations = await db.relatedMarket.findMany({
    where: {
      OR: [{ marketIdA: marketId }, { marketIdB: marketId }],
      updatedAt: { lt: staleThreshold },
    },
    select: { id: true, updatedAt: true, relationshipType: true },
  });

  if (staleRelations.length > 0) {
    const staleIds = staleRelations.map(r => r.id).slice(0, 10);
    const oldest = staleRelations.reduce(
      (min, r) => (r.updatedAt < min ? r.updatedAt : min),
      staleRelations[0].updatedAt,
    );
    console.warn(
      `[related-market] scanRun=${relationScanRunCounter} market=${marketId} ` +
      `staleRelationWarning: ${staleRelations.length} records not updated in 7+ days ` +
      `(oldest=${oldest.toISOString().slice(0, 10)}, samples=${staleIds.join(',')})`,
    );
    const veryStale = await db.relatedMarket.findMany({
      where: {
        OR: [{ marketIdA: marketId }, { marketIdB: marketId }],
        updatedAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: { id: true, marketIdA: true, marketIdB: true },
    });

    if (veryStale.length > 0) {
      const staleIdsToCheck = veryStale.map(r => [r.marketIdA, r.marketIdB]).flat();
      const stalePairMarkets = await db.market.findMany({
        where: {
          id: { in: [...new Set(staleIdsToCheck)] },
          isActive: false,
        },
        select: { id: true },
      });
      const inactiveIds = new Set(stalePairMarkets.map(m => m.id));

      const toDelete = veryStale.filter(
        r => inactiveIds.has(r.marketIdA) || inactiveIds.has(r.marketIdB),
      );

      if (toDelete.length > 0) {
        await db.relatedMarket.deleteMany({
          where: { id: { in: toDelete.map(r => r.id) } },
        });
        console.warn(
          `[related-market] scanRun=${relationScanRunCounter} ` +
          `cleaned ${toDelete.length} very-stale relations for inactive markets`,
        );
      }
    }
  }

  // ── Phase 6: Scan all combined candidates ──
  const sigSrcA = freshnessToSignalSource(market.lastSeenAt, market.latestPrice);
  let pairCount = 0;

  for (const other of combined) {
    const entitiesB = extractEntities(other.title);
    const relationship = classifyRelationship(
      market.title,
      other.title,
      entitiesA,
      entitiesB,
    );

    if (relationship.type === 'UNRELATED') continue;

    // ── Venue-aware relationship promotion ──
    let relationshipType = relationship.type;
    const crossVenueDuplicate = (
      relationship.type === 'TITLE_DUPLICATE' && market.venue !== other.venue
    );
    if (relationship.type === 'TITLE_DUPLICATE' && market.venue === other.venue) {
      relationshipType = 'VENUE_DUPLICATE';
    }

    const sigSrcB = freshnessToSignalSource(other.lastSeenAt, other.latestPrice);

    const evaluation = evaluateRelationship(
      { ...relationship, type: relationshipType, crossVenueDuplicate },
      { impliedProb: market.latestPrice, signalSource: sigSrcA },
      { impliedProb: other.latestPrice, signalSource: sigSrcB },
    );

    // Directional pair ordering:
    // For directional relationships, marketIdA is always the source, marketIdB the target.
    // B_IMPLIES_A gets normalized to A_IMPLIES_B with swapped pair.
    // For all non-directional types, sort alphabetically for deterministic storage.
    let pair: [string, string];
    let finalType = relationshipType;
    if (relationship.type === 'A_IMPLIES_B' || relationship.type === 'NESTED_THRESHOLD') {
      pair = [market.id, other.id];
    } else if (relationship.type === 'B_IMPLIES_A') {
      pair = [other.id, market.id];
      finalType = 'A_IMPLIES_B';
    } else {
      pair = [market.id, other.id].sort() as [string, string];
    }

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
          relationshipType: finalType,
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
          relationshipType: finalType,
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
