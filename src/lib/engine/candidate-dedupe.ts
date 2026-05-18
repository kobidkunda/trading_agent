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
  priceChange: number;
  priceChangeThreshold: number;
  now: string;
}

export interface ReprocessCheckResult {
  shouldReprocess: boolean;
  reason: string;
}

const COOLDOWN_HOURS_WATCH = 6;
const COOLDOWN_HOURS_DECIDED = 24;
const COOLDOWN_HOURS_EXECUTED = 24;

export const COOLDOWN_DEFAULTS = {
  WATCH_MS: COOLDOWN_HOURS_WATCH * 60 * 60 * 1000,
  DECIDED_MS: COOLDOWN_HOURS_DECIDED * 60 * 60 * 1000,
  EXECUTED_MS: COOLDOWN_HOURS_EXECUTED * 60 * 60 * 1000,
} as const;

/**
 * Determines whether an existing candidate should be reprocessed.
 *
 * Rules (evaluated in order):
 * 1. No existing candidate → always reprocess
 * 2. Cooldown active AND price moved >= threshold → override (price signal)
 * 3. Cooldown active AND new (higher) wallet signal since last action → override
 * 4. Cooldown active → skip
 * 5. EXECUTED stage with cooldown AND price unchanged → skip
 * 6. Failed research with high retry count → exponential backoff
 * 7. Otherwise → eligible
 */
export function shouldReprocessMarket(input: ReprocessCheckInput): ReprocessCheckResult {
  const cand = input.existingCandidate;

  if (!cand) {
    return { shouldReprocess: true, reason: 'new_candidate' };
  }

  const cooldownActive =
    isFuture(cand.cooldownUntil, input.now) ||
    isFuture(cand.nextEligibleAt, input.now);

  // Price override: cooldown is bypassed when price moves >= threshold
  if (cooldownActive && input.priceChange >= input.priceChangeThreshold) {
    return { shouldReprocess: true, reason: 'price_move_override' };
  }

  // Wallet signal override: new/higher wallet signal since last decision/execution
  if (cooldownActive) {
    const lastActionAt = cand.lastExecutionAt ?? cand.lastDecisionAt;
    if (
      cand.walletSignalScore != null &&
      cand.walletSignalScore > 0 &&
      (!lastActionAt || new Date(cand.cooldownUntil!).getTime() > new Date(lastActionAt).getTime())
    ) {
      return { shouldReprocess: true, reason: 'wallet_signal_override' };
    }
  }

  if (cooldownActive) {
    return { shouldReprocess: false, reason: 'cooldown_active' };
  }

  // EXECUTED market with cooldown but no price movement → still skip
  if (cand.stage === 'EXECUTED' && cand.cooldownUntil && isFuture(cand.cooldownUntil, input.now)) {
    return { shouldReprocess: false, reason: 'executed_cooldown_active' };
  }

  // Exponential backoff for failed research: 2^retry * 30min
  if (cand.stage === 'RESEARCHING' && cand.retryCount >= 2) {
    const backoffMs = Math.pow(2, cand.retryCount) * 30 * 60 * 1000;
    const lastAttemptAt = cand.lastResearchAt ? new Date(cand.lastResearchAt).getTime() : Date.now();
    const elapsedSinceLastAttempt = Date.now() - lastAttemptAt;
    if (elapsedSinceLastAttempt < backoffMs) {
      return { shouldReprocess: false, reason: `exponential_backoff:retry_${cand.retryCount}` };
    }
  }

  return { shouldReprocess: true, reason: 'eligible' };
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
