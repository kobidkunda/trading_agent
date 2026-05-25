import { NextRequest, NextResponse } from 'next/server';
import { getSimState, startSimulation, stopSimulation, updateConfig } from '@/lib/engine/live-simulation';
import { db } from '@/lib/db';
import { getEffectiveTradingConfig, STRATEGY_SETTINGS_KEY, TRADING_CONFIG_KEY, TRADING_MODE_KEY } from '@/lib/engine/trading-settings';
import { getSimulationAccess } from '@/lib/engine/simulation-access';

// GET: Get current simulation state (poll this for live updates)
export async function GET() {
  const simState = getSimState();

  return NextResponse.json({
    ...simState,
    currentStage: simState.currentStage,
    currentStageStartedAt: simState.currentStageStartedAt,
    activityEvents: simState.activityEvents,
    marketProgress: simState.marketProgress,
    lastCompletedMarket: simState.lastCompletedMarket,
  });
}

// POST: Start, stop, or reconfigure the live simulation
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    if (action === 'stop') {
      const newState = stopSimulation();
      return NextResponse.json(newState);
    }

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

    if (action === 'start') {
      const access = getSimulationAccess(tradingConfig.mode);
      if (!access.allowed) {
        return NextResponse.json({ error: access.reason }, { status: 409 });
      }

      const config = body.config ? {
        ...(body.config.venues ? { venues: body.config.venues } : {}),
        ...(body.config.categories ? { categories: body.config.categories } : {}),
        ...(body.config.scanIntervalSec != null ? { scanIntervalSec: body.config.scanIntervalSec } : {}),
        ...(body.config.marketsPerScan != null ? { marketsPerScan: body.config.marketsPerScan } : {}),
        ...(body.config.maxPortfolioExposure != null ? { maxPortfolioExposure: body.config.maxPortfolioExposure } : {}),
      } : undefined;
      const newState = await startSimulation(config);
      return NextResponse.json(newState);
    }

    if (action === 'config') {
      const newState = updateConfig(body.config ?? {});
      return NextResponse.json(newState);
    }

    // Legacy: single-run simulation still supported
    if (action === 'run') {
      const access = getSimulationAccess(tradingConfig.mode);
      if (!access.allowed) {
        return NextResponse.json({ error: access.reason }, { status: 409 });
      }

      const { runSimulation } = await import('@/lib/engine/simulation');
      const { DEFAULT_STRATEGY } = await import('@/lib/engine/risk');
      const marketCount = Math.min(Math.max(body.marketCount ?? 5, 1), 20);
      const report = await runSimulation({
        marketCount,
        venues: body.venues?.length > 0 ? body.venues : DEFAULT_STRATEGY.enabledVenues as any,
        categories: body.categories?.length > 0 ? body.categories : DEFAULT_STRATEGY.enabledCategories,
        strategy: DEFAULT_STRATEGY,
        speed: body.speed ?? 'normal',
      });
      return NextResponse.json(report, { status: 201 });
    }

    return NextResponse.json({ error: 'Unknown action. Use: start, stop, config, or run' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
