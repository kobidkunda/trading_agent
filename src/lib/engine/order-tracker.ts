import { db } from '@/lib/db';
import { updateOrderCompat } from '@/lib/engine/prisma-runtime-compat';
import { normalizeFillModel } from '@/lib/engine/paper-execution';
import { computeRisk } from '@/lib/engine/risk';
import type { FillModelInput, PaperBetExecutionStatus, Venue } from '@/lib/types';

export type OrderTrackerLifecycle = 'PLANNED' | 'SUBMITTED' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'FAILED' | 'EXPIRED';

export const MAX_FILL_ATTEMPTS = 3;

export function classifyOrderTerminalState(order: {
  lifecycleStatus: OrderTrackerLifecycle;
  remainingSize: number;
}): 'FILLED' | 'CANCELLED' | 'EXPIRED' | null {
  if (order.lifecycleStatus === 'FILLED' && order.remainingSize === 0) return 'FILLED';
  if (order.lifecycleStatus === 'CANCELLED') return 'CANCELLED';
  if (order.lifecycleStatus === 'EXPIRED') return 'EXPIRED';
  return null;
}

export function derivePositionStatusAfterFill(lifecycleStatus: OrderTrackerLifecycle): 'OPEN' | null {
  if (lifecycleStatus === 'FILLED' || lifecycleStatus === 'PARTIALLY_FILLED') {
    return 'OPEN';
  }

  return null;
}

export function derivePaperBetExecutionStatus(params: {
  lifecycleStatus: OrderTrackerLifecycle;
  filledSize: number;
}): PaperBetExecutionStatus {
  if (params.filledSize > 0) {
    return params.lifecycleStatus === 'FILLED' ? 'FILLED' : 'PARTIAL';
  }

  if (params.lifecycleStatus === 'FAILED') return 'FAILED';
  if (params.lifecycleStatus === 'EXPIRED') return 'EXPIRED';
  if (params.lifecycleStatus === 'CANCELLED') return 'CANCELLED';
  if (params.lifecycleStatus === 'PLANNED') return 'PLANNED';

  return 'SUBMITTED';
}

