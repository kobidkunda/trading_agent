import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { SystemHealth } from '@/lib/types';

export async function GET() {
  try {
    const startTime = Date.now();

    // Check database connectivity
    let dbStatus: 'UP' | 'DOWN' = 'UP';
    try {
      await db.settings.findFirst();
    } catch {
      dbStatus = 'DOWN';
    }

    // Get job queue metrics
    const [queueDepth, failingJobs, recentErrors] = await Promise.all([
      db.job.count({ where: { status: { in: ['PENDING', 'RUNNING', 'RETRYING'] } } }),
      db.job.count({ where: { status: 'FAILED' } }),
      db.job.findMany({
        where: { error: { not: null } },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { id: true, type: true, status: true, error: true, updatedAt: true },
      }),
    ]);

    // Get job counts by type and status
    const jobsByType = await db.job.groupBy({
      by: ['type'],
      _count: { id: true },
    });

    const jobsByStatus = await db.job.groupBy({
      by: ['status'],
      _count: { id: true },
    });

    // Get last scan time from settings
    let lastScanAt: string | null = null;
    try {
      const lastScanSetting = await db.settings.findUnique({
        where: { key: 'last_scan_time' },
      });
      if (lastScanSetting) {
        lastScanAt = lastScanSetting.value;
      }
    } catch {
      // Setting may not exist yet
    }

    // Get recent completed jobs for activity
    const recentCompleted = await db.job.findMany({
      where: { status: 'COMPLETED' },
      orderBy: { completedAt: 'desc' },
      take: 5,
      select: { id: true, type: true, completedAt: true },
    });

    // Build the health response
    const health: SystemHealth & {
      jobsByType: Record<string, number>;
      jobsByStatus: Record<string, number>;
      recentErrors: typeof recentErrors;
      recentCompleted: typeof recentCompleted;
    } = {
      queueDepth,
      failingJobs,
      apiHealth: {},
      venueRateLimits: {},
      walletSync: 'OK',
      dbStatus,
      vectorStatus: dbStatus, // Vector DB mirrors main DB status
      lastScanAt,
      uptimeSeconds: process.uptime(),
      jobsByType: Object.fromEntries(jobsByType.map((j) => [j.type, j._count.id])),
      jobsByStatus: Object.fromEntries(jobsByStatus.map((j) => [j.status, j._count.id])),
      recentErrors,
      recentCompleted,
    };

    return NextResponse.json(health);
  } catch (error) {
    return NextResponse.json(
      {
        queueDepth: 0,
        failingJobs: 0,
        apiHealth: {},
        venueRateLimits: {},
        walletSync: 'ERROR',
        dbStatus: 'DOWN' as const,
        vectorStatus: 'DOWN' as const,
        lastScanAt: null,
        uptimeSeconds: process.uptime(),
        error: 'Failed to fetch system health',
      },
      { status: 503 },
    );
  }
}
