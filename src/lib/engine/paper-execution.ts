export type PaperExecutionSide = 'YES' | 'NO';
export type PaperDataSource = 'MOCK' | 'REAL';

export function resolvePaperExecutionSize(params: {
  adjustedSize?: number | null;
  maxSize?: number | null;
  fallbackSize?: number | null;
}): number | null {
  const candidate =
    params.adjustedSize ?? params.maxSize ?? params.fallbackSize ?? null;

  if (candidate == null || candidate <= 0) {
    return null;
  }

  return candidate;
}

export function buildPaperOrderRecord(params: {
  marketId: string;
  venueOrderId: string;
  side: PaperExecutionSide;
  price: number;
  size: number;
  now: Date;
  dataSource: PaperDataSource;
}) {
  return {
    marketId: params.marketId,
    venueOrderId: params.venueOrderId,
    executionMode: 'SIMULATED' as const,
    dataSource: params.dataSource,
    lifecycleStatus: 'SUBMITTED' as const, // Changed from FILLED to SUBMITTED (plan_12-00-0099: order lifecycle)
    side: params.side,
    price: params.price,
    size: params.size,
    filledSize: 0, // Changed from params.size to 0 (no instant fill)
    remainingSize: params.size, // Full size remaining
    avgFillPrice: null as number | null, // No fill yet
    status: 'PLANNED', // Changed to lifecycle-aware status
    submittedAt: params.now,
    filledAt: null as Date | null,
  };
}

export function buildPaperPositionRecord(params: {
  marketId: string;
  side: PaperExecutionSide;
  entryPrice: number;
  currentSize: number;
  judgeProbability: number;
}) {
  // No position until order is filled (order tracker will create upon fill)
  return {
    marketId: params.marketId,
    side: params.side,
    entryPrice: params.entryPrice,
    currentSize: 0, // Position not yet opened
    avgEntryPrice: 0, // Not filled yet
    unrealizedPnl: 0,
    realizedPnl: 0,
    status: 'WATCH' as const, // Not OPEN until filled
  };
}

export function resolvePaperFill(params: {
  size: number;
  price: number;
  fillModel: 'INSTANT' | 'BOOK_AWARE';
  liquidity: number;
  fillProbability?: number | null;
  priceImpact?: number | null;
  bidDepth?: number | null;
  askDepth?: number | null;
  spread?: number | null;
}): {
  filledSize: number;
  avgFillPrice: number;
  remainingSize: number;
  isFullyFilled: boolean;
  lifecycleStatus: 'SUBMITTED' | 'PARTIALLY_FILLED' | 'FILLED' | 'FAILED';
} {
  if (params.fillModel === 'INSTANT') {
    // DEMO_INSTANT: full instant fill (only for demo mode)
    return {
      filledSize: params.size,
      avgFillPrice: params.price,
      remainingSize: 0,
      isFullyFilled: true,
      lifecycleStatus: 'FILLED',
    };
  }

  const fillProb = params.fillProbability ?? null;

  if (fillProb === null) {
    // Fallback: use old liquidity-based model when fillProbability unavailable
    const fillRatio = Math.min(1, params.liquidity / (params.size * params.price * 100));
    const filledSize = Math.round(params.size * fillRatio * 100) / 100;
    const slippage = params.price * (1 - fillRatio) * 0.01;
    const avgFillPrice = params.price + slippage;
    const isFullyFilled = filledSize >= params.size * 0.999;

    return {
      filledSize: Math.max(0, filledSize),
      avgFillPrice: Math.max(0, avgFillPrice),
      remainingSize: Math.max(0, params.size - filledSize),
      isFullyFilled,
      lifecycleStatus: isFullyFilled ? 'FILLED' : 'PARTIALLY_FILLED',
    };
  }

  if (fillProb < 0.20) {
    return {
      filledSize: 0,
      avgFillPrice: 0,
      remainingSize: params.size,
      isFullyFilled: false,
      lifecycleStatus: 'FAILED',
    };
  }

  if (fillProb < 0.50) {
    const partialRatio = fillProb * 1.2;
    const filledSize = Math.round(params.size * partialRatio * 100) / 100;
    const impactCost = (params.priceImpact ?? 0) * 0.5;
    const avgFillPrice = params.price + impactCost;

    return {
      filledSize: Math.max(0, filledSize),
      avgFillPrice: Math.max(0, avgFillPrice),
      remainingSize: Math.max(0, params.size - filledSize),
      isFullyFilled: false,
      lifecycleStatus: 'PARTIALLY_FILLED',
    };
  }

  const impactCost = params.priceImpact ?? 0;
  const avgFillPrice = params.price + impactCost;

  return {
    filledSize: params.size,
    avgFillPrice: Math.max(0, avgFillPrice),
    remainingSize: 0,
    isFullyFilled: true,
    lifecycleStatus: 'FILLED',
  };
}