export async function processPaperOrderFill(params: {
  orderId: string;
  marketId: string;
  fillModel: FillModelInput;
  liquidity: number;
  fillProbability?: number | null;
  priceImpact?: number | null;
  bidDepth?: number | null;
  askDepth?: number | null;
  spread?: number | null;
  orderbookAgeSeconds?: number | null;
  maxFillAttempts?: number;
}): Promise<{
  filledSize: number;
  avgFillPrice: number;
  isFullyFilled: boolean;
  orderStatus: string;
}> {
  const order = await db.order.findUnique({ where: { id: params.orderId } });
  if (!order) {
    throw new Error(`Order not found: ${params.orderId}`);
  }

  if (order.orderExpiryAt && order.orderExpiryAt < new Date()) {
    await updateOrderCompat(params.orderId, {
      lifecycleStatus: 'EXPIRED',
      status: 'EXPIRED',
      expiredAt: new Date(),
      lastFillAttemptAt: new Date(),
      fillAttemptCount: { increment: 1 },
    });
    await db.paperBet.updateMany({
      where: { orderId: params.orderId },
      data: { executionStatus: 'EXPIRED' },
    });
    await db.tradeCandidate.updateMany({
      where: { marketId: params.marketId },
      data: { stage: 'EXECUTION_FAILED' },
    });
    return {
      filledSize: 0,
      avgFillPrice: 0,
      isFullyFilled: false,
      orderStatus: 'EXPIRED',
    };
  }

// Risk re-evaluation gate: check if market still meets BID criteria.
// Skip for CONSERVATIVE_PAPER fill — paper orders should always attempt fills
// regardless of current snapshot state, since fills are simulated.
  const [latestMarketSnapshot, latestDecision] = await Promise.all([
    db.marketSnapshot.findFirst({
      where: { marketId: params.marketId },
      orderBy: { timestamp: 'desc' },
    }),
    db.decision.findFirst({
      where: { marketId: params.marketId },
      include: { market: { select: { venue: true, category: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const skipRiskGate =
    normalizeFillModel(params.fillModel) === 'CONSERVATIVE_PAPER';

  if (
    !skipRiskGate &&
    latestMarketSnapshot &&
    latestDecision &&
    latestDecision.judgeProbability != null &&
    latestDecision.confidence != null &&
    latestDecision.uncertainty != null
  ) {
    const riskInput = {
      impliedProbability: latestMarketSnapshot.impliedProb,
      judgeProbability: latestDecision.judgeProbability,
      confidence: latestDecision.confidence,
      uncertainty: latestDecision.uncertainty,
      fees: 0,
      slippage: 0,
      venue: latestDecision.market.venue as Venue,
      category: latestDecision.market.category,
      dailyExposure: 0,
      categoryExposure: 0,
      openPositions: 0,
      marketLiquidity: latestMarketSnapshot.liquidity,
      marketSpread: latestMarketSnapshot.spread,
      catalystTiming: undefined,
    };

    const riskResult = computeRisk(riskInput);
    if (riskResult.action !== 'BID') {
      await updateOrderCompat(params.orderId, {
        lifecycleStatus: 'CANCELLED',
        status: 'CANCELLED',
        lastFillAttemptAt: new Date(),
        fillAttemptCount: { increment: 1 },
        failureReason: `Risk re-evaluation failed: ${riskResult.reason}`,
      });
      await db.paperBet.updateMany({
        where: { orderId: params.orderId },
        data: { executionStatus: 'CANCELLED' },
      });
      return {
        filledSize: 0,
        avgFillPrice: 0,
        isFullyFilled: false,
        orderStatus: 'CANCELLED',
      };
    }
  }

  const { resolvePaperFill } = await import('./paper-execution');
  const fillModel = normalizeFillModel(params.fillModel);
  const maxAttempts = params.maxFillAttempts ?? MAX_FILL_ATTEMPTS;

  const fillResult = resolvePaperFill({
    size: Math.max(0, order.remainingSize || order.size),
    price: order.price,
    fillModel,
    liquidity: params.liquidity,
    fillProbability: params.fillProbability,
    priceImpact: params.priceImpact,
    bidDepth: params.bidDepth,
    askDepth: params.askDepth,
    spread: params.spread,
  });

  const fillTimestamp = new Date();
  const currentAttempt = (order.fillAttemptCount ?? 0) + 1;

  const prevFilledSize = order.filledSize ?? 0;
  const incrementalFill = Math.max(0, fillResult.filledSize);

  const nextFilledSize = Math.min(order.size, prevFilledSize + incrementalFill);
  const nextRemainingSize = Math.max(0, order.size - nextFilledSize);
  const nextAvgFillPrice =
    nextFilledSize > 0
      ? (
          ((order.avgFillPrice ?? 0) * prevFilledSize) +
          (fillResult.avgFillPrice * incrementalFill)
        ) / Math.max(nextFilledSize, 1)
      : order.avgFillPrice;

  const isFullFill = nextFilledSize >= order.size * 0.999;
  let newLifecycleStatus: OrderTrackerLifecycle;

  if (isFullFill) {
    newLifecycleStatus = 'FILLED';
  } else if (incrementalFill > 0) {
    newLifecycleStatus = 'PARTIALLY_FILLED';
  } else if (fillResult.lifecycleStatus === 'SUBMITTED') {
    // A paper limit order that does not fill should keep resting until expiry.
    newLifecycleStatus = 'SUBMITTED';
  } else if (fillResult.lifecycleStatus === 'FAILED') {
    newLifecycleStatus = 'FAILED';
  } else {
    newLifecycleStatus = 'SUBMITTED';
  }

  const paperBetExecutionStatus = derivePaperBetExecutionStatus({
    lifecycleStatus: newLifecycleStatus,
    filledSize: nextFilledSize,
  });

  await updateOrderCompat(params.orderId, {
    lifecycleStatus: newLifecycleStatus,
    filledSize: nextFilledSize,
    remainingSize: nextRemainingSize,
    avgFillPrice: nextAvgFillPrice,
    filledAt: newLifecycleStatus === 'FILLED' ? fillTimestamp : null,
    lastFillAttemptAt: fillTimestamp,
    fillAttemptCount: { increment: 1 },
    failureReason: newLifecycleStatus === 'FAILED' ? 'Paper order failed during fill simulation' : null,
    status:
      newLifecycleStatus === 'FAILED'
        ? 'FAILED'
        : newLifecycleStatus === 'FILLED'
          ? 'FILLED'
          : newLifecycleStatus === 'PARTIALLY_FILLED'
            ? 'PARTIALLY_FILLED'
          : 'SUBMITTED',
  });

  if (incrementalFill > 0) {
    await db.fill.create({
      data: {
        orderId: params.orderId,
        price: fillResult.avgFillPrice,
        size: incrementalFill,
        fee: 0,
        fillModel,
        metadataJson: JSON.stringify({
          liquidity: params.liquidity,
          fillProbability: params.fillProbability ?? null,
          priceImpact: params.priceImpact ?? null,
          bidDepth: params.bidDepth ?? null,
          askDepth: params.askDepth ?? null,
          spread: params.spread ?? null,
          orderbookAgeSeconds: params.orderbookAgeSeconds ?? null,
          fillAttempt: currentAttempt,
        }),
        fillTime: fillTimestamp,
      },
    });

    await db.paperBet.updateMany({
      where: { orderId: params.orderId },
      data: {
        executionStatus: paperBetExecutionStatus,
        executedAt: fillTimestamp,
        stake: nextFilledSize,
        entryPrice: nextAvgFillPrice ?? order.price,
      },
    });

    const existingPosition = await db.position.findFirst({
      where: { marketId: params.marketId, status: { in: ['OPEN', 'WATCH'] } },
    });

    if (!existingPosition) {
      await db.position.create({
        data: {
          marketId: params.marketId,
          side: order.side,
          entryPrice: fillResult.avgFillPrice,
          currentSize: incrementalFill,
          avgEntryPrice: fillResult.avgFillPrice,
          unrealizedPnl: 0,
          realizedPnl: 0,
          status: 'OPEN',
          openedAt: new Date(),
        },
      });
    } else {
      const newSize = existingPosition.currentSize + incrementalFill;
      const newAvgPrice = ((existingPosition.avgEntryPrice * existingPosition.currentSize) + (fillResult.avgFillPrice * incrementalFill)) / newSize;
      await db.position.update({
        where: { id: existingPosition.id },
        data: {
          currentSize: newSize,
          avgEntryPrice: newAvgPrice,
          status: 'OPEN',
        },
      });
    }
  } else {
    await db.paperBet.updateMany({
      where: { orderId: params.orderId },
      data: {
        executionStatus: paperBetExecutionStatus,
        executedAt: newLifecycleStatus === 'FAILED' ? fillTimestamp : undefined,
      },
    });
  }

  // ── Update candidate stage on terminal order lifecycle ─────────────────
  if (newLifecycleStatus === 'FILLED') {
    await db.tradeCandidate.updateMany({
      where: { marketId: params.marketId },
      data: { stage: 'EXECUTED', lastExecutionAt: fillTimestamp },
    });
  } else if (newLifecycleStatus === 'FAILED') {
    await db.tradeCandidate.updateMany({
      where: { marketId: params.marketId },
      data: { stage: 'EXECUTION_FAILED' },
    });
  }

  return {
    filledSize: incrementalFill,
    avgFillPrice: fillResult.avgFillPrice,
    isFullyFilled: newLifecycleStatus === 'FILLED',
    orderStatus: newLifecycleStatus,
  };
}
