import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEffectiveTradingConfig, TRADING_CONFIG_KEY, TRADING_MODE_KEY, STRATEGY_SETTINGS_KEY } from '@/lib/engine/trading-settings';
import { enforceRoutePermission } from '@/lib/engine/auth';

export async function POST(request: NextRequest) {
  const denied = enforceRoutePermission(request, '/api/trading/process-orders', 'POST');
  if (denied) return denied;

  try {
    const completeStaleOrderTrackJobs = async () => {
      const activeMarkets = await db.order.findMany({
        where: { lifecycleStatus: { in: ['SUBMITTED', 'PARTIALLY_FILLED'] } },
        select: { marketId: true },
        distinct: ['marketId'],
      });
      const activeMarketIds = new Set(activeMarkets.map((order) => order.marketId));
      const pendingTrackers = await db.job.findMany({
        where: { type: 'ORDER_TRACK', status: { in: ['PENDING', 'RETRYING'] } },
      });
      const staleIds = pendingTrackers
        .filter((job) => {
          try {
            const payload = JSON.parse(job.payload || '{}') as { marketId?: string };
            return payload.marketId ? !activeMarketIds.has(payload.marketId) : true;
          } catch {
            return true;
          }
        })
        .map((job) => job.id);

      if (staleIds.length === 0) return 0;
      const result = await db.job.updateMany({
        where: { id: { in: staleIds } },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          result: JSON.stringify({ status: 'NO_ACTIVE_ORDER', cleanedBy: '/api/trading/process-orders' }),
        },
      });
      return result.count;
    };

    const orders = await db.order.findMany({
      where: { lifecycleStatus: { in: ['SUBMITTED', 'PARTIALLY_FILLED'] } },
      include: {
        market: { select: { id: true, title: true, latestLiquidity: true, latestSpread: true } },
      },
    });

    if (orders.length === 0) {
      const staleTrackersCompleted = await completeStaleOrderTrackJobs();
      return NextResponse.json({ message: 'No orders to process', processed: 0, staleTrackersCompleted });
    }

    const [strategySetting, tradingConfigSetting, tradingModeSetting] = await Promise.all([
      db.settings.findUnique({ where: { key: STRATEGY_SETTINGS_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_CONFIG_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_MODE_KEY } }),
    ]);
    const config = getEffectiveTradingConfig({
      strategySettings: strategySetting ? JSON.parse(strategySetting.value) : null,
      tradingConfig: tradingConfigSetting ? JSON.parse(tradingConfigSetting.value) : null,
      tradingMode: tradingModeSetting?.value ?? null,
    });

    const marketIds = orders.map(o => o.marketId);
    const snapshots = await db.marketSnapshot.findMany({
      where: { marketId: { in: marketIds } },
      orderBy: { timestamp: 'desc' },
    });
    const snapshotByMarket = new Map<string, typeof snapshots[0]>();
    for (const s of snapshots) {
      if (!snapshotByMarket.has(s.marketId)) snapshotByMarket.set(s.marketId, s);
    }

    const results: Array<Record<string, unknown>> = [];

    for (const order of orders) {
      const snapshot = snapshotByMarket.get(order.marketId);
      const fillModel = (order as any).fillModel ?? config.paperFillModel;

      const { processPaperOrderFill } = await import('@/lib/engine/order-tracker');

      try {
        const fillResult = await processPaperOrderFill({
          orderId: order.id,
          marketId: order.marketId,
          fillModel: (fillModel as any) ?? 'CONSERVATIVE_PAPER',
          liquidity: snapshot?.liquidity ?? order.market.latestLiquidity ?? 0,
          fillProbability: snapshot?.fillProbability ?? null,
          priceImpact: snapshot?.priceImpact ?? null,
          bidDepth: snapshot?.bidDepth ?? null,
          askDepth: snapshot?.askDepth ?? null,
          spread: snapshot?.spread ?? order.market.latestSpread ?? null,
        });

        const position = fillResult.filledSize > 0
          ? await db.position.findFirst({ where: { marketId: order.marketId, status: 'OPEN' } })
          : null;

        results.push({
          orderId: order.id,
          marketId: order.marketId,
          marketTitle: order.market.title,
          filled: fillResult.filledSize > 0,
          filledSize: fillResult.filledSize,
          avgFillPrice: fillResult.avgFillPrice,
          isFullyFilled: fillResult.isFullyFilled,
          orderLifecycle: fillResult.orderStatus,
          positionId: position?.id ?? null,
          positionSize: position?.currentSize ?? null,
        });
      } catch (err) {
        results.push({
          orderId: order.id,
          marketId: order.marketId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const staleTrackersCompleted = await completeStaleOrderTrackJobs();

    const [paperBets, positions, fills, filledOrders] = await Promise.all([
      db.paperBet.count(),
      db.position.count(),
      db.fill.count(),
      db.order.count({ where: { lifecycleStatus: { in: ['FILLED', 'PARTIALLY_FILLED'] } } }),
    ]);

    return NextResponse.json({
      processed: results.length,
      results,
      staleTrackersCompleted,
      totals: { paperBets, positions, fills, filledOrders },
    });
  } catch (error) {
    console.error('[process-orders] Failed to process paper orders:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
