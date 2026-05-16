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
