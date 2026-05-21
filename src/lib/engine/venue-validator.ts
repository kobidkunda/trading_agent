// ── Venue Market Data Validator ──
// Pure validation before pipeline ingestion.
// No DB access, no HTTP, no 'use server'.
// Pattern: risk.ts / candidate-scoring.ts (deterministic, pure functions).

export type SpreadSource = 'REAL_ORDERBOOK' | 'ESTIMATED';

export interface VenueMarketInput {
  externalId: string;
  title: string;
  description: string;
  category: string;
  venue: string;
  status: string;
  impliedProb: number;
  liquidity: number;
  spread: number;
  volume24h?: number;
  bestBid?: number;
  bestAsk?: number;
  bidDepth?: number;
  askDepth?: number;
  priceImpact?: number;
  fillProbability?: number;
  spreadSource: SpreadSource | string;
  tokenId?: string | null;
  yesTokenId?: string | null;
  noTokenId?: string | null;
  noBestBid?: number;
  noBestAsk?: number;
  noBidDepth?: number;
  noAskDepth?: number;
  rawOrderbookJson?: string | null;
  resolutionTime?: string | null;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface BatchValidationResult {
  validCount: number;
  invalidCount: number;
  allErrors: { index: number; errors: string[] }[];
}

/**
 * Validate a single market object from a venue adapter.
 * Checks required fields exist, correct types, valid ranges.
 */
export function validateVenueMarket(
  market: Record<string, unknown>,
  venue: 'polymarket' | 'kalshi',
): ValidationResult {
  const errors: string[] = [];

  // ── Required string fields (non-empty) ──
  checkRequiredString(market, 'externalId', errors);
  checkRequiredString(market, 'title', errors);
  checkRequiredString(market, 'venue', errors);
  checkRequiredString(market, 'status', errors);
  checkRequiredString(market, 'spreadSource', errors);

  // ── Required number fields ──
  checkRequiredNumber(market, 'impliedProb', errors);
  checkRequiredNumber(market, 'liquidity', errors);
  checkRequiredNumber(market, 'spread', errors);

  // ── Range / value checks ──
  if (typeof market.impliedProb === 'number' && !Number.isNaN(market.impliedProb)) {
    if (market.impliedProb < 0 || market.impliedProb > 1) {
      errors.push(`impliedProb must be between 0 and 1, got ${market.impliedProb}`);
    }
  }

  if (typeof market.liquidity === 'number' && !Number.isNaN(market.liquidity)) {
    if (market.liquidity < 0) {
      errors.push(`liquidity must be >= 0, got ${market.liquidity}`);
    }
  }

  if (typeof market.spread === 'number' && !Number.isNaN(market.spread)) {
    if (market.spread < 0) {
      errors.push(`spread must be >= 0, got ${market.spread}`);
    }
  }

  // ── Optional range checks ──
  if (
    market.volume24h !== undefined &&
    market.volume24h !== null &&
    (typeof market.volume24h !== 'number' || Number.isNaN(market.volume24h))
  ) {
    errors.push('volume24h must be a number if provided');
  }

  if (
    market.volume24h !== undefined &&
    market.volume24h !== null &&
    typeof market.volume24h === 'number' &&
    !Number.isNaN(market.volume24h) &&
    market.volume24h < 0
  ) {
    errors.push(`volume24h must be >= 0, got ${market.volume24h}`);
  }

  // ── spreadSource enum check ──
  const spreadSource = market.spreadSource as string;
  if (spreadSource && spreadSource !== 'REAL_ORDERBOOK' && spreadSource !== 'ESTIMATED') {
    errors.push(`spreadSource must be 'REAL_ORDERBOOK' or 'ESTIMATED', got '${spreadSource}'`);
  }

  // ── Log failures ──
  if (errors.length > 0) {
    console.error(
      `[VenueValidator] Market validation failed for venue=${venue} id=${market.externalId ?? '(missing)'}: ${errors.join('; ')}`,
    );
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an array of markets from a venue adapter.
 * Returns summary counts and per-index error detail.
 */
export function validateVenueMarkets(
  markets: Record<string, unknown>[],
  venue: 'polymarket' | 'kalshi',
): BatchValidationResult {
  let validCount = 0;
  let invalidCount = 0;
  const allErrors: { index: number; errors: string[] }[] = [];

  for (let i = 0; i < markets.length; i++) {
    const result = validateVenueMarket(markets[i], venue);
    if (result.valid) {
      validCount++;
    } else {
      invalidCount++;
      allErrors.push({ index: i, errors: result.errors });
    }
  }

  console.error(
    `[VenueValidator] Batch validation for ${venue}: ${validCount} valid, ${invalidCount} invalid out of ${markets.length} total`,
  );

  return { validCount, invalidCount, allErrors };
}

// ── Helpers ──

function checkRequiredString(
  market: Record<string, unknown>,
  field: string,
  errors: string[],
): void {
  const value = market[field];

  if (value === undefined || value === null) {
    errors.push(`${field} is required (missing)`);
    return;
  }

  if (typeof value !== 'string') {
    errors.push(`${field} must be a string, got ${typeof value}`);
    return;
  }

  if (value.trim().length === 0) {
    errors.push(`${field} must be a non-empty string`);
  }
}

function checkRequiredNumber(
  market: Record<string, unknown>,
  field: string,
  errors: string[],
): void {
  const value = market[field];

  if (value === undefined || value === null) {
    errors.push(`${field} is required (missing)`);
    return;
  }

  if (typeof value !== 'number') {
    errors.push(`${field} must be a number, got ${typeof value}`);
    return;
  }

  if (Number.isNaN(value)) {
    errors.push(`${field} must not be NaN`);
  }
}