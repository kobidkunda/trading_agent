// Phase 9 — Orderbook Microstructure Engine

export interface DepthImbalanceResult {
  imbalance: number;
  direction: 'BID_HEAVY' | 'ASK_HEAVY' | 'BALANCED';
  strength: 'NONE' | 'MILD' | 'MODERATE' | 'STRONG' | 'EXTREME';
}

export interface PriceLevel {
  price: number;
  size: number;
  side?: 'BID' | 'ASK';
}

export interface WhaleWallResult {
  bidWalls: PriceLevel[];
  askWalls: PriceLevel[];
  pressureDirection: 'BID_PRESSURE' | 'ASK_PRESSURE' | 'NEUTRAL' | 'OPPOSING_WALLS';
  strongestWall: PriceLevel | null;
}

export interface OrderbookAnalysisInput {
  bestBid?: number | null;
  bestAsk?: number | null;
  spread?: number | null;
  bidDepth?: number | null;
  askDepth?: number | null;
  orderSize?: number | null;
  levels?: PriceLevel[] | null;
  recentMovement?: number | null;
  depthDecay?: number | null;
}

export interface OrderbookAnalysisOutput {
  depthImbalance: DepthImbalanceResult | null;
  priceImpact: number | null;
  fillProbability: number | null;
  whaleWalls: WhaleWallResult | null;
  isThinBook: boolean;
  orderbookQualityScore: number;
  thinBookDanger: boolean;
}

const WHALE_WALL_SIZE_MULTIPLIER = 3;
const THIN_BOOK_MULTIPLIER = 2;
const PRICE_IMPACT_SPREAD_MULTIPLIER = 1.5;
const FILL_PROBABILITY_BASE = 0.85;

export class OrderbookMicrostructureEngine {
  /** imbalance = (bidDepth − askDepth) / (bidDepth + askDepth). Range: −1 to +1 */
  computeDepthImbalance(
    bidDepth: number,
    askDepth: number,
  ): DepthImbalanceResult {
    if (bidDepth <= 0 && askDepth <= 0) {
      return {
        imbalance: 0,
        direction: 'BALANCED',
        strength: 'NONE',
      };
    }

    const total = bidDepth + askDepth;
    const imbalance = (bidDepth - askDepth) / total;

    const absImbalance = Math.abs(imbalance);
    let strength: DepthImbalanceResult['strength'];
    if (absImbalance < 0.1) strength = 'NONE';
    else if (absImbalance < 0.25) strength = 'MILD';
    else if (absImbalance < 0.5) strength = 'MODERATE';
    else if (absImbalance < 0.75) strength = 'STRONG';
    else strength = 'EXTREME';

    let direction: DepthImbalanceResult['direction'];
    if (absImbalance < 0.05) direction = 'BALANCED';
    else if (imbalance > 0) direction = 'BID_HEAVY';
    else direction = 'ASK_HEAVY';

    return { imbalance, direction, strength };
  }

  /** priceImpact = (orderSize / totalDepth) × spread × multiplier, capped at spread */
  estimatePriceImpact(
    orderSize: number,
    bidDepth: number,
    askDepth: number,
    spread: number,
  ): number {
    const totalDepth = bidDepth + askDepth;
    if (totalDepth <= 0 || orderSize <= 0) return 0;

    const baseRatio = orderSize / totalDepth;
    const impact = baseRatio * spread * PRICE_IMPACT_SPREAD_MULTIPLIER;

    return Math.min(impact, spread);
  }

  /**
   * fillProbability = base × (depthFactor×0.6 + spreadFactor×0.4).
   * depthFactor = min(1, depthRatio/10). spreadFactor = max(0, 1 − spread/0.05).
   */
  computeFillProbability(
    orderSize: number,
    bidDepth: number,
    askDepth: number,
    spread: number,
  ): number {
    if (orderSize <= 0) return 1;

    const totalDepth = bidDepth + askDepth;
    if (totalDepth <= 0) return 0;

    const depthRatio = totalDepth / orderSize;
    const depthFactor = Math.min(1, depthRatio / 10);
    const normalizedSpread = Math.min(spread, 0.20);
    const spreadFactor = Math.max(0, 1 - normalizedSpread / 0.05);

    const rawProbability = FILL_PROBABILITY_BASE * (depthFactor * 0.6 + spreadFactor * 0.4);
    return Math.max(0, Math.min(1, rawProbability));
  }

