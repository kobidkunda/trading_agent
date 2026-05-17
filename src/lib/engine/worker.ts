import { db } from '@/lib/db';
import { runScanner } from '@/lib/engine/scanner';
import { runMarketLoopOnce } from '@/lib/engine/market-loop';
import { runPipelineForMarket } from '@/lib/engine/pipeline';
import { normalizeTradingMode } from '@/lib/engine/mode';
import { getEffectiveTradingConfig } from '@/lib/engine/trading-settings';
import { classifyOrderTerminalState, processPaperOrderFill } from '@/lib/engine/order-tracker';
import { saveCheckpoint } from '@/lib/engine/worker-checkpoint';

type WorkerStatus = 'STOPPED' | 'RUNNING';

interface WorkerState {
  status: WorkerStatus;
  jobsProcessed: number;
  errors: number;
  lastActivity: string | null;
  currentJobType: string | null;
  error: string | null;
  lastMarketLoopResult: {
    scanned: number;
    candidatesCreated: number;
    candidatesSkipped: number;
    jobsCreated: number;
  } | null;
}

const state: WorkerState = {
  status: 'STOPPED',
  jobsProcessed: 0,
  errors: 0,
  lastActivity: null,
  currentJobType: null,
  error: null,
  lastMarketLoopResult: null,
};

let intervalHandle: ReturnType<typeof setTimeout> | null = null;
let loopIntervalMs: number = 5000;

export function getWorkerState(): WorkerState {
  return { ...state };
}

export async function startWorker(intervalMs: number = 5000): Promise<WorkerState> {
  if (state.status === 'RUNNING') return state;
  state.status = 'RUNNING';
  state.error = null;
  loopIntervalMs = intervalMs;

  await releaseAllStaleLocks();

  tick();
  intervalHandle = setInterval(tick, intervalMs);
  return state;
}

export function stopWorker(): WorkerState {
  state.status = 'STOPPED';
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  state.currentJobType = null;
  state.lastActivity = new Date().toISOString();
  return state;
}

export interface ProcessedJobResult {
  jobId: string;
  jobType: string;
  marketId: string | null;
  status: 'COMPLETED' | 'RETRYING' | 'FAILED';
  error: string | null;
}

function extractMarketId(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const parsed = JSON.parse(payload) as { marketId?: unknown };
    return typeof parsed.marketId === 'string' ? parsed.marketId : null;
  } catch {
    return null;
  }
}

function computeBackoffMs(retryCount: number): number {
  return Math.min(300_000, 60_000 * Math.pow(2, retryCount));
}

async function releaseAllStaleLocks(): Promise<void> {
  const now = new Date();

  // Release stale Job locks
  const staleJobs = await db.job.findMany({
    where: {
      status: 'RUNNING',
      lockExpiresAt: { not: null, lt: now },
    },
    select: { id: true, payload: true, type: true },
  });

  for (const job of staleJobs) {
    await db.job.update({
      where: { id: job.id },
      data: { status: 'FAILED', error: 'Stale lock released at startup' },
    });
    const marketId = extractMarketId(job.payload);
    if (marketId) {
      await db.tradeCandidate.updateMany({
        where: { marketId, processingLock: { not: null } },
        data: { processingLock: null, lockExpiresAt: null },
      });
    }
  }

  // Release stale TradeCandidate locks
  await db.tradeCandidate.updateMany({
    where: { lockExpiresAt: { not: null, lt: now }, processingLock: { not: null } },
    data: { processingLock: null, lockExpiresAt: null },
  });

  // Detect stuck jobs (missed heartbeat)
  const stuckJobs = await db.job.findMany({
    where: { status: 'RUNNING', heartbeatAt: { not: null } },
    select: { id: true, heartbeatAt: true, maxRuntimeSec: true, payload: true },
  });

  for (const job of stuckJobs) {
    if (!job.heartbeatAt) continue;
    const maxRuntimeMs = (job.maxRuntimeSec || 300) * 1000;
    const deadline = new Date(new Date(job.heartbeatAt).getTime() + maxRuntimeMs);
    if (now > deadline) {
      await db.job.update({
        where: { id: job.id },
        data: { status: 'FAILED', error: 'Heartbeat lost — stale job recovered at startup' },
      });
      const marketId = extractMarketId(job.payload);
      if (marketId) {
        await db.tradeCandidate.updateMany({
          where: { marketId, processingLock: { not: null } },
          data: { processingLock: null, lockExpiresAt: null },
        });
      }
    }
  }
}

