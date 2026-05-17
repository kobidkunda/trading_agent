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
  | 'NESTED'
  | 'MUTUALLY_EXCLUSIVE'
  | 'COLLECTIVELY_EXHAUSTIVE'
  | 'RANGE'
  | 'CALENDAR'
  | 'DUPLICATE'
  | 'UNRELATED';

export interface RelationshipResult {
  type: RelationshipType;
  entityOverlap: number;
  textSimilarity: number;
  reason: string;
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
      reason: 'Titles are highly similar (>90% bigram overlap)',
    };
  }

  const sameEntity = entityOverlap > 0.5 || textSim > 0.4;

  // RANGE: title mentions "between X and Y"
  const rangeRe = /between\s+\$?\d[\d,\.]*\s+(and|&)\s+\$?\d[\d,\.]*/i;
  if ((rangeRe.test(titleA) || rangeRe.test(titleB)) && sameEntity) {
    return {
      type: 'RANGE',
      entityOverlap,
      textSimilarity: textSim,
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
          type: 'NESTED',
          entityOverlap,
          textSimilarity: textSim,
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
        reason: 'Same entity with matching outcome direction',
      };
    }

    // SAME_OUTCOME fallback: neither has clear outcomes
    if (!posA && !negA && !posB && !negB) {
      return {
        type: 'SAME_OUTCOME',
        entityOverlap,
        textSimilarity: textSim,
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
        reason: 'Different entities in similar market context',
      };
    }
  }

  // CALENDAR: similar text but different dates
  if (textSim > 0.5 && entitiesA.dates.length > 0 && entitiesB.dates.length > 0) {
    const sharedDates = entitiesA.dates.filter(d => entitiesB.dates.includes(d));
    if (sharedDates.length < Math.min(entitiesA.dates.length, entitiesB.dates.length)) {
      return {
        type: 'CALENDAR',
        entityOverlap,
        textSimilarity: textSim,
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
      reason: 'Markets appear to cover all possible outcomes',
    };
  }

  return {
    type: 'UNRELATED',
    entityOverlap,
    textSimilarity: textSim,
    reason: 'No strong relationship detected',
  };
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

export interface ContradictionResult {
  hasContradiction: boolean;
  contradictionScore: number; // 0-1
  priceInconsistency: number | null;
  possibleEdge: number | null;
  alertText: string | null;
}

export function detectContradiction(
  relationship: RelationshipResult,
  marketA: { impliedProb: number },
  marketB: { impliedProb: number },
): ContradictionResult {
  const { type } = relationship;
  let score = 0;
  let inconsistency: number | null = null;
  let edge: number | null = null;
  let alert: string | null = null;

  switch (type) {
    case 'NESTED': {
      // Higher threshold probability should NOT exceed lower threshold probability
      // e.g., BTC>120K should be ≤ BTC>100K probability
      inconsistency = Math.abs(marketA.impliedProb - marketB.impliedProb);
      if (inconsistency > 0.10) {
        score = Math.min(1, inconsistency * 5);
        edge = inconsistency;
        alert = `Nested market pricing anomaly: ${(inconsistency * 100).toFixed(1)}% divergence between thresholds`;
      }
      break;
    }
    case 'MUTUALLY_EXCLUSIVE': {
      const sum = marketA.impliedProb + marketB.impliedProb;
      if (sum > 1.0) {
        inconsistency = sum - 1.0;
        score = Math.min(1, inconsistency * 10);
        edge = inconsistency;
        alert = `Mutually exclusive markets sum to ${(sum * 100).toFixed(1)}% (exceeds 100%)`;
      }
      break;
    }
    case 'SAME_OUTCOME': {
      inconsistency = Math.abs(marketA.impliedProb - marketB.impliedProb);
      if (inconsistency > 0.05) {
        score = Math.min(1, inconsistency * 8);
        edge = inconsistency / 2;
        alert = `Same-outcome prices diverge by ${(inconsistency * 100).toFixed(1)}%`;
      }
      break;
    }
    case 'OPPOSITE_OUTCOME': {
      // YES price + NO price should approximate 1.0
      const sum = marketA.impliedProb + marketB.impliedProb;
      const deviation = Math.abs(sum - 1.0);
      if (deviation > 0.10) {
        inconsistency = deviation;
        score = Math.min(1, deviation * 5);
        edge = deviation / 2;
        alert = `YES/NO pair diverges from 100%: ${(sum * 100).toFixed(1)}% total`;
      }
      break;
    }
    case 'CALENDAR': {
      inconsistency = Math.abs(marketA.impliedProb - marketB.impliedProb);
      if (inconsistency > 0.20) {
        score = Math.min(0.7, inconsistency * 3);
        alert = `Calendar-dated markets diverge by ${(inconsistency * 100).toFixed(1)}%`;
      }
      break;
    }
    default:
      break;
  }

  return {
    hasContradiction: score > 0,
    contradictionScore: score,
    priceInconsistency: inconsistency,
    possibleEdge: edge,
    alertText: alert,
  };
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

    if (rel.contradictionScore && rel.contradictionScore > 0) {
      contradictory++;
      cumulativeScore += rel.contradictionScore * 10; // 0-1 → 0-10 per pair
      if (rel.alertText && rel.contradictionScore > maxAlertScore) {
        maxAlert = rel.alertText;
        maxAlertScore = rel.contradictionScore;
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

    const contradiction = detectContradiction(
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
        priceInconsistency: contradiction.priceInconsistency,
        contradictionScore: contradiction.contradictionScore,
        possibleEdge: contradiction.possibleEdge,
        alertText: contradiction.alertText,
      },
      update: {
        relationshipType: relationship.type,
        priceInconsistency: contradiction.priceInconsistency,
        contradictionScore: contradiction.contradictionScore,
        possibleEdge: contradiction.possibleEdge,
        alertText: contradiction.alertText,
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
