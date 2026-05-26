import { describe, expect, it } from 'bun:test';
import { normalizeKalshiMarket, type KalshiMarket } from '@/lib/venues/kalshi';

function makeMarket(overrides: Partial<KalshiMarket> = {}): KalshiMarket {
  return {
    ticker: 'KXTEST-1',
    title: 'Will Team A win?',
    subtitle: 'Single market',
    yes_sub_title: 'Yes',
    yes_bid: 0.41,
    yes_ask: 0.43,
    yes_bid_dollars: '0.4100',
    yes_ask_dollars: '0.4300',
    open_interest: 0,
    volume: 120,
    volume_24h_fp: '120.00',
    volume_fp: '120.00',
    liquidity_dollars: '250.00',
    open_interest_fp: '250.00',
    yes_bid_size_fp: '35.00',
    yes_ask_size_fp: '42.00',
    last_price: 0.42,
    last_price_dollars: '0.4200',
    close_time: '2026-05-30T00:00:00Z',
    category: 'sports',
    status: 'active',
    ...overrides,
  };
}

describe('normalizeKalshiMarket', () => {
  it('drops multileg combo markets', () => {
    const market = makeMarket({
      title: 'yes A,yes B,yes C',
      mve_selected_legs: [{ market_ticker: 'A' }, { market_ticker: 'B' }],
      custom_strike: { 'Associated Markets': 'A,B' },
    });

    expect(normalizeKalshiMarket(market)).toBeNull();
  });

  it('drops repeated yes-title combos even when Kalshi omits combo metadata', () => {
    const market = makeMarket({
      title: 'yes Jiri Lehecka,yes Taylor Fritz,yes Ugo Humbert,yes Karen Khachanov',
      mve_selected_legs: undefined,
      custom_strike: undefined,
    });

    expect(normalizeKalshiMarket(market)).toBeNull();
  });

  it('strips the single-leg Kalshi yes prefix without dropping valid markets', () => {
    const normalized = normalizeKalshiMarket(makeMarket({
      title: 'yes Jiri Lehecka',
      subtitle: 'French Open market',
    }));

    expect(normalized).not.toBeNull();
    expect(normalized?.title).toBe('Jiri Lehecka');
  });

  it('drops degenerate zero-depth 0/1 books', () => {
    const normalized = normalizeKalshiMarket(makeMarket({
      title: 'yes Thin Book',
      yes_bid: 0,
      yes_ask: 1,
      yes_bid_dollars: '0.0000',
      yes_ask_dollars: '1.0000',
      yes_bid_size_fp: '0.00',
      yes_ask_size_fp: '0.00',
      last_price: 0,
      last_price_dollars: '0.0000',
      liquidity_dollars: '0.00',
      open_interest_fp: '0.00',
      volume_24h_fp: '0.00',
      volume_fp: '0.00',
      volume: 0,
      open_interest: 0,
    }));

    expect(normalized).toBeNull();
  });

  it('maps depth and liquidity for single-leg markets', () => {
    const normalized = normalizeKalshiMarket(makeMarket());

    expect(normalized).not.toBeNull();
    expect(normalized?.bestBid).toBe(0.41);
    expect(normalized?.bestAsk).toBe(0.43);
    expect(normalized?.bidDepth).toBe(35);
    expect(normalized?.askDepth).toBe(42);
    expect(normalized?.liquidity).toBe(250);
    expect(normalized?.spread).toBeCloseTo(0.02, 6);
  });
});