async function cleanupStaleLocks(): Promise<number> {
  const now = new Date();
  let cleaned = 0;

  const staleLocked = await db.job.findMany({
    where: { status: 'RUNNING', lockExpiresAt: { not: null, lt: now } },
    select: { id: true, payload: true },
  });

  for (const job of staleLocked) {
    await db.job.update({
      where: { id: job.id },
      data: { status: 'RETRYING', error: 'Lock timeout — retrying' },
    });
    const marketId = extractMarketId(job.payload);
    if (marketId) {
      await db.tradeCandidate.updateMany({
        where: { marketId, processingLock: { not: null } },
        data: { processingLock: null, lockExpiresAt: null },
      });
    }
    cleaned++;
  }

  // Detect heartbeat misses
  const heartbeatJobs = await db.job.findMany({
    where: { status: 'RUNNING', heartbeatAt: { not: null } },
    select: { id: true, heartbeatAt: true, maxRuntimeSec: true, payload: true },
  });

  for (const job of heartbeatJobs) {
    if (!job.heartbeatAt) continue;
    const maxRuntimeMs = (job.maxRuntimeSec || 300) * 1000;
    const deadline = new Date(new Date(job.heartbeatAt).getTime() + maxRuntimeMs);
    if (now > deadline) {
      await db.job.update({
        where: { id: job.id },
        data: { status: 'RETRYING', error: 'Heartbeat lost — retrying' },
      });
      const marketId = extractMarketId(job.payload);
      if (marketId) {
        await db.tradeCandidate.updateMany({
          where: { marketId, processingLock: { not: null } },
          data: { processingLock: null, lockExpiresAt: null },
        });
      }
      cleaned++;
    }
  }

  return cleaned;
}

export async function processNextQueuedJobOnce(): Promise<ProcessedJobResult | null> {
  const now = new Date();

  const job = await db.job.findFirst({
    where: {
      status: { in: ['PENDING', 'RETRYING'] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });

  if (!job) return null;

  const maxRuntimeSec = job.maxRuntimeSec || 300;
  await db.job.update({
    where: { id: job.id },
    data: {
      status: 'RUNNING',
      startedAt: new Date(),
      heartbeatAt: new Date(),
      lockExpiresAt: new Date(Date.now() + maxRuntimeSec * 1000),
    },
  });

  try {
    const result = await processJob(job.type, job.payload);
    await db.job.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        result: JSON.stringify(result),
        completedAt: new Date(),
        lockExpiresAt: null,
      },
    });

    return {
      jobId: job.id,
      jobType: job.type,
      marketId: extractMarketId(job.payload),
      status: 'COMPLETED',
      error: null,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    const currentRetryCount = job.retryCount || 0;
    const maxRetries = job.maxRetries ?? 3;
    const isRetryable = currentRetryCount < maxRetries;

    await db.job.update({
      where: { id: job.id },
      data: {
        status: isRetryable ? 'RETRYING' : 'FAILED',
        error: errorMessage,
        retryCount: currentRetryCount + 1,
        nextRetryAt: isRetryable ? new Date(Date.now() + computeBackoffMs(currentRetryCount)) : undefined,
        completedAt: new Date(),
        lockExpiresAt: null,
      },
    });

    if (
      isRetryable &&
      [
        'TRIAGE_MARKET',
        'RESEARCH_MARKET',
        'QUICK_RESEARCH',
        'STANDARD_RESEARCH',
        'DEEP_RESEARCH',
        'JUDGE_MARKET',
        'RISK_CHECK',
      ].includes(job.type)
    ) {
      try {
        const marketId = extractMarketId(job.payload);
        if (marketId) {
          const candidate = await db.tradeCandidate.findUnique({ where: { marketId } });
          if (candidate && candidate.processingLock) {
            await db.tradeCandidate.update({
              where: { marketId },
              data: { processingLock: null, lockExpiresAt: null },
            });
          }
        }
      } catch {}
    }

    return {
      jobId: job.id,
      jobType: job.type,
      marketId: extractMarketId(job.payload),
      status: isRetryable ? 'RETRYING' : 'FAILED',
      error: errorMessage,
    };
  }
}

