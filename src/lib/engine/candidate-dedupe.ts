import { createHash } from 'node:crypto';

export type CandidateSkipReason =
  | 'DUPLICATE_MARKET'
  | 'COOLDOWN_ACTIVE'
  | 'PROCESSING_LOCKED';

export interface ExistingCandidateState {
  stage: string;
  cooldownUntil: string | null;
  nextEligibleAt: string | null;
  lockExpiresAt: string | null;
}

export interface CandidateDedupeInput {
  venue: string;
  externalId: string;
  normalizedTitle: string;
  titleHash: string;
  resolutionTime: string | null;
  existingMarket: { venue: string; externalId: string } | null;
  existingCandidate: ExistingCandidateState | null;
  now: string;
  priceChangeThreshold: number;
  currentProbability: number;
  previousProbability: number;
}

export interface CandidateDedupeDecision {
  skip: boolean;
  reason: CandidateSkipReason | null;
}

// ── Reprocess / cooldown override ──────────────────────────────────────

export type ReprocessReason =
  | 'new_candidate'
  | 'price_move_3pct'
  | 'liquidity_change_25pct'
  | 'spread_improve_30pct'
  | 'wallet_signal_new'
  | 'related_contradiction'
  | 'cooldown_expired'
  | 'manual_force'
  | 'eligible'
  | `exponential_backoff:retry_${number}`
  | `terminal_decided`
  | `terminal_executed`
  | 'cooldown_active';

export interface ReprocessCandidateState {
  stage: string;
  cooldownUntil: string | null;
  nextEligibleAt: string | null;
  lastDecisionAt: string | null;
  lastExecutionAt: string | null;
  lastResearchAt: string | null;
  walletSignalScore: number | null;
  retryCount: number;
}

export interface ReprocessCheckInput {
  existingCandidate: ReprocessCandidateState | null;
  /** Absolute price change (0-1 scale) */
  priceChange: number;
  priceChangeThreshold: number;
  /** Absolute liquidity change as fraction of previous (0-∞) */
  liquidityChange: number;
  liquidityChangeThreshold: number;
  /** Spread improvement as fraction of previous (positive = tightened) */
  spreadImprovement: number;
  spreadImprovementThreshold: number;
  /** New wallet signal detected since last action */
  hasNewWalletSignal: boolean;
  /** Related-market contradiction surfaced since last check */
  hasRelatedContradiction: boolean;
  now: string;
}

export interface ReprocessCheckResult {
  shouldReprocess: boolean;
  reason: ReprocessReason | string;
}

const COOLDOWN_HOURS_WATCH = 6;
const COOLDOWN_HOURS_DECIDED = 12;
const COOLDOWN_HOURS_EXECUTED = 24;

export const COOLDOWN_DEFAULTS = {
  WATCH_MS: COOLDOWN_HOURS_WATCH * 60 * 60 * 1000,
  DECIDED_MS: COOLDOWN_HOURS_DECIDED * 60 * 60 * 1000,
  EXECUTED_MS: COOLDOWN_HOURS_EXECUTED * 60 * 60 * 1000,
} as const;

/**
 * Determines whether an existing candidate should be reprocessed.
 *
 * Material-change gate: only rescore/reenqueue if the market materially changed
 * (price move, liquidity change, spread improvement) or has new signals.
 * REFRESHED_ONLY markets get snapshots but not new candidate jobs.
 *
 * Rules (evaluated in order):
 * 1. No existing candidate → new_candidate
 * 2. Price moved >= 3% → price_move_3pct (material change)
 * 3. Liquidity changed >= 25% → liquidity_change_25pct (material change)
 * 4. Spread improved >= 30% → spread_improve_30pct (material change)
 * 5. New wallet signal → wallet_signal_new
 * 6. Related-market contradiction → related_contradiction
 * 7. Terminal stages (DECIDED/EXECUTED): only reprocess if material change or manual force
 *    DECIDED cooldown = 12h, EXECUTED cooldown = 24h
 * 8. Cooldown active → cooldown_active
 * 9. Exponential backoff for RESEARCHING retries
 * 10. Otherwise → cooldown_expired
 */
