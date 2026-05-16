import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSimState } from '@/lib/engine/live-simulation';
import {
  buildOperatorDashboardPayload,
  type OperatorSimulationState,
} from '@/lib/engine/operator-dashboard-view-model';
import {
  getEffectiveTradingConfig,
  STRATEGY_SETTINGS_KEY,
  TRADING_CONFIG_KEY,
  TRADING_MODE_KEY,
} from '@/lib/engine/trading-settings';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '60', 10), 1), 120);
    const marketId = searchParams.get('marketId');

    const [strategySetting, tradingConfigSetting, tradingModeSetting] = await Promise.all([
      db.settings.findUnique({ where: { key: STRATEGY_SETTINGS_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_CONFIG_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_MODE_KEY } }),
    ]);

    const tradingConfig = getEffectiveTradingConfig({
      strategySettings: strategySetting ? JSON.parse(strategySetting.value) : null,
      tradingConfig: tradingConfigSetting ? JSON.parse(tradingConfigSetting.value) : null,
      tradingMode: tradingModeSetting?.value ?? null,
    });

    const markets = await db.market.findMany({
      where: marketId ? { id: marketId } : undefined,
      take: marketId ? 1 : limit,
      orderBy: { updatedAt: 'desc' },
      include: {
        snapshots: { orderBy: { timestamp: 'desc' }, take: 1 },
        tradeCandidates: { orderBy: { updatedAt: 'desc' }, take: 1 },
        decisions: { orderBy: { createdAt: 'desc' }, take: 6 },
        orders: { orderBy: { createdAt: 'desc' }, take: 12 },
        paperBets: {
          orderBy: { createdAt: 'desc' },
          take: 12,
          include: {
            decision: {
              select: {
                id: true,
                action: true,
                side: true,
                reason: true,
                createdAt: true,
              },
            },
          },
        },
        outcomes: { orderBy: { resolvedAt: 'desc' }, take: 1 },
        researchRuns: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            agentOutputs: {
              orderBy: { createdAt: 'desc' },
              take: 20,
              select: {
                role: true,
                summary: true,
                output: true,
                failureReason: true,
                createdAt: true,
              },
            },
          },
        },
      },
    });

    const simulation = getSimState() as OperatorSimulationState;
    const payload = buildOperatorDashboardPayload({
      mode: tradingConfig.mode,
      markets: markets as never,
      simulation,
    });

    return NextResponse.json(payload);
  } catch (error) {
    console.error('[Operator API] GET error:', error);
    return NextResponse.json(
      { error: 'Failed to build operator dashboard', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
