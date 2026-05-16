import { db } from '@/lib/db';
import { runScanner } from '@/lib/engine/scanner';
import { runMarketLoopOnce } from '@/lib/engine/market-loop';
import { runPipelineForMarket } from '@/lib/engine/pipeline';
import { normalizeTradingMode } from '@/lib/engine/mode';
import { getEffectiveTradingConfig } from '@/lib/engine/trading-settings';
import { classifyOrderTerminalState } from '@/lib/engine/order-tracker';

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

export function startWorker(intervalMs: number = 5000): WorkerState {
  if (state.status === 'RUNNING') return state;
  state.status = 'RUNNING';
  state.error = null;
  loopIntervalMs = intervalMs;
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

export async function processNextQueuedJobOnce(): Promise<ProcessedJobResult | null> {
  const job = await db.job.findFirst({
    where: { status: { in: ['PENDING', 'RETRYING'] } },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  });

  if (!job) return null;

  await db.job.update({
    where: { id: job.id },
    data: { status: 'RUNNING', startedAt: new Date() },
  });

  try {
    const result = await processJob(job.type, job.payload);
    await db.job.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        result: JSON.stringify(result),
        completedAt: new Date(),
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
    const isRetryable = currentRetryCount < (job.maxRetries || 3);

    await db.job.update({
      where: { id: job.id },
      data: {
        status: isRetryable ? 'RETRYING' : 'FAILED',
        error: errorMessage,
        retryCount: currentRetryCount + 1,
        completedAt: new Date(),
      },
    });

    if (isRetryable && ['TRIAGE_MARKET', 'RESEARCH_MARKET', 'JUDGE_MARKET', 'RISK_CHECK'].includes(job.type)) {
      try {
        const marketId = extractMarketId(job.payload);
        if (marketId) {
          const candidate = await db.tradeCandidate.findUnique({ where: { marketId } });
          if (candidate && candidate.processingLock) {
            await db.tradeCandidate.update({
              where: { marketId },
              data: {
                processingLock: null,
                lockExpiresAt: null,
              },
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

    // No pending jobs — run the market loop to scan and create new jobs
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
    case 'JUDGE_MARKET':
    case 'JUDGE':
    case 'RISK_CHECK':
    case 'RISK':
      // Update candidate stage
      const marketId = String(data.marketId);
      const marketExists = await db.market.findUnique({
        where: { id: marketId },
        select: { id: true },
      });

      if (!marketExists) {
        return {
          status: 'MARKET_NOT_FOUND',
          marketId,
          skipped: true,
        };
      }

      try {
        await db.tradeCandidate.upsert({
          where: { marketId },
          update: { stage: determineStage(jobType), processingLock: `${jobType}_${Date.now()}`, lockExpiresAt: new Date(Date.now() + 300000) },
          create: { marketId, stage: determineStage(jobType), processingLock: `${jobType}_${Date.now()}`, lockExpiresAt: new Date(Date.now() + 300000) },
        });
      } catch {}
      return await runPipelineForMarket(marketId);
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
  if (jobType.includes('RESEARCH')) return 'RESEARCHING';
  if (jobType.includes('JUDGE')) return 'JUDGED';
  if (jobType.includes('RISK')) return 'DECIDED';
  return 'SCANNED';
}

async function processOrderTracking(marketId?: string): Promise<Record<string, unknown>> {
  if (!marketId) return { status: 'NO_MARKET_ID' };

  const orders = await db.order.findMany({
    where: {
      marketId,
      lifecycleStatus: { in: ['PLANNED', 'SUBMITTED', 'PARTIALLY_FILLED'] },
    },
  });

  let tracked = 0;
  for (const order of orders) {
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
    }
  }

  return { status: 'ORDER_TRACK_COMPLETED', marketId, ordersTracked: tracked };
}
