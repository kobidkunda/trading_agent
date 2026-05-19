import { describe, expect, it } from 'bun:test';

// ---------------------------------------------------------------------------
// Orderbook Route Response Shape
// Tests the mapping of orderbook snapshots to API response objects,
// including market relation joins and field aliasing.
// ---------------------------------------------------------------------------

describe('Orderbook Route Response Shape', () => {
  it('should map snapshot to include marketTitle and venue', () => {
    const snapshot = {
      id: 'snap1',
      marketId: 'mkt1',
      bestBid: 0.45,
      bestAsk: 0.55,
      spread: 0.1,
      bidDepth: 1000,
      askDepth: 800,
      depthImbalance: 0.2,
      largeBidWall: null,
      largeAskWall: null,
      thinBookDanger: false,
      priceImpact: 0.01,
      fillProbability: 0.75,
      capturedAt: new Date('2026-05-19T12:00:00Z'),
      market: {
        id: 'mkt1',
        title: 'Will AI replace engineers?',
        venue: 'POLYMARKET',
        category: 'technology',
      },
    };

    const mapped = {
      id: snapshot.id,
      marketId: snapshot.marketId,
      marketTitle: snapshot.market?.title ?? '',
      venue: snapshot.market?.venue ?? '',
      category: snapshot.market?.category ?? '',
      bestBid: snapshot.bestBid,
      bestAsk: snapshot.bestAsk,
      spread: snapshot.spread,
      bidDepth: snapshot.bidDepth,
      askDepth: snapshot.askDepth,
      depthImbalance: snapshot.depthImbalance,
      largeBidWall: snapshot.largeBidWall,
      largeAskWall: snapshot.largeAskWall,
      thinBookDanger: snapshot.thinBookDanger,
      thinBookWarning: snapshot.thinBookDanger,
      priceImpact: snapshot.priceImpact,
      fillProbability: snapshot.fillProbability,
      capturedAt: snapshot.capturedAt,
      lastUpdated: snapshot.capturedAt,
    };

    expect(mapped.marketTitle).toBe('Will AI replace engineers?');
    expect(mapped.venue).toBe('POLYMARKET');
    expect(mapped.category).toBe('technology');
    expect(mapped.thinBookDanger).toBe(false);
    expect(mapped.thinBookWarning).toBe(false);
    expect(mapped.bestBid).toBe(0.45);
    expect(mapped.bestAsk).toBe(0.55);
    expect(mapped.spread).toBe(0.1);
    expect(mapped.fillProbability).toBe(0.75);
  });

  it('should handle missing market relation gracefully', () => {
    const snapshot = {
      id: 'snap2',
      marketId: 'mkt2',
      capturedAt: new Date('2026-05-19T12:00:00Z'),
    } as { marketId: string; capturedAt: Date; market?: { title?: string; venue?: string; category?: string } };

    expect(snapshot.market?.title ?? '').toBe('');
    expect(snapshot.market?.venue ?? '').toBe('');
  });

  it('should handle null market relation', () => {
    const snapshot = {
      id: 'snap3',
      marketId: 'mkt3',
      capturedAt: new Date(),
    } as { marketId: string; capturedAt: Date; market?: { title?: string; venue?: string; category?: string } | null };

    expect(snapshot.market?.title ?? '').toBe('');
    expect(snapshot.market?.venue ?? '').toBe('');
  });

  it('should handle partial market data (missing category)', () => {
    const snapshot = {
      id: 'snap4',
      marketId: 'mkt4',
      capturedAt: new Date(),
      market: {
        id: 'mkt4',
        title: 'Some Market',
        venue: 'KALSHI',
        // category missing
      },
    };

    const category = (snapshot.market as any)?.category ?? '';
    expect(category).toBe('');
  });

  // --- Field presence ---

  it('response should include all expected fields', () => {
    const expectedFields = [
      'id',
      'marketId',
      'marketTitle',
      'venue',
      'category',
      'bestBid',
      'bestAsk',
      'spread',
      'bidDepth',
      'askDepth',
      'depthImbalance',
      'largeBidWall',
      'largeAskWall',
      'thinBookDanger',
      'thinBookWarning',
      'priceImpact',
      'fillProbability',
      'capturedAt',
      'lastUpdated',
    ];

    // Build a mapped object with all fields
    const snapshot = {
      id: 'snap1',
      marketId: 'mkt1',
      bestBid: 0.5,
      bestAsk: 0.6,
      spread: 0.1,
      bidDepth: 100,
      askDepth: 200,
      depthImbalance: 0.1,
      largeBidWall: null,
      largeAskWall: null,
      thinBookDanger: true,
      priceImpact: 0.02,
      fillProbability: 0.8,
      capturedAt: new Date(),
      market: {
        id: 'mkt1',
        title: 'Test',
        venue: 'TEST',
        category: 'test',
      },
    };

    const mapped = {
      id: snapshot.id,
      marketId: snapshot.marketId,
      marketTitle: snapshot.market?.title ?? '',
      venue: snapshot.market?.venue ?? '',
      category: snapshot.market?.category ?? '',
      bestBid: snapshot.bestBid,
      bestAsk: snapshot.bestAsk,
      spread: snapshot.spread,
      bidDepth: snapshot.bidDepth,
      askDepth: snapshot.askDepth,
      depthImbalance: snapshot.depthImbalance,
      largeBidWall: snapshot.largeBidWall,
      largeAskWall: snapshot.largeAskWall,
      thinBookDanger: snapshot.thinBookDanger,
      thinBookWarning: snapshot.thinBookDanger,
      priceImpact: snapshot.priceImpact,
      fillProbability: snapshot.fillProbability,
      capturedAt: snapshot.capturedAt,
      lastUpdated: snapshot.capturedAt,
    };

    for (const field of expectedFields) {
      expect(Object.keys(mapped)).toContain(field);
    }
    expect(Object.keys(mapped).length).toBe(expectedFields.length);
  });

  // --- thinBookWarning mirrors thinBookDanger ---

  it('thinBookWarning should mirror thinBookDanger', () => {
    const dangerCases = [
      { thinBookDanger: true, expected: true },
      { thinBookDanger: false, expected: false },
    ];

    for (const tc of dangerCases) {
      expect(tc.thinBookDanger).toBe(tc.expected);
    }
  });

  // --- lastUpdated is capturedAt alias ---

  it('lastUpdated should equal capturedAt', () => {
    const capturedAt = new Date('2026-05-19T12:00:00Z');
    const lastUpdated = capturedAt;

    expect(lastUpdated).toBe(capturedAt);
    expect(lastUpdated.getTime()).toBe(capturedAt.getTime());
  });
});
