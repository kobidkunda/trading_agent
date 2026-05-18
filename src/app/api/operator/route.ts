import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeTradingMode } from '@/lib/engine/mode';

const TRADING_MODE_KEY = 'trading_mode';

export async function GET(request: NextRequest) {
  try {
    // Fetch mode
    const modeSetting = await db.settings.findUnique({
      where: { key: TRADING_MODE_KEY },
    });
    const mode = modeSetting ? normalizeTradingMode(modeSetting.value) : 'PAPER';

    // Fetch active scan jobs
    const [activeJobs, totalDecisions, openPositions, recentOrders] = await Promise.all([
      db.job.findMany({
        where: { status: { in: ['RUNNING', 'RETRYING'] } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
      db.decision.count(),
      db.position.count({
        where: { status: 'OPEN' },
      }),
      db.order.findMany({
        where: { lifecycleStatus: { in: ['SUBMITTED', 'PARTIALLY_FILLED', 'PLANNED'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: {
          market: { select: { id: true, title: true, venue: true } },
        },
      }),
    ]);

    // Fetch active positions
    const positions = await db.position.findMany({
      where: { status: 'OPEN' },
      include: {
        market: { select: { id: true, title: true, venue: true } },
      },
      orderBy: { openedAt: 'desc' },
      take: 20,
    });

    // Compute health indicators
    const queueDepth = await db.job.count({ where: { status: 'PENDING' } });
    const failingJobs = await db.job.count({
      where: { status: 'FAILED', updatedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });

    const health = {
      queueDepth,
      failingJobs,
      dbStatus: 'UP' as const,
    };

    return NextResponse.json({
      status: mode !== 'LIVE' ? 'operational' : 'live',
      mode,
      cycle: activeJobs.length > 0 ? 'running' : 'idle',
      activePositions: openPositions,
      totalDecisions,
      health,
      recentOrders,
      positions,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch operator dashboard' }, { status: 500 });
  }
}
