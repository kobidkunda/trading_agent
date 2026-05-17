import { parseCriteriaValue, serializeCriteria } from '@/lib/engine/candidate-criteria';

export interface ScanCandidateMarketLike {
  id: string;
  category: string;
  title: string;
  description: string | null;
  venue: string;
  lastSeenAt: Date;
}

export function categoryPriorityForMarket(category: string): number {
  const normalized = category.toLowerCase();
  if (['crypto', 'economics'].includes(normalized)) return 8;
  if (['technology', 'politics'].includes(normalized)) return 6;
  if (['sports', 'science'].includes(normalized)) return 4;
  return 2;
}

export function researchActionToJobSpec(
  action: 'TRIAGE' | 'TRIAGE_AND_RESEARCH' | 'FULL_RESEARCH',
  score: number,
): { type: string; priority: number; label: string } {
  if (action === 'FULL_RESEARCH' || score >= 92) {
    return { type: 'DEEP_RESEARCH', priority: 10, label: 'DEEP_RESEARCH' };
  }

  if (action === 'TRIAGE_AND_RESEARCH' || score >= 85) {
    return { type: 'STANDARD_RESEARCH', priority: 8, label: 'STANDARD_RESEARCH' };
  }

  return { type: 'QUICK_RESEARCH', priority: 6, label: 'QUICK_RESEARCH' };
}

export function mergeStructuredCriteria(existing: string | null | undefined, next: string[]): string | null {
  const merged = new Set([...parseCriteriaValue(existing), ...next]);
  return serializeCriteria(Array.from(merged));
}
