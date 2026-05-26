import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { SystemHealth } from '@/lib/types';
import { isEncrypted, decrypt } from '@/lib/engine/crypto';
import { resolveResearchProvider } from '@/lib/engine/service-routing';
import { checkServiceHealth } from '@/lib/engine/health-check';

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
    const now = new Date();
    const nowMs = Date.now();
    const maintenanceFailureFilter = {
      OR: [
        { error: { contains: 'Stale lock released' } },
        { error: { equals: 'Stuck' } },
        { error: { contains: 'reset by maintenance' } },
      ],
    };
    const actionableFailureWhere = {
      status: 'FAILED',
      NOT: maintenanceFailureFilter,
    } as const;

    const [
      runnableQueueDepth,
      scheduledQueueDepth,
      scheduledResolutionChecks,
      nextScheduledJob,
      nextResolutionCheck,
      failingJobs,
      maintenanceFailedJobs,
      stuckJobRows,
      lockedJobsCount,
      retryingJobsCount,
      recentErrors,
      recentMaintenanceErrors,
    ] = await Promise.all([
      db.job.count({
        where: {
          status: { in: ['PENDING', 'RUNNING', 'RETRYING'] },
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
      }),
      db.job.count({
        where: {
          status: { in: ['PENDING', 'RETRYING'] },
          nextRetryAt: { gt: now },
        },
      }),
      db.job.count({
        where: {
          type: 'RESOLUTION_CHECK',
          status: { in: ['PENDING', 'RETRYING'] },
          nextRetryAt: { gt: now },
        },
      }),
      db.job.findFirst({
        where: {
          status: { in: ['PENDING', 'RETRYING'] },
          nextRetryAt: { gt: now },
        },
        orderBy: { nextRetryAt: 'asc' },
        select: { nextRetryAt: true },
      }),
      db.job.findFirst({
        where: {
          type: 'RESOLUTION_CHECK',
          status: { in: ['PENDING', 'RETRYING'] },
          nextRetryAt: { gt: now },
        },
        orderBy: { nextRetryAt: 'asc' },
        select: { nextRetryAt: true },
      }),
      db.job.count({ where: actionableFailureWhere }),
      db.job.count({ where: { status: 'FAILED', ...maintenanceFailureFilter } }),
      db.$queryRaw<Array<{ count: bigint | number }>>`
        select count(*) as count
        from Job
        where status = 'RUNNING'
          and heartbeatAt is not null
          and (heartbeatAt + (coalesce(maxRuntimeSec, 300) * 1000)) < ${nowMs}
      `,
      db.job.count({ where: { status: 'RUNNING', lockExpiresAt: { not: null, lt: now } } }),
      db.job.count({ where: { status: 'RETRYING' } }),
      db.job.findMany({
        where: {
          OR: [
            actionableFailureWhere,
            { status: 'RETRYING', error: { not: null } },
          ],
        },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { id: true, type: true, status: true, error: true, updatedAt: true },
      }),
      db.job.findMany({
        where: { status: 'FAILED', ...maintenanceFailureFilter },
        orderBy: { updatedAt: 'desc' },
        take: 5,
        select: { id: true, type: true, status: true, error: true, updatedAt: true },
      }),
    ]);
    const stuckJobsCount = Number(stuckJobRows[0]?.count ?? 0);

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

    const SERVICE_DISPLAY_MAP: Record<string, string> = {
      qdrant: 'Qdrant',
      ollama: 'Ollama',
      searxng: 'SearXNG',
      mem0: 'Mem0',
      llm: 'LLM',
      openai: 'OpenAI',
      polymarket: 'Polymarket',
      kalshi: 'Kalshi',
      gemini: 'Gemini',
      deerflow: 'DeerFlow',
      tradingagents: 'TradingAgents',
      mirofis: 'MiroFish',
      mirofish: 'MiroFish',
      firecrawl: 'Firecrawl',
      'agent_reach': 'Agent-Reach',
    };

    const SERVICE_ENDPOINTS: Record<string, string> = {
      qdrant: '/healthz',
      ollama: '/api/tags',
      searxng: '/search?q=test&format=json',
      mem0: '/health',
      llm: '/models',
      openai: '/models',
      deerflow: '/health',
      tradingagents: '/health',
      mirofis: '/health',
      mirofish: '/health',
      'agent_reach': '/health',
    };

    for (const cred of credentials) {
      let serviceId = cred.service.toLowerCase();
      if (serviceId === 'llm provider') serviceId = 'llm';

      const displayName = SERVICE_DISPLAY_MAP[serviceId] || cred.service;
      const endpoint = SERVICE_ENDPOINTS[serviceId];

      if (!cred.serviceUrl) {
        apiHealth[displayName] = 'DOWN' as const;
        continue;
      }

      if (cred.testResult && cred.testResult !== 'SUCCESS') {
        apiHealth[displayName] = 'DOWN' as const;
        continue;
      }

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
        apiHealth[displayName] = res.ok ? 'UP' as const : 'DEGRADED' as const;
      } catch {
        apiHealth[displayName] = 'DOWN' as const;
      }
    }

    // Always include the core research/runtime stack, even when credentials come from env fallbacks.
    const requiredServices = [
      'deerflow',
      'tradingagents',
      'agent_reach',
      'mirofish',
      'searxng',
      'qdrant',
      'openai',
      'ollama',
      'firecrawl',
    ] as const;

    const serviceChecks = await Promise.all(requiredServices.map((service) => checkServiceHealth(service)));
    for (const service of serviceChecks) {
      if (service.status === 'UNKNOWN') continue;
      apiHealth[service.name] = service.status;
    }

    const vectorStatus = apiHealth['Qdrant'] || ('DOWN' as const);

    // Research provider resolution
    let researchProvider: string | null = null;
    try {
      researchProvider = await resolveResearchProvider();
    } catch {}
    const checkedAt = new Date().toISOString();

    // Build the health response
    const health: SystemHealth & {
      jobsByType: Record<string, number>;
      jobsByStatus: Record<string, number>;
      recentErrors: typeof recentErrors;
      recentMaintenanceErrors: typeof recentMaintenanceErrors;
      recentCompleted: typeof recentCompleted;
      maintenanceFailedJobs: number;
    } = {
      queueDepth: runnableQueueDepth,
      dueQueueDepth: runnableQueueDepth,
      scheduledQueueDepth,
      scheduledResolutionChecks,
      nextScheduledJobAt: nextScheduledJob?.nextRetryAt?.toISOString() ?? null,
      nextResolutionCheckAt: nextResolutionCheck?.nextRetryAt?.toISOString() ?? null,
      failingJobs,
      maintenanceFailedJobs,
      stuckJobsCount,
      lockedJobsCount,
      retryingJobsCount,
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
      recentMaintenanceErrors,
      recentCompleted,
      researchProvider,
      checkedAt,
    };

    return NextResponse.json(health);
  } catch (error) {
    return NextResponse.json(
      {
        queueDepth: 0,
        failingJobs: 0,
        stuckJobsCount: 0,
        lockedJobsCount: 0,
        retryingJobsCount: 0,
        apiHealth: {},
        venueRateLimits: {},
        walletSync: 'ERROR',
        dbStatus: 'DOWN' as const,
        vectorStatus: 'DOWN' as const,
        lastScanAt: null,
        uptimeSeconds: process.uptime(),
        error: 'Failed to fetch system health',
        researchProvider: null,
        checkedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