async function tick() {
  try {
    // Phase 1: cleanup stale locks before processing
    await cleanupStaleLocks();

    // Phase 2: process one job
    const processedJob = await processNextQueuedJobOnce();

    if (processedJob) {
      state.currentJobType = processedJob.jobType;
      state.lastActivity = new Date().toISOString();

      if (processedJob.status === 'COMPLETED') {
        state.jobsProcessed++;
      } else {
        state.errors++;
        state.error = processedJob.error;
      }

      state.currentJobType = null;
      state.lastActivity = new Date().toISOString();
      return;
    }

    // No pending jobs — run the market loop
    state.currentJobType = 'MARKET_LOOP';
    try {
      const marketLoopResult = await runMarketLoopOnce();
      state.lastMarketLoopResult = {
        scanned: marketLoopResult.scanned,
        candidatesCreated: marketLoopResult.candidatesCreated,
        candidatesSkipped: marketLoopResult.candidatesSkipped,
        jobsCreated: marketLoopResult.jobsCreated,
      };
      state.lastActivity = new Date().toISOString();
    } catch (err) {
      console.error('[Worker] Market loop error:', err);
    }
    state.currentJobType = null;
  } catch (err) {
    state.error = err instanceof Error ? err.message : 'Worker tick error';
  }
}

const RESEARCH_JOB_TYPES = new Set([
  'RESEARCH_MARKET', 'RESEARCH',
  'QUICK_RESEARCH', 'STANDARD_RESEARCH', 'DEEP_RESEARCH',
  'TRIAGE_MARKET', 'TRIAGE',
  'JUDGE_MARKET', 'JUDGE',
  'RISK_CHECK', 'RISK',
]);

async function processJob(jobType: string, payload: string | null): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = payload ? JSON.parse(payload) : {};

  switch (jobType) {
    case 'SCAN_VENUE':
    case 'SCAN':
      return await runScanner(data.venues as string[], data.categories as string[]);
    case 'SCORE_CANDIDATES':
      return { status: 'SCORED', scanRunId: data.scanRunId ?? null };
    case 'TRIAGE_MARKET':
    case 'TRIAGE':
    case 'RESEARCH_MARKET':
    case 'RESEARCH':
    case 'QUICK_RESEARCH':
    case 'STANDARD_RESEARCH':
    case 'DEEP_RESEARCH':
    case 'JUDGE_MARKET':
    case 'JUDGE':
    case 'RISK_CHECK':
    case 'RISK': {
      const marketId = String(data.marketId);
      const marketExists = await db.market.findUnique({
        where: { id: marketId },
        select: { id: true },
      });

      if (!marketExists) {
        return { status: 'MARKET_NOT_FOUND', marketId, skipped: true };
      }

      try {
        await db.tradeCandidate.upsert({
          where: { marketId },
          update: { stage: determineStage(jobType), processingLock: `${jobType}_${Date.now()}`, lockExpiresAt: new Date(Date.now() + 300_000) },
          create: { marketId, stage: determineStage(jobType), processingLock: `${jobType}_${Date.now()}`, lockExpiresAt: new Date(Date.now() + 300_000) },
        });
      } catch {}

      const result = await runPipelineForMarket(marketId);

      // Save checkpoint for research jobs so they can be resumed
      if (RESEARCH_JOB_TYPES.has(jobType)) {
        try {
          // Find the parent Job id that triggered this pipeline work
          const parentJob = await db.job.findFirst({
            where: { type: jobType, payload: { contains: `"marketId":"${marketId}"` }, status: 'RUNNING' },
            select: { id: true },
            orderBy: { startedAt: 'desc' },
          });
          if (parentJob) {
            await saveCheckpoint(parentJob.id, { marketId, stage: determineStage(jobType), pipelineResult: result });
          }
        } catch {}
      }

      return result;
    }
    case 'PAPER_EXECUTE':
    case 'EXECUTE':
      return { status: 'PAPER_EXECUTE', marketId: data.marketId };
    case 'LIVE_EXECUTE':
      return { status: 'LIVE_EXECUTE_BLOCKED', marketId: data.marketId, message: 'Live execution disabled until safety flag enabled' };
    case 'ORDER_TRACK':
      return await processOrderTracking(data.marketId as string);
    case 'RESOLUTION_CHECK':
    case 'SETTLE':
      return { status: 'SETTLE_PENDING', marketId: data.marketId };
    default:
      throw new Error(`Unknown job type: ${jobType}`);
  }
}

