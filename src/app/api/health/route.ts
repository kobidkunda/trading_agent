import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { SystemHealth } from '@/lib/types';
import { isEncrypted, decrypt } from '@/lib/engine/crypto';

export async function GET() {
  try {
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

    // Ping real services
    const credentials = await db.credential.findMany({ where: { isActive: true } });
    const apiHealth: Record<string, 'UP' | 'DOWN' | 'DEGRADED'> = {};

    for (const cred of credentials) {
      if (!cred.serviceUrl || cred.testResult !== 'SUCCESS') {
        apiHealth[cred.service.toLowerCase()] = 'DOWN' as const;
        continue;
      }

      const serviceEndpoints: Record<string, string> = {
        qdrant: '/healthz',
        ollama: '/api/tags',
        searxng: '/search?q=test&format=json',
        mem0: '/health',
        llm: '/models',
        'llm provider': '/models',
        openai: '/models',
      };

      const endpoint = serviceEndpoints[cred.service.toLowerCase()];
      if (!endpoint) continue;

      try {
        let parsedData: Record<string, unknown> = {};
        if (cred.encryptedData) {
          try {
            const raw = isEncrypted(cred.encryptedData) ? decrypt(cred.encryptedData) : cred.encryptedData;
            parsedData = JSON.parse(raw);
          } catch {}
        }

        const headers: Record<string, string> = { Accept: 'application/json' };
        if (parsedData.apiKey) headers['Authorization'] = `Bearer ${parsedData.apiKey}`;

        const res = await fetch(`${cred.serviceUrl.replace(/\/$/, '')}${endpoint}`, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(5000),
        });
        apiHealth[cred.service.toLowerCase()] = res.ok ? 'UP' as const : 'DEGRADED' as const;
      } catch {
        apiHealth[cred.service.toLowerCase()] = 'DOWN' as const;
      }
    }

    const vectorStatus = apiHealth['qdrant'] || ('DOWN' as const);

    // Build the health response
    const health: SystemHealth & {
      jobsByType: Record<string, number>;
      jobsByStatus: Record<string, number>;
      recentErrors: typeof recentErrors;
      recentCompleted: typeof recentCompleted;
    } = {
      queueDepth,
      failingJobs,
      apiHealth,
      venueRateLimits: {},
      walletSync: 'OK',
      dbStatus,
      vectorStatus,
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