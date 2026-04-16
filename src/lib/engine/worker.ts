import { db } from '@/lib/db';
import { runScanner } from '@/lib/engine/scanner';
import { runPipelineForMarket } from '@/lib/engine/pipeline';

type WorkerStatus = 'STOPPED' | 'RUNNING';

interface WorkerState {
  status: WorkerStatus;
  jobsProcessed: number;
  errors: number;
  lastActivity: string | null;
  currentJobType: string | null;
  error: string | null;
}

const state: WorkerState = {
  status: 'STOPPED',
  jobsProcessed: 0,
  errors: 0,
  lastActivity: null,
  currentJobType: null,
  error: null,
};

let intervalHandle: ReturnType<typeof setTimeout> | null = null;

export function getWorkerState(): WorkerState {
  return { ...state };
}

export function startWorker(intervalMs: number = 5000): WorkerState {
  if (state.status === 'RUNNING') return state;
  state.status = 'RUNNING';
  state.error = null;
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

async function tick() {
  try {
    const job = await db.job.findFirst({
      where: { status: 'PENDING' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });

    if (!job) return;

    state.currentJobType = job.type;
    state.lastActivity = new Date().toISOString();

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
      state.jobsProcessed++;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      const currentRetryCount = job.retryCount || 0;
      await db.job.update({
        where: { id: job.id },
        data: {
          status: currentRetryCount < (job.maxRetries || 3) ? 'RETRYING' : 'FAILED',
          error: errorMessage,
          retryCount: currentRetryCount + 1,
          completedAt: new Date(),
        },
      });
      state.errors++;
      state.error = errorMessage;
    }

    state.currentJobType = null;
    state.lastActivity = new Date().toISOString();
  } catch (err) {
    state.error = err instanceof Error ? err.message : 'Worker tick error';
  }
}

async function processJob(jobType: string, payload: string | null): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = payload ? JSON.parse(payload) : {};

  switch (jobType) {
    case 'SCAN':
      return await runScanner(data.venues, data.categories);
    case 'TRIAGE':
    case 'RESEARCH':
    case 'JUDGE':
    case 'RISK':
      return await runPipelineForMarket(String(data.marketId));
    case 'EXECUTE':
      return { status: 'PAPER_EXECUTE', marketId: data.marketId };
    case 'SETTLE':
      return { status: 'SETTLE_PENDING', marketId: data.marketId };
    default:
      throw new Error(`Unknown job type: ${jobType}`);
  }
}