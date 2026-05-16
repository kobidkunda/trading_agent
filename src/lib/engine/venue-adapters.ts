export type NormalizedVenueStatus = 'ACTIVE' | 'CLOSED' | 'RESOLVED';

export function normalizeVenueMarketStatus(status: string): NormalizedVenueStatus {
  const normalized = status.toLowerCase();
  if (normalized === 'active' || normalized === 'open') return 'ACTIVE';
  if (normalized === 'resolved' || normalized === 'settled') return 'RESOLVED';
  return 'CLOSED';
}

export function shouldKeepVenueMarket(status: NormalizedVenueStatus): boolean {
  return status === 'ACTIVE';
}
