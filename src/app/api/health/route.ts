import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { SystemHealth } from '@/lib/types';
import { isEncrypted, decrypt } from '@/lib/engine/crypto';
import { resolveResearchProvider } from '@/lib/engine/service-routing';

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
      researchProvider,
      checkedAt,
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
        researchProvider: null,
        checkedAt: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}