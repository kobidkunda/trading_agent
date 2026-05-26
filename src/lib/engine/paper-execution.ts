import type { FillModel, FillModelInput } from '@/lib/types';
import { computePositionSize } from '@/lib/engine/risk';

export type PaperExecutionSide = 'YES' | 'NO';
export type PaperDataSource = 'MOCK' | 'REAL';

export function clampContractPrice(price: number | null | undefined): number {
  if (price == null || !Number.isFinite(price)) return 0;
  return Math.min(1, Math.max(0, price));
}

export function normalizeFillModel(fillModel?: FillModelInput | null): FillModel {
  switch (fillModel) {
    case 'INSTANT':
      return 'DEMO_INSTANT';
    case 'BOOK_AWARE':
      return 'BOOK_DEPTH_AWARE';
    case 'DEMO_INSTANT':
    case 'STRICT_LIMIT':
    case 'BOOK_DEPTH_AWARE':
    case 'CONSERVATIVE_PAPER':
      return fillModel;
    default:
      return 'CONSERVATIVE_PAPER';
  }
}

export function resolvePaperExecutionSize(params: {
  adjustedSize?: number | null;
  maxSize?: number | null;
  fallbackSize?: number | null;
  edge?: number | null;
  confidence?: number | null;
  uncertainty?: number | null;
}): number | null {
  let candidate =
    params.adjustedSize ?? params.maxSize ?? params.fallbackSize ?? null;

  if ((candidate == null || candidate <= 0) && params.edge != null && params.edge > 0) {
    const conf = params.confidence ?? 0.3;
    const unc = params.uncertainty ?? 0.5;
    const riskFallback = computePositionSize(params.edge, conf, unc);
    if (riskFallback > 0) return riskFallback;
    if (conf >= 0.1) return 100;
  }

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
  fillModel?: FillModelInput;
  orderExpiryMinutes?: number;
  executionNotesJson?: string | null;
}) {
  const requestedFillModel = normalizeFillModel(params.fillModel);
  const resolvedFillModel =
    params.dataSource === 'REAL' && requestedFillModel === 'DEMO_INSTANT'
      ? 'CONSERVATIVE_PAPER'
      : requestedFillModel;

  return {
    marketId: params.marketId,
    venueOrderId: params.venueOrderId,
    executionMode: 'SIMULATED' as const,
    dataSource: params.dataSource,
    lifecycleStatus: 'SUBMITTED' as const, // Changed from FILLED to SUBMITTED (plan_12-00-0099: order lifecycle)
    side: params.side,
    price: clampContractPrice(params.price),
    size: params.size,
    filledSize: 0, // Changed from params.size to 0 (no instant fill)
    remainingSize: params.size, // Full size remaining
    avgFillPrice: null as number | null, // No fill yet
    status: 'SUBMITTED',
    fillAttemptCount: 0,
    lastFillAttemptAt: null as Date | null,
    orderExpiryAt: new Date(params.now.getTime() + (params.orderExpiryMinutes ?? 1440) * 60_000),
    fillModel: resolvedFillModel,
    executionNotesJson: params.executionNotesJson ?? null,
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
    entryPrice: clampContractPrice(params.entryPrice),
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
  fillModel: FillModelInput;
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
  const fillModel = normalizeFillModel(params.fillModel);

  // HARD LIQUIDITY GATE: zero liquidity = no fill, regardless of fillModel or fillProb.
  // Prevents fake fills on markets with no real orderbook depth.
  // This check runs BEFORE all fillModel branches (DEMO_INSTANT, STRICT_LIMIT, etc.)
  // to ensure zero-liquidity markets can never be filled.
  if ((params.liquidity ?? 0) <= 0 && fillModel !== 'DEMO_INSTANT') {
    return {
      filledSize: 0,
      avgFillPrice: 0,
      remainingSize: params.size,
      isFullyFilled: false,
      lifecycleStatus: 'SUBMITTED',
    };
  }

  if (fillModel === 'DEMO_INSTANT') {
    // DEMO_INSTANT: full instant fill (only for demo mode)
    return {
      filledSize: params.size,
      avgFillPrice: clampContractPrice(params.price),
      remainingSize: 0,
      isFullyFilled: true,
      lifecycleStatus: 'FILLED',
    };
  }

  if (fillModel === 'STRICT_LIMIT') {
    const spread = params.spread ?? 0;
    const bestFillPossible = params.fillProbability != null && params.fillProbability >= 0.95;
    const crossesBook = spread <= 0.01 && (params.bidDepth ?? 0) + (params.askDepth ?? 0) >= params.size;

    if (!bestFillPossible && !crossesBook) {
      return {
        filledSize: 0,
        avgFillPrice: 0,
        remainingSize: params.size,
        isFullyFilled: false,
        lifecycleStatus: 'SUBMITTED',
      };
    }

    return {
      filledSize: params.size,
      avgFillPrice: clampContractPrice(params.price + Math.max(0, params.priceImpact ?? 0)),
      remainingSize: 0,
      isFullyFilled: true,
      lifecycleStatus: 'FILLED',
    };
  }

  const fillProb = params.fillProbability ?? null;

  if (fillModel === 'BOOK_DEPTH_AWARE') {
    const availableDepthCandidates = [params.bidDepth, params.askDepth].filter(
      (depth): depth is number => depth != null && Number.isFinite(depth) && depth > 0,
    );
    const availableDepth =
      availableDepthCandidates.length > 1
        ? Math.min(...availableDepthCandidates)
        : availableDepthCandidates[0] ?? 0;

    if (availableDepth <= 0 || (fillProb != null && fillProb < 0.2)) {
      return {
        filledSize: 0,
        avgFillPrice: 0,
        remainingSize: params.size,
        isFullyFilled: false,
        lifecycleStatus: 'SUBMITTED',
      };
    }

    const fillCap = fillProb == null ? 1 : Math.max(0.1, Math.min(1, fillProb));
    const filledSize = Math.min(params.size, Math.round(Math.min(availableDepth, params.size * fillCap) * 100) / 100);
    const avgFillPrice = clampContractPrice(Math.max(params.price, params.price + Math.max(params.priceImpact ?? 0, (params.spread ?? 0) * 0.15)));
    const isFullyFilled = filledSize >= params.size * 0.999;

    return {
      filledSize,
      avgFillPrice,
      remainingSize: Math.max(0, params.size - filledSize),
      isFullyFilled,
      lifecycleStatus: filledSize <= 0 ? 'SUBMITTED' : isFullyFilled ? 'FILLED' : 'PARTIALLY_FILLED',
    };
  }

  if (fillProb === null) {
    const hasBookSignal =
      (params.bidDepth != null && params.bidDepth > 0) ||
      (params.askDepth != null && params.askDepth > 0) ||
      (params.spread != null && params.spread > 0);

    if (fillModel !== 'CONSERVATIVE_PAPER' || !hasBookSignal) {
      return {
        filledSize: 0,
        avgFillPrice: 0,
        remainingSize: params.size,
        isFullyFilled: false,
        lifecycleStatus: 'SUBMITTED',
      };
    }

    const fillRatio = Math.min(0.25, params.liquidity / Math.max(1, params.size * params.price * 400));
    const filledSize = Math.round(params.size * fillRatio * 100) / 100;
    const slippage = params.price * Math.max(0.015, (1 - fillRatio) * 0.03);
    const avgFillPrice = filledSize > 0 ? clampContractPrice(params.price + slippage) : 0;
    const isFullyFilled = filledSize >= params.size * 0.999;

    return {
      filledSize: Math.max(0, filledSize),
      avgFillPrice,
      remainingSize: Math.max(0, params.size - filledSize),
      isFullyFilled,
      lifecycleStatus: filledSize <= 0 ? 'SUBMITTED' : isFullyFilled ? 'FILLED' : 'PARTIALLY_FILLED',
    };
  }

  const isConservative = fillModel === 'CONSERVATIVE_PAPER';

  if (!isConservative && fillProb < 0.10) {
    // Very low fill probability — NO_FILL but retryable (not terminal FAIL).
    // Subsequent fill attempts may succeed as orderbook conditions improve.
    return {
      filledSize: 0,
      avgFillPrice: 0,
      remainingSize: params.size,
      isFullyFilled: false,
      lifecycleStatus: 'SUBMITTED',
    };
  }

  if (fillProb < 0.75) {
    // Partial fill proportional to fillProbability (not scaled down).
    // Fill at fillProb * size, which represents actual fill likelihood.
    const filledSize = Math.round(params.size * fillProb * 100) / 100;
    const impactCost = Math.max(params.priceImpact ?? 0, (params.spread ?? 0) * 0.25);
    const avgFillPrice = clampContractPrice(params.price + impactCost);

    return {
      filledSize: Math.max(0, filledSize),
      avgFillPrice,
      remainingSize: Math.max(0, params.size - filledSize),
      isFullyFilled: false,
      lifecycleStatus: 'PARTIALLY_FILLED',
    };
  }

  const impactCost =
    fillModel === 'CONSERVATIVE_PAPER'
      ? Math.max(params.priceImpact ?? 0, (params.spread ?? 0) * 0.5)
      : params.priceImpact ?? 0;
  const avgFillPrice = clampContractPrice(params.price + impactCost);

  return {
    filledSize: params.size,
    avgFillPrice,
    remainingSize: 0,
    isFullyFilled: true,
    lifecycleStatus: 'FILLED',
  };
}
