import { NextRequest, NextResponse } from 'next/server';
import { getSimState, startSimulation, stopSimulation, updateConfig } from '@/lib/engine/live-simulation';

// GET: Get current simulation state (poll this for live updates)
export async function GET() {
  return NextResponse.json(getSimState());
}

// POST: Start, stop, or reconfigure the live simulation
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const action = body.action as string;

    if (action === 'start') {
      const config = body.config ? {
        venues: body.config.venues,
        categories: body.config.categories,
        scanIntervalSec: body.config.scanIntervalSec,
        marketsPerScan: body.config.marketsPerScan,
        maxPortfolioExposure: body.config.maxPortfolioExposure,
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
