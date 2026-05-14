import { NextRequest, NextResponse } from 'next/server';
import { getSimState, startSimulation, stopSimulation, updateConfig } from '@/lib/engine/live-simulation';

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

    if (action === 'start') {
      const config = body.config ? {
        ...(body.config.venues ? { venues: body.config.venues } : {}),
        ...(body.config.categories ? { categories: body.config.categories } : {}),
        ...(body.config.scanIntervalSec != null ? { scanIntervalSec: body.config.scanIntervalSec } : {}),
        ...(body.config.marketsPerScan != null ? { marketsPerScan: body.config.marketsPerScan } : {}),
        ...(body.config.maxPortfolioExposure != null ? { maxPortfolioExposure: body.config.maxPortfolioExposure } : {}),
      } : undefined;
      const newState = startSimulation(config);
      return NextResponse.json(newState);
    }

    if (action === 'stop') {
      const newState = stopSimulation();
      return NextResponse.json(newState);
    }

    if (action === 'config') {
      const newState = updateConfig(body.config ?? {});
      return NextResponse.json(newState);
    }

    // Legacy: single-run simulation still supported
    if (action === 'run') {
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
