'use server';

const POLYMARKET_BASE_URL = 'https://clob.polymarket.com';

export interface PolymarketMarket {
  condition_id: string;
  question: string;
  description: string;
  category: string;
  end_date_iso: string;
  active: boolean;
  closed: boolean;
  tokens: Array<{
    token_id: string;
    outcome: string;
    price: number;
  }>;
}

export async function getPolymarketMarkets(limit: number = 100): Promise<Array<{
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
}>> {
  try {
    const response = await fetch(`${POLYMARKET_BASE_URL}/markets?limit=${limit}&active=true`, {
      next: { revalidate: 60 },
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      console.error(`Polymarket API error: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const markets = Array.isArray(data) ? data : data.markets || [];

    return markets.map((m: Record<string, unknown>) => {
      const tokens = (m.tokens || []) as Array<Record<string, unknown>>;
      const yesToken = tokens.find((t) => t.outcome === 'Yes') || tokens[0];
      const price = typeof yesToken?.price === 'number' ? yesToken.price : 0.5;
      const spread = Math.abs(price - (1 - price)) * 0.02;

      return {
        externalId: String(m.condition_id || m.id || ''),
        title: String(m.question || m.title || ''),
        description: String(m.description || ''),
        category: String(m.category || 'other').toLowerCase(),
        venue: 'POLYMARKET' as const,
        status: m.active && !m.closed ? 'ACTIVE' : 'INACTIVE',
        impliedProb: price,
        liquidity: typeof m.volume === 'number' ? m.volume : 0,
        spread: Math.round(spread * 1000) / 1000,
        volume24h: typeof m.volume24hr === 'number' ? m.volume24hr : 0,
        bestBid: price - spread / 2,
        bestAsk: price + spread / 2,
      };
    }).filter((m: { title: string; externalId: string }) => m.title && m.externalId);
  } catch (error) {
    console.error('Failed to fetch Polymarket markets:', error);
    return [];
  }
}