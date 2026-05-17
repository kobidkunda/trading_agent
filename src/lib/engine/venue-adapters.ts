export type NormalizedVenueStatus = 'ACTIVE' | 'CLOSED' | 'RESOLVED';

export interface VenueNormalizedMarket {
  venue: string
  externalId: string
  title: string
  description: string
  category: string
  status: string
  resolutionTime: Date | null
  impliedProbability: number
  liquidity: number
  volume24h: number
  bestBid: number | null
  bestAsk: number | null
  spread: number
  estimatedSpread: number
  rawJson: Record<string, unknown>
}

export interface VenueAdapter {
  listActiveMarkets(limit?: number, cursor?: string): Promise<{ markets: VenueNormalizedMarket[], nextCursor: string | null, hasMore: boolean }>
  listResolvedMarkets(since?: Date): Promise<VenueNormalizedMarket[]>
  getMarketSnapshot(externalId: string): Promise<VenueNormalizedMarket | null>
  getOrderbook(externalId: string): Promise<{ bestBid: number | null, bestAsk: number | null, bidDepth: number, askDepth: number, spread: number } | null>
  normalizeMarket(raw: Record<string, unknown>): VenueNormalizedMarket
  normalizeResolution(raw: Record<string, unknown>): { outcome: string, resolvedProb: number, resolvedAt: Date }
}

export function normalizeVenueMarketStatus(status: string): NormalizedVenueStatus {
  const normalized = status.toLowerCase();
  if (normalized === 'active' || normalized === 'open') return 'ACTIVE';
  if (normalized === 'resolved' || normalized === 'settled') return 'RESOLVED';
  return 'CLOSED';
}

export function shouldKeepVenueMarket(status: NormalizedVenueStatus): boolean {
  return status === 'ACTIVE';
}
