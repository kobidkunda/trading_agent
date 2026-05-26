import { db } from '@/lib/db';

const ACTIVE_JOB_STATUSES = ['PENDING', 'RUNNING', 'RETRYING'];
const UNRESOLVED_PAPER_BET_STATUSES = ['SUBMITTED', 'FILLED', 'PARTIAL'];

function extractMarketId(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { marketId?: unknown };
    return typeof parsed.marketId === 'string' && parsed.marketId.length > 0 ? parsed.marketId : null;
  } catch {
    return null;
  }
}

export async function pruneObsoleteResolutionJobs(): Promise<{ checked: number; pruned: number }> {
  const activeJobs = await db.job.findMany({
    where: {
      type: 'RESOLUTION_CHECK',
      status: { in: ACTIVE_JOB_STATUSES },
    },
    select: { id: true, payload: true },
  });

  if (activeJobs.length === 0) return { checked: 0, pruned: 0 };

  const marketIds = [...new Set(activeJobs.map((job) => extractMarketId(job.payload)).filter((id): id is string => Boolean(id)))];
  const activeBetMarkets = marketIds.length > 0
    ? await db.paperBet.findMany({
        where: {
          marketId: { in: marketIds },
          actualOutcome: null,
          executionStatus: { in: UNRESOLVED_PAPER_BET_STATUSES },
        },
        select: { marketId: true },
        distinct: ['marketId'],
      })
    : [];
  const activeMarketIds = new Set(activeBetMarkets.map((bet) => bet.marketId));
  const obsoleteIds = activeJobs
    .filter((job) => {
      const marketId = extractMarketId(job.payload);
      return !marketId || !activeMarketIds.has(marketId);
    })
    .map((job) => job.id);

  if (obsoleteIds.length === 0) return { checked: activeJobs.length, pruned: 0 };

  await db.job.updateMany({
    where: { id: { in: obsoleteIds }, status: { in: ACTIVE_JOB_STATUSES } },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      result: JSON.stringify({ status: 'OBSOLETE_RESOLUTION_JOB_PRUNED' }),
      lockExpiresAt: null,
      heartbeatAt: null,
    },
  });

  return { checked: activeJobs.length, pruned: obsoleteIds.length };
}

export async function scheduleResolutionCheckForMarket(params: {
  marketId: string;
  resolutionTime?: Date | string | null;
  trigger?: string;
}): Promise<{ created: boolean; jobId: string | null; nextRetryAt: Date | null }> {
  const market = params.resolutionTime === undefined
    ? await db.market.findUnique({
        where: { id: params.marketId },
        select: { resolutionTime: true },
      })
    : { resolutionTime: params.resolutionTime };

  const parsedResolution = market?.resolutionTime ? new Date(market.resolutionTime) : null;
  const now = new Date();
  const nextRetryAt = parsedResolution && Number.isFinite(parsedResolution.getTime()) && parsedResolution > now
    ? parsedResolution
    : now;
  const dedupKey = `resolution:${params.marketId}`;

  const existing = await db.job.findFirst({
    where: {
      type: { in: ['SETTLE', 'RESOLUTION_CHECK'] },
      status: { in: ACTIVE_JOB_STATUSES },
      OR: [
        { dedupKey },
        { payload: { contains: params.marketId } },
      ],
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existing) {
    const existingNextRetryAt = existing.nextRetryAt ? new Date(existing.nextRetryAt) : null;
    const shouldTightenSchedule = !existingNextRetryAt || existingNextRetryAt > nextRetryAt;
    if (shouldTightenSchedule) {
      const updated = await db.job.update({
        where: { id: existing.id },
        data: { nextRetryAt, dedupKey },
      });
      return { created: false, jobId: updated.id, nextRetryAt: updated.nextRetryAt };
    }
    return { created: false, jobId: existing.id, nextRetryAt: existing.nextRetryAt };
  }

  const job = await db.job.create({
    data: {
      type: 'RESOLUTION_CHECK',
      status: 'PENDING',
      priority: 6,
      payload: JSON.stringify({
        marketId: params.marketId,
        trigger: params.trigger ?? 'resolution_scheduler',
        scheduledFor: nextRetryAt.toISOString(),
      }),
      nextRetryAt,
      dedupKey,
      maxRetries: 5,
      maxRuntimeSec: 120,
    },
  });

  return { created: true, jobId: job.id, nextRetryAt: job.nextRetryAt };
}
