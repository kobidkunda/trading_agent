import { NextRequest, NextResponse } from 'next/server';
import { runSimulation } from '@/lib/engine/simulation';
import { db } from '@/lib/db';
import type { SimulationConfig, SimulationReport } from '@/lib/engine/simulation';
import { DEFAULT_STRATEGY } from '@/lib/engine/risk';
import type { Venue } from '@/lib/types';

// GET: Retrieve simulation results from the latest run
export async function GET() {
  try {
    // Get the most recent decisions created by simulation (dry-run=true)
    const [recentDecisions, recentJobs, recentOrders] = await Promise.all([
      db.decision.findMany({
        where: { dryRun: true },
        include: {
          market: { select: { id: true, title: true, venue: true, category: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      db.job.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
      db.order.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          market: { select: { id: true, title: true } },
        },
      }),
    ]);

    return NextResponse.json({
      recentDecisions,
      recentJobs,
      recentOrders,
      totalSimulatedDecisions: await db.decision.count({ where: { dryRun: true } }),
      totalSimulatedOrders: await db.order.count(),
      totalJobs: await db.job.count(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch simulation data' },
      { status: 500 },
    );
  }
}

// POST: Start a new simulation run
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Parse configuration from request body
    const marketCount = Math.min(Math.max(body.marketCount ?? 5, 1), 20);
    const venues: Venue[] = body.venues?.length > 0
      ? body.venues
      : DEFAULT_STRATEGY.enabledVenues as Venue[];
    const categories: string[] = body.categories?.length > 0
      ? body.categories
      : DEFAULT_STRATEGY.enabledCategories;

    const config: SimulationConfig = {
      marketCount,
      venues,
      categories,
      strategy: DEFAULT_STRATEGY,
      speed: body.speed ?? 'normal',
    };

    // Log simulation start
    await db.auditLog.create({
      data: {
        action: 'START_SIMULATION',
        entityType: 'Simulation',
        entityId: `sim_${Date.now()}`,
        details: `Starting dry-run simulation: ${marketCount} markets, venues=[${venues.join(',')}], categories=[${categories.join(',')}]`,
      },
    });

    // Run the simulation
    const report = await runSimulation(config);

    // Log simulation completion
    await db.auditLog.create({
      data: {
        action: 'COMPLETE_SIMULATION',
        entityType: 'Simulation',
        entityId: report.id,
        details: `Simulation completed: ${report.summary.executed} executed, ${report.summary.totalEstimatedPnl.toFixed(2)} est. PnL, ${report.summary.totalDurationMs}ms`,
      },
    });

    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Simulation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
