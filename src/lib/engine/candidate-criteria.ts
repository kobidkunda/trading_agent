export function serializeCriteria(criteria: string[] | null | undefined): string | null {
  if (!criteria || criteria.length === 0) {
    return null;
  }

  return JSON.stringify(criteria);
}

export function parseCriteriaValue(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter(Boolean);
    }
  } catch {}

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}
