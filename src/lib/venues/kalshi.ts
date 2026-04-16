'use server'

const KALSHI_BASE_URL = 'https://api.elections.kalshi.com/trade-api/v2'

export interface KalshiMarket {
  ticker: string
  title: string
  subtitle: string
  yes_bid: number
  yes_ask: number
  open_interest: number
  volume: number
  close_time: string
  category: string
  status: string
  last_price: number
}

export interface KalshiMarketsResponse {
  markets: KalshiMarket[]
  cursor: string
}

export async function getKalshiMarkets(): Promise<KalshiMarket[]> {
  try {
    const response = await fetch(`${KALSHI_BASE_URL}/markets?limit=100`, {
      next: { revalidate: 60 }
    })

    if (!response.ok) {
      throw new Error(`Kalshi API error: ${response.status}`)
    }

    const data: KalshiMarketsResponse = await response.json()
    return data.markets
  } catch (error) {
    console.error('Failed to fetch Kalshi markets:', error)
    return []
  }
}

export async function getKalshiMarket(ticker: string): Promise<KalshiMarket | null> {
  try {
    const response = await fetch(`${KALSHI_BASE_URL}/markets/${ticker}`, {
      next: { revalidate: 60 }
    })

    if (!response.ok) {
      return null
    }

    const data = await response.json()
    return data.market
  } catch (error) {
    console.error('Failed to fetch Kalshi market:', error)
    return null
  }
}
