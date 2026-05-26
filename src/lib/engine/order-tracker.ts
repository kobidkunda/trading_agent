import { db } from '@/lib/db';
import { updateOrderCompat } from '@/lib/engine/prisma-runtime-compat';
import { clampContractPrice, normalizeFillModel } from '@/lib/engine/paper-execution';
import { computeRisk } from '@/lib/engine/risk';
import {
  getEffectiveTradingConfig,
  STRATEGY_SETTINGS_KEY,
  TRADING_CONFIG_KEY,
  TRADING_MODE_KEY,
} from '@/lib/engine/trading-settings';
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

// Risk re-evaluation gate: PAPER fills must remain executable under current market conditions.
// Fail closed when the latest snapshot / decision context is missing.
  const [latestMarketSnapshot, paperBet, strategySetting, tradingConfigSetting, tradingModeSetting] = await Promise.all([
    db.marketSnapshot.findFirst({
      where: { marketId: params.marketId },
      orderBy: { timestamp: 'desc' },
    }),
    db.paperBet.findFirst({
      where: { orderId: params.orderId },
      include: {
        decision: {
          include: { market: { select: { venue: true, category: true, resolutionTime: true } } },
        },
      },
    }),
    db.settings.findUnique({ where: { key: STRATEGY_SETTINGS_KEY } }),
    db.settings.findUnique({ where: { key: TRADING_CONFIG_KEY } }),
    db.settings.findUnique({ where: { key: TRADING_MODE_KEY } }),
  ]);
  const tradingConfig = getEffectiveTradingConfig({
    strategySettings: strategySetting?.value ? JSON.parse(strategySetting.value) : null,
    tradingConfig: tradingConfigSetting?.value ? JSON.parse(tradingConfigSetting.value) : null,
    tradingMode: tradingModeSetting?.value ?? null,
  });
  const riskConfig = tradingConfig as unknown as Record<string, unknown>;

  const latestDecision = paperBet?.decision ?? await db.decision.findFirst({
    where: { marketId: params.marketId },
    include: { market: { select: { venue: true, category: true, resolutionTime: true } } },
    orderBy: { createdAt: 'desc' },
  });

  if (
    latestMarketSnapshot &&
    latestDecision &&
    latestDecision.judgeProbability != null &&
    latestDecision.confidence != null &&
    latestDecision.uncertainty != null
  ) {
    // Extra guard: zero-liquidity markets cannot be filled in paper mode.
    // Prevents the fill tracker from executing fills on markets without real depth.
    const mktLiquidity = latestMarketSnapshot.liquidity ?? 0;
    const mktUncertainty = latestDecision.uncertainty ?? 1;
    if (mktLiquidity <= 0 || mktUncertainty > 0.45) {
      await updateOrderCompat(params.orderId, {
        lifecycleStatus: 'CANCELLED',
        status: 'CANCELLED',
        lastFillAttemptAt: new Date(),
        fillAttemptCount: { increment: 1 },
        failureReason: mktLiquidity <= 0
          ? 'Zero liquidity — cannot fill paper order'
          : `Uncertainty ${(mktUncertainty * 100).toFixed(1)}% exceeds 45% threshold — paper fill blocked`,
      });
      await db.paperBet.updateMany({
        where: { orderId: params.orderId },
        data: { executionStatus: 'CANCELLED' },
      });
      await db.tradeCandidate.updateMany({
        where: { marketId: params.marketId },
        data: { stage: 'EXECUTION_FAILED' },
      });
      return {
        filledSize: 0,
        avgFillPrice: 0,
        isFullyFilled: false,
        orderStatus: 'CANCELLED',
      };
    }

    const riskInput = {
      impliedProbability: latestMarketSnapshot.impliedProb,
      judgeProbability: latestDecision.judgeProbability,
      confidence: latestDecision.confidence,
      uncertainty: mktUncertainty,
      fees: typeof riskConfig.fees === 'number' ? riskConfig.fees : 0,
      slippage: typeof riskConfig.slippage === 'number' ? riskConfig.slippage : 0,
      venue: latestDecision.market.venue as Venue,
      category: latestDecision.market.category,
      dailyExposure: 0,
      categoryExposure: 0,
      openPositions: 0,
      maxPositionSize: tradingConfig.maxExposurePerMarket,
      maxDailyExposure: tradingConfig.maxDailyExposure,
      maxCategoryExposure: tradingConfig.maxCategoryExposure,
      minLiquidity: tradingConfig.minLiquidity,
      maxSpread: tradingConfig.maxSpread,
      bidEdgeThreshold: typeof riskConfig.bidEdgeThreshold === 'number' ? riskConfig.bidEdgeThreshold : undefined,
      watchEdgeThreshold: typeof riskConfig.watchEdgeThreshold === 'number' ? riskConfig.watchEdgeThreshold : undefined,
      bidConfidenceThreshold: typeof riskConfig.bidConfidenceThreshold === 'number' ? riskConfig.bidConfidenceThreshold : undefined,
      watchConfidenceThreshold: typeof riskConfig.watchConfidenceThreshold === 'number' ? riskConfig.watchConfidenceThreshold : undefined,
      maxUncertaintyThreshold: typeof riskConfig.maxUncertaintyThreshold === 'number' ? riskConfig.maxUncertaintyThreshold : undefined,
      marketLiquidity: mktLiquidity,
      marketSpread: latestMarketSnapshot.spread,
      marketResolutionTime: latestDecision.market.resolutionTime,
      maxResolutionDays: tradingConfig.maxResolutionDays,
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
      await db.tradeCandidate.updateMany({
        where: { marketId: params.marketId },
        data: { stage: 'EXECUTION_FAILED' },
      });
      return {
        filledSize: 0,
        avgFillPrice: 0,
        isFullyFilled: false,
        orderStatus: 'CANCELLED',
      };
    }
  }

  if (
    !latestMarketSnapshot ||
    !latestDecision ||
    latestDecision.judgeProbability == null ||
    latestDecision.confidence == null ||
    latestDecision.uncertainty == null
  ) {
    await updateOrderCompat(params.orderId, {
      lifecycleStatus: 'CANCELLED',
      status: 'CANCELLED',
      lastFillAttemptAt: new Date(),
      fillAttemptCount: { increment: 1 },
      failureReason: 'Risk re-evaluation failed: missing latest market snapshot or decision context',
    });
    await db.paperBet.updateMany({
      where: { orderId: params.orderId },
      data: { executionStatus: 'CANCELLED' },
    });
    await db.tradeCandidate.updateMany({
      where: { marketId: params.marketId },
      data: { stage: 'EXECUTION_FAILED' },
    });
    return {
      filledSize: 0,
      avgFillPrice: 0,
      isFullyFilled: false,
      orderStatus: 'CANCELLED',
    };
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
      ? clampContractPrice((
          ((order.avgFillPrice ?? 0) * prevFilledSize) +
          (fillResult.avgFillPrice * incrementalFill)
        ) / Math.max(nextFilledSize, 1))
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
        entryPrice: clampContractPrice(nextAvgFillPrice ?? order.price),
      },
    });

    const existingPosition = await db.position.findFirst({
      where: { marketId: params.marketId, side: order.side, status: { in: ['OPEN', 'WATCH'] } },
    });

    if (!existingPosition) {
      await db.position.create({
        data: {
          marketId: params.marketId,
          side: order.side,
          entryPrice: clampContractPrice(fillResult.avgFillPrice),
          currentSize: incrementalFill,
          avgEntryPrice: clampContractPrice(fillResult.avgFillPrice),
          unrealizedPnl: 0,
          realizedPnl: 0,
          status: 'OPEN',
          openedAt: new Date(),
        },
      });
    } else {
      const newSize = existingPosition.currentSize + incrementalFill;
      const newAvgPrice = clampContractPrice(((existingPosition.avgEntryPrice * existingPosition.currentSize) + (fillResult.avgFillPrice * incrementalFill)) / newSize);
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
      data: { stage: 'EXECUTED', skipReason: null, lastExecutionAt: fillTimestamp },
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