  /** Whale wall: level with size ≥ 3× average across all levels. */
  detectWhaleWalls(levels: PriceLevel[]): WhaleWallResult {
    if (!levels || levels.length === 0) {
      return {
        bidWalls: [],
        askWalls: [],
        pressureDirection: 'NEUTRAL',
        strongestWall: null,
      };
    }

    const totalSize = levels.reduce((sum, l) => sum + l.size, 0);
    const avgSize = totalSize / levels.length;
    const wallThreshold = avgSize * WHALE_WALL_SIZE_MULTIPLIER;
    const sortedBySize = [...levels].sort((a, b) => b.size - a.size);

    const bidWalls: PriceLevel[] = [];
    const askWalls: PriceLevel[] = [];

    for (const level of levels) {
      if (level.size < wallThreshold) continue;
      if (level.side === 'BID') bidWalls.push(level);
      else if (level.side === 'ASK') askWalls.push(level);
    }

    const hasBidWalls = bidWalls.length > 0;
    const hasAskWalls = askWalls.length > 0;

    let pressureDirection: WhaleWallResult['pressureDirection'];
    if (hasBidWalls && hasAskWalls) {
      pressureDirection = 'OPPOSING_WALLS';
    } else if (hasBidWalls) {
      pressureDirection = 'BID_PRESSURE';
    } else if (hasAskWalls) {
      pressureDirection = 'ASK_PRESSURE';
    } else {
      pressureDirection = 'NEUTRAL';
    }

    const candidateStrongest = sortedBySize[0];
    const strongestWall =
      candidateStrongest && candidateStrongest.size >= wallThreshold
        ? candidateStrongest
        : null;

    return {
      bidWalls: bidWalls.sort((a, b) => b.size - a.size),
      askWalls: askWalls.sort((a, b) => b.size - a.size),
      pressureDirection,
      strongestWall,
    };
  }

  isThinBook(orderSize: number, bidDepth: number, askDepth: number): boolean {
    if (orderSize <= 0) return false;
    return (bidDepth + askDepth) < orderSize * THIN_BOOK_MULTIPLIER;
  }

  /**
   * Quality score 0–20: depth adequacy (0–6), spread tightness (0–5),
   * bid/ask balance (0–4), wall-free bonus (0–3), decay penalty (0–2).
   */
  computeOrderbookQualityScore(snapshot: OrderbookAnalysisInput): number {
    let score = 0;

    const bidDepth = snapshot.bidDepth ?? 0;
    const askDepth = snapshot.askDepth ?? 0;
    const orderSize = snapshot.orderSize ?? 1000;
    const totalDepth = bidDepth + askDepth;

    if (totalDepth > 0) {
      const depthRatio = totalDepth / orderSize;
      if (depthRatio >= 10) score += 6;
      else if (depthRatio >= 5) score += 4;
      else if (depthRatio >= 2) score += 2;
    }

    const spread = snapshot.spread ?? 0.05;
    if (spread <= 0.01) score += 5;
    else if (spread <= 0.02) score += 4;
    else if (spread <= 0.03) score += 3;
    else if (spread <= 0.05) score += 2;
    else if (spread <= 0.08) score += 1;
    else score += 0;

    if (bidDepth > 0 && askDepth > 0) {
      const ratio = Math.min(bidDepth, askDepth) / Math.max(bidDepth, askDepth);
      if (ratio >= 0.8) score += 4;
      else if (ratio >= 0.6) score += 3;
      else if (ratio >= 0.4) score += 2;
      else if (ratio >= 0.2) score += 1;
    }

    const bidWall = snapshot.levels?.find(
      (l) => l.side === 'BID' && l.size > (totalDepth || 0) * 0.3,
    );
    const askWall = snapshot.levels?.find(
      (l) => l.side === 'ASK' && l.size > (totalDepth || 0) * 0.3,
    );
    if (!bidWall && !askWall) score += 3;
    else if (!bidWall || !askWall) score += 1;

    const depthDecay = snapshot.depthDecay ?? 0;
    if (depthDecay <= 0.1) score += 2;
    else if (depthDecay <= 0.3) score += 1;
    else score += 0;

    return Math.max(0, Math.min(20, score));
  }

  analyze(input: OrderbookAnalysisInput): OrderbookAnalysisOutput {
    const bidDepth = input.bidDepth ?? 0;
    const askDepth = input.askDepth ?? 0;
    const spread = input.spread ?? 0.05;
    const orderSize = input.orderSize ?? 1000;
    const levels = input.levels ?? [];

    const depthImbalance =
      bidDepth > 0 || askDepth > 0
        ? this.computeDepthImbalance(bidDepth, askDepth)
        : null;

    const priceImpact = this.estimatePriceImpact(orderSize, bidDepth, askDepth, spread);

    const fillProbability = this.computeFillProbability(
      orderSize,
      bidDepth,
      askDepth,
      spread,
    );

    const whaleWalls =
      levels.length > 0 ? this.detectWhaleWalls(levels) : null;

    const thinBookDanger = this.isThinBook(orderSize, bidDepth, askDepth);

    const orderbookQualityScore = this.computeOrderbookQualityScore(input);

    const isThinBook = thinBookDanger;

    return {
      depthImbalance,
      priceImpact,
      fillProbability,
      whaleWalls,
      isThinBook,
      orderbookQualityScore,
      thinBookDanger,
    };
  }
}

export const orderbookEngine = new OrderbookMicrostructureEngine();
export type { PriceLevel as OrderbookPriceLevel };
