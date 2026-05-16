import { db } from '@/lib/db';
import { updateOrderCompat } from '@/lib/engine/prisma-runtime-compat';

export type OrderTrackerLifecycle = 'PLANNED' | 'SUBMITTED' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'FAILED' | 'EXPIRED';

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

export async function processPaperOrderFill(params: {
  orderId: string;
  marketId: string;
  fillModel: 'INSTANT' | 'BOOK_AWARE';
  liquidity: number;
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

  const { resolvePaperFill } = await import('./paper-execution');

  const fillResult = resolvePaperFill({
    size: order.size,
    price: order.price,
    fillModel: params.fillModel,
    liquidity: params.liquidity,
  });

  const newLifecycleStatus = fillResult.isFullyFilled ? 'FILLED' : 'PARTIALLY_FILLED';

  await updateOrderCompat(params.orderId, {
    lifecycleStatus: newLifecycleStatus,
    filledSize: fillResult.filledSize,
    remainingSize: fillResult.remainingSize,
    avgFillPrice: fillResult.avgFillPrice,
    filledAt: fillResult.isFullyFilled ? new Date() : null,
    status: fillResult.isFullyFilled ? 'FILLED' : 'PARTIALLY_FILLED',
  });

  // Create position only when partially or fully filled
  if (fillResult.filledSize > 0) {
    const existingPosition = await db.position.findFirst({
      where: { marketId: params.marketId, status: { in: ['OPEN', 'WATCH'] } },
    });

    if (!existingPosition) {
      await db.position.create({
        data: {
          marketId: params.marketId,
          side: order.side,
          entryPrice: fillResult.avgFillPrice,
          currentSize: fillResult.filledSize,
          avgEntryPrice: fillResult.avgFillPrice,
          unrealizedPnl: 0,
          realizedPnl: 0,
          status: 'OPEN',
          openedAt: new Date(),
        },
      });
    } else {
      // Update existing position
      const newSize = existingPosition.currentSize + fillResult.filledSize;
      const newAvgPrice = ((existingPosition.avgEntryPrice * existingPosition.currentSize) + (fillResult.avgFillPrice * fillResult.filledSize)) / newSize;
      await db.position.update({
        where: { id: existingPosition.id },
        data: {
          currentSize: newSize,
          avgEntryPrice: newAvgPrice,
          status: 'OPEN',
        },
      });
    }
  }

  return {
    filledSize: fillResult.filledSize,
    avgFillPrice: fillResult.avgFillPrice,
    isFullyFilled: fillResult.isFullyFilled,
    orderStatus: newLifecycleStatus,
  };
}