function determineStage(jobType: string): string {
  if (jobType.includes('TRIAGE')) return 'TRIAGED';
  if (jobType.includes('RESEARCH') || jobType === 'DEEP_RESEARCH') return 'RESEARCHING';
  if (jobType.includes('JUDGE')) return 'JUDGED';
  if (jobType.includes('RISK')) return 'DECIDED';
  return 'SCANNED';
}

async function processOrderTracking(marketId?: string): Promise<Record<string, unknown>> {
  if (!marketId) return { status: 'NO_MARKET_ID' };

  const [strategySetting, tradingConfigSetting, tradingModeSetting] = await Promise.all([
    db.settings.findUnique({ where: { key: 'strategy_settings' } }),
    db.settings.findUnique({ where: { key: 'trading_config' } }),
    db.settings.findUnique({ where: { key: 'trading_mode' } }),
  ]);

  const config = getEffectiveTradingConfig({
    strategySettings: strategySetting ? JSON.parse(strategySetting.value) : null,
    tradingConfig: tradingConfigSetting ? JSON.parse(tradingConfigSetting.value) : null,
    tradingMode: tradingModeSetting?.value ?? null,
  });

  const orders = await db.order.findMany({
    where: {
      marketId,
      lifecycleStatus: { in: ['PLANNED', 'SUBMITTED', 'PARTIALLY_FILLED'] },
    },
  });
  const latestOrderbook = await db.orderbookSnapshot.findFirst({
    where: { marketId },
    orderBy: { capturedAt: 'desc' },
  });
  const marketSnapshot = await db.marketSnapshot.findFirst({
    where: { marketId },
    orderBy: { capturedAt: 'desc' },
  });

  let tracked = 0;
  for (const order of orders) {
    if (order.orderExpiryAt && order.orderExpiryAt < new Date()) {
      await db.order.update({
        where: { id: order.id },
        data: {
          lifecycleStatus: 'EXPIRED',
          status: 'EXPIRED',
          expiredAt: new Date(),
          lastFillAttemptAt: new Date(),
          fillAttemptCount: { increment: 1 },
        },
      });
      tracked++;
      continue;
    }

    const terminalState = classifyOrderTerminalState({
      lifecycleStatus: order.lifecycleStatus as any,
      remainingSize: order.remainingSize,
    });

    if (terminalState) {
      await db.order.update({
        where: { id: order.id },
        data: {
          lifecycleStatus: terminalState as any,
          ...(terminalState === 'FILLED' ? { filledAt: new Date(), filledSize: order.size, remainingSize: 0 } : {}),
          ...(terminalState === 'EXPIRED' ? { expiredAt: new Date() } : {}),
          ...(terminalState === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
        },
      });
      tracked++;
      continue;
    }

    await processPaperOrderFill({
      orderId: order.id,
      marketId,
      fillModel: (order.fillModel as any) ?? config.paperFillModel,
      liquidity: marketSnapshot?.liquidity ?? 0,
      fillProbability: latestOrderbook?.fillProbability ?? marketSnapshot?.fillProbability ?? null,
      priceImpact: latestOrderbook?.priceImpact ?? marketSnapshot?.priceImpact ?? null,
      bidDepth: latestOrderbook?.bidDepth ?? marketSnapshot?.bidDepth ?? null,
      askDepth: latestOrderbook?.askDepth ?? marketSnapshot?.askDepth ?? null,
      spread: latestOrderbook?.spread ?? marketSnapshot?.spread ?? null,
    });
    tracked++;
  }

  return { status: 'ORDER_TRACK_COMPLETED', marketId, ordersTracked: tracked };
}