export function shouldReprocessMarket(input: ReprocessCheckInput): ReprocessCheckResult {
  const cand = input.existingCandidate;

  if (!cand) {
    return { shouldReprocess: true, reason: 'new_candidate' };
  }

  // ── Material change checks (bypass all cooldowns) ──────────────────────
  if (input.priceChange >= input.priceChangeThreshold) {
    return { shouldReprocess: true, reason: 'price_move_3pct' };
  }

  if (input.liquidityChange >= input.liquidityChangeThreshold) {
    return { shouldReprocess: true, reason: 'liquidity_change_25pct' };
  }

  if (input.spreadImprovement >= input.spreadImprovementThreshold) {
    return { shouldReprocess: true, reason: 'spread_improve_30pct' };
  }

  // ── Signal-based overrides ───────────────────────────────────────────
  if (input.hasNewWalletSignal) {
    return { shouldReprocess: true, reason: 'wallet_signal_new' };
  }

  if (input.hasRelatedContradiction) {
    return { shouldReprocess: true, reason: 'related_contradiction' };
  }

  // ── Terminal stage gate ──────────────────────────────────────────────
  const isTerminal = cand.stage === 'DECIDED' || cand.stage === 'EXECUTED';
  if (isTerminal) {
    // Only reprocess if material change (checked above) or manual force
    // (manual_force is set externally; if not material, block)
    return { shouldReprocess: false, reason: `terminal_${cand.stage.toLowerCase()}` };
  }

  // ── Cooldown check ───────────────────────────────────────────────────
  const cooldownActive =
    isFuture(cand.cooldownUntil, input.now) ||
    isFuture(cand.nextEligibleAt, input.now);

  if (cooldownActive) {
    return { shouldReprocess: false, reason: 'cooldown_active' };
  }

  // ── Exponential backoff for failed research ───────────────────────────
  if (cand.stage === 'RESEARCHING' && cand.retryCount >= 2) {
    const backoffMs = Math.pow(2, cand.retryCount) * 30 * 60 * 1000;
    const lastAttemptAt = cand.lastResearchAt ? new Date(cand.lastResearchAt).getTime() : Date.now();
    const elapsedSinceLastAttempt = Date.now() - lastAttemptAt;
    if (elapsedSinceLastAttempt < backoffMs) {
      return { shouldReprocess: false, reason: `exponential_backoff:retry_${cand.retryCount}` };
    }
  }

  return { shouldReprocess: true, reason: 'cooldown_expired' };
}

export function computeNextEligibleAt(now: Date, hoursFromNow: number): Date {
  return new Date(now.getTime() + hoursFromNow * 60 * 60 * 1000);
}

export function normalizeMarketTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u{1F300}-\u{1FAFF}]/gu, ' ')
    .replace(/,/g, '')
    .replace(/[$!?().:%'"`~\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function createTitleHash(title: string): string {
  return createHash('sha256').update(normalizeMarketTitle(title)).digest('hex');
}

export function hasMeaningfulPriceMove(previousProbability: number, currentProbability: number, threshold: number): boolean {
  return Math.abs(currentProbability - previousProbability) >= threshold;
}

function isFuture(iso: string | null, now: string): boolean {
  if (!iso) return false;
  return new Date(iso).getTime() > new Date(now).getTime();
}

export function shouldSkipCandidate(input: CandidateDedupeInput): CandidateDedupeDecision {
  if (input.existingMarket && input.existingMarket.venue === input.venue && input.existingMarket.externalId === input.externalId) {
    return { skip: true, reason: 'DUPLICATE_MARKET' };
  }

  if (
    input.existingCandidate?.stage === 'RESEARCHING' &&
    isFuture(input.existingCandidate.lockExpiresAt, input.now)
  ) {
    return { skip: true, reason: 'PROCESSING_LOCKED' };
  }

  const cooldownActive =
    isFuture(input.existingCandidate?.cooldownUntil ?? null, input.now) ||
    isFuture(input.existingCandidate?.nextEligibleAt ?? null, input.now);

  if (cooldownActive && !hasMeaningfulPriceMove(input.previousProbability, input.currentProbability, input.priceChangeThreshold)) {
    return { skip: true, reason: 'COOLDOWN_ACTIVE' };
  }

  return { skip: false, reason: null };
}
