import { db } from '@/lib/db';
import { runScanner } from '@/lib/engine/scanner';
import { runMarketLoopOnce } from '@/lib/engine/market-loop';
import {
  runTriageStage,
  runResearchStage,
  runJudgeStage,
  runRiskStage,
  runExecuteStage,
} from '@/lib/engine/pipeline';
import { isAnalysisDegradedReason } from '@/lib/engine/agents/triage';
import { reconcileMarketResolution, runResolutionCycle } from '@/lib/engine/resolution-poller';
import { getEffectiveTradingConfig } from '@/lib/engine/trading-settings';
import { classifyOrderTerminalState, processPaperOrderFill } from '@/lib/engine/order-tracker';
import type { ResearchDepth } from '@/lib/types';
import { analyzeOracleRisk, type OracleRiskResult } from '@/lib/engine/oracle-mismatch';
import {
  saveCheckpoint,
  saveFailureCheckpoint,
  deleteCheckpoint,
  loadDeepResearchProgress,
  logStageTransition,
} from '@/lib/engine/worker-checkpoint';
import { appendEvent as appendLedgerEvent } from '@/lib/engine/event-ledger';

type WorkerStatus = 'STOPPED' | 'RUNNING';

interface WorkerState {
  status: WorkerStatus;
  jobsProcessed: number;
  errors: number;
  lastActivity: string | null;
  currentJobType: string | null;
  currentJobId: string | null;
  currentMarketId: string | null;
  error: string | null;
  lastMarketLoopResult: {
    scanned: number;
    candidatesCreated: number;
    candidatesSkipped: number;
    jobsCreated: number;
  } | null;
}

interface WorkerStatusSnapshot extends WorkerState {
  databaseRunningJob: {
    id: string;
    type: string;
    marketId: string | null;
    heartbeatAt: Date | null;
    lockExpiresAt: Date | null;
  } | null;
}

const state: WorkerState = {
  status: 'STOPPED',
  jobsProcessed: 0,
  errors: 0,
  lastActivity: null,
  currentJobType: null,
  currentJobId: null,
  currentMarketId: null,
  error: null,
  lastMarketLoopResult: null,
};

let intervalHandle: ReturnType<typeof setTimeout> | null = null;
let loopIntervalMs: number = 5000;
let tickInFlight = false;

export function getWorkerState(): WorkerState {
  return { ...state };
}

export async function getWorkerStatusSnapshot(): Promise<WorkerStatusSnapshot> {
  const runningJob = await db.job.findFirst({
    where: { status: 'RUNNING' },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      type: true,
      payload: true,
      heartbeatAt: true,
      lockExpiresAt: true,
    },
  });

  if (!runningJob) {
    return { ...state, databaseRunningJob: null };
  }

  const marketId = extractMarketId(runningJob.payload);
  const heartbeatMs = runningJob.heartbeatAt ? new Date(runningJob.heartbeatAt).getTime() : 0;
  const lockExpiryMs = runningJob.lockExpiresAt ? new Date(runningJob.lockExpiresAt).getTime() : 0;
  const freshDatabaseJob = lockExpiryMs > Date.now() || (heartbeatMs > 0 && Date.now() - heartbeatMs < 120_000);

  return {
    ...state,
    status: freshDatabaseJob ? 'RUNNING' : state.status,
    currentJobType: freshDatabaseJob ? runningJob.type : state.currentJobType ?? runningJob.type,
    currentJobId: freshDatabaseJob ? runningJob.id : state.currentJobId ?? runningJob.id,
    currentMarketId: freshDatabaseJob ? marketId : state.currentMarketId ?? marketId,
    lastActivity: freshDatabaseJob && runningJob.heartbeatAt
      ? new Date(runningJob.heartbeatAt).toISOString()
      : state.lastActivity ?? (runningJob.heartbeatAt ? new Date(runningJob.heartbeatAt).toISOString() : null),
    databaseRunningJob: {
      id: runningJob.id,
      type: runningJob.type,
      marketId,
      heartbeatAt: runningJob.heartbeatAt,
      lockExpiresAt: runningJob.lockExpiresAt,
    },
  };
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
  state.currentJobId = null;
  state.currentMarketId = null;
  tickInFlight = false;
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

export interface WorkerFlowResult {
  marketLoop: WorkerState['lastMarketLoopResult'];
  processedJobs: ProcessedJobResult[];
  jobsProcessed: number;
  completed: boolean;
}

export interface WorkerFlowOptions {
  maxJobs?: number;
  runMarketLoop?: boolean;
  failOnNoWork?: boolean;
  failOnJobError?: boolean;
}

function shouldQuarantineExecution(params: {
  liveMode: boolean;
  oracleRiskLevel?: string | null;
  manualReviewStatus?: string | null;
  modelDisagreement?: number | null;
  rollingBrier?: number | null;
}): boolean {
  const oracleRisk = (params.oracleRiskLevel ?? '').toUpperCase();
  if (oracleRisk === 'BLOCK') return true;

  const manualReviewRequired =
    params.manualReviewStatus === 'PENDING' ||
    params.manualReviewStatus === 'REQUIRED';
  if (manualReviewRequired && params.liveMode) return true;

  if ((params.modelDisagreement ?? 0) > 0.3 && params.liveMode) return true;

  if ((params.rollingBrier ?? 0) > 0.3) return true;

  return false;
}

async function appendWorkerLedgerEvent(params: {
  correlationId: string;
  eventType: string;
  stage?: string;
  payload: Record<string, unknown>;
}) {
  await appendLedgerEvent({
    correlationId: params.correlationId,
    eventType: params.eventType,
    stage: params.stage,
    actor: 'worker',
    payload: params.payload,
  }).catch(() => {});
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

async function getResearchBlockReason(marketId: string): Promise<string | null> {
  const [candidate, strategySetting, tradingConfigSetting, tradingModeSetting] = await Promise.all([
    db.tradeCandidate.findUnique({
      where: { marketId },
      select: {
        id: true,
        candidateScore: true,
        skipReason: true,
        rejectedCriteria: true,
      },
    }),
    db.settings.findUnique({ where: { key: 'strategy_settings' } }),
    db.settings.findUnique({ where: { key: 'trading_config' } }),
    db.settings.findUnique({ where: { key: 'trading_mode' } }),
  ]);

  if (!candidate) return null;

  const config = getEffectiveTradingConfig({
    strategySettings: strategySetting ? JSON.parse(strategySetting.value) : null,
    tradingConfig: tradingConfigSetting ? JSON.parse(tradingConfigSetting.value) : null,
    tradingMode: tradingModeSetting?.value ?? null,
  });
  const candidateThreshold = config.candidateThreshold ?? 75;
  const researchThreshold = Math.max(candidateThreshold, 25);
  const candidateScore = typeof candidate.candidateScore === 'number' ? candidate.candidateScore : 0;
  const thresholdBlocked =
    candidateScore < researchThreshold
    || candidate.skipReason?.startsWith('BELOW_CANDIDATE_THRESHOLD')
    || candidate.rejectedCriteria?.includes('BELOW_CANDIDATE_THRESHOLD');

  if (!thresholdBlocked) return null;

  return `DETERMINISTIC_RESEARCH_BLOCK: candidate score ${candidateScore.toFixed(2)} below research threshold ${researchThreshold}`;
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
      data: {
        status: 'RETRYING',
        error: 'Stale lock released at startup — retrying',
        nextRetryAt: now,
        lockExpiresAt: null,
      },
    });
    const marketId = extractMarketId(job.payload);
    if (marketId) {
      const candidate = await db.tradeCandidate.findUnique({ where: { marketId }, select: { stage: true } });
      await db.tradeCandidate.updateMany({
        where: { marketId, processingLock: { not: null } },
        data: { processingLock: null, lockExpiresAt: null },
      });
      await logStageTransition(marketId, {
        from: candidate?.stage ?? 'UNKNOWN',
        to: 'SCANNED',
        timestamp: new Date().toISOString(),
        reason: 'Stale lock released at startup',
        jobId: job.id,
      }).catch(() => {});
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
        data: {
          status: 'RETRYING',
          error: 'Heartbeat lost — stale job recovered at startup; retrying',
          nextRetryAt: now,
          lockExpiresAt: null,
        },
      });
      const marketId = extractMarketId(job.payload);
      if (marketId) {
        const candidate = await db.tradeCandidate.findUnique({ where: { marketId }, select: { stage: true } });
        await db.tradeCandidate.updateMany({
          where: { marketId, processingLock: { not: null } },
          data: { processingLock: null, lockExpiresAt: null },
        });
        await logStageTransition(marketId, {
          from: candidate?.stage ?? 'UNKNOWN',
          to: 'SCANNED',
          timestamp: new Date().toISOString(),
          reason: 'Heartbeat lost — stale job recovered at startup',
          jobId: job.id,
        }).catch(() => {});
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
      const candidate = await db.tradeCandidate.findUnique({ where: { marketId }, select: { stage: true } });
      await db.tradeCandidate.updateMany({
        where: { marketId, processingLock: { not: null } },
        data: { processingLock: null, lockExpiresAt: null },
      });
      await logStageTransition(marketId, {
        from: candidate?.stage ?? 'UNKNOWN',
        to: 'SCANNED',
        timestamp: new Date().toISOString(),
        reason: 'Lock timeout — recovering stale stage',
        jobId: job.id,
      }).catch(() => {});
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
        const candidate = await db.tradeCandidate.findUnique({ where: { marketId }, select: { stage: true } });
        await db.tradeCandidate.updateMany({
          where: { marketId, processingLock: { not: null } },
          data: { processingLock: null, lockExpiresAt: null },
        });
        await logStageTransition(marketId, {
          from: candidate?.stage ?? 'UNKNOWN',
          to: 'SCANNED',
          timestamp: new Date().toISOString(),
          reason: 'Heartbeat lost — recovering stale stage',
          jobId: job.id,
        }).catch(() => {});
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

  const marketId = extractMarketId(job.payload);
  const correlationId = `${job.id}:${marketId ?? 'none'}`;
  await appendWorkerLedgerEvent({
    correlationId,
    eventType: 'JOB_STARTED',
    stage: job.type,
    payload: { jobId: job.id, jobType: job.type, marketId },
  });
  state.currentJobType = job.type;
  state.currentJobId = job.id;
  state.currentMarketId = marketId;
  state.lastActivity = new Date().toISOString();

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

  const heartbeatIntervalMs = Math.max(10_000, Math.min(60_000, Math.floor((maxRuntimeSec * 1000) / 3)));
  const heartbeatTimer = setInterval(() => {
    db.job.updateMany({
      where: { id: job.id, status: 'RUNNING' },
      data: {
        heartbeatAt: new Date(),
        lockExpiresAt: new Date(Date.now() + maxRuntimeSec * 1000),
      },
    }).catch((err) => {
      console.error(`[Worker] Failed to refresh heartbeat for job ${job.id}:`, err);
    });
    if (state.currentJobId === job.id) {
      state.lastActivity = new Date().toISOString();
    }
  }, heartbeatIntervalMs);

  try {
    const result = await processJob(job.type, job.payload, job.id);
    clearInterval(heartbeatTimer);
    await db.job.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        result: JSON.stringify(result),
        completedAt: new Date(),
        lockExpiresAt: null,
      },
    });

    await appendWorkerLedgerEvent({
      correlationId,
      eventType: 'JOB_COMPLETED',
      stage: job.type,
      payload: { jobId: job.id, jobType: job.type, marketId, status: 'COMPLETED' },
    });

    await deleteCheckpoint(job.id).catch(() => {});

    return {
      jobId: job.id,
      jobType: job.type,
      marketId,
      status: 'COMPLETED',
      error: null,
    };
  } catch (err) {
    clearInterval(heartbeatTimer);
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

    const failedMarketId = marketId;
    await appendWorkerLedgerEvent({
      correlationId,
      eventType: isRetryable ? 'JOB_RETRYING' : 'JOB_FAILED',
      stage: job.type,
      payload: {
        jobId: job.id,
        jobType: job.type,
        marketId: failedMarketId,
        error: errorMessage,
        retryCount: currentRetryCount + 1,
      },
    });

    // Save failure checkpoint for post-mortem / retry analysis
    const failureMarketId = extractMarketId(job.payload);

    if (['RESEARCH_MARKET', 'QUICK_RESEARCH', 'STANDARD_RESEARCH', 'DEEP_RESEARCH'].includes(job.type) && failureMarketId) {
      const runningResearchRuns = await db.researchRun.findMany({
        where: { marketId: failureMarketId, status: 'RUNNING' },
        orderBy: { createdAt: 'desc' },
        take: 3,
      }).catch(() => []);

      for (const researchRun of runningResearchRuns) {
        await db.agentOutput.create({
          data: {
            researchRunId: researchRun.id,
            role: 'RESEARCH_JOB_FAILED',
            stage: 'SYNTHESIS',
            serviceName: 'worker',
            provider: 'system',
            output: JSON.stringify({ error: errorMessage, jobId: job.id, jobType: job.type }),
            rawOutput: errorMessage,
            summary: `Research job failed before usable sources were captured: ${errorMessage}`,
            failureReason: errorMessage,
          },
        }).catch((error) => console.error('[Worker] Failed to write research failure AgentOutput:', error));
        await db.researchRun.update({
          where: { id: researchRun.id },
          data: { status: 'FAILED', completedAt: new Date() },
        }).catch((error) => console.error('[Worker] Failed to mark research run failed:', error));
      }
    }

    await saveFailureCheckpoint(job.id, errorMessage, job.type, {
      marketId: marketId ?? undefined,
      retryCount: currentRetryCount + 1,
      isRetryable,
    }).catch(() => {});

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
        'ORACLE_CHECK',
        'PAPER_EXECUTE',
        'ORDER_TRACK',
      ].includes(job.type)
    ) {
      try {
        if (marketId) {
          const candidate = await db.tradeCandidate.findUnique({ where: { marketId } });
          if (candidate && candidate.processingLock) {
            const previousStage = candidate.stage;
            await db.tradeCandidate.update({
              where: { marketId },
              data: { processingLock: null, lockExpiresAt: null },
            });
            await logStageTransition(marketId, {
              from: previousStage,
              to: 'SCANNED',
              timestamp: new Date().toISOString(),
              reason: `Job failed: ${errorMessage.slice(0, 200)}`,
              jobId: job.id,
            }).catch(() => {});
          }
        }
      } catch (cleanupErr) {
        console.error('[Worker] Failed to release candidate lock after job failure:', cleanupErr);
      }
    }

    return {
      jobId: job.id,
      jobType: job.type,
      marketId,
      status: isRetryable ? 'RETRYING' : 'FAILED',
      error: errorMessage,
    };
  } finally {
    if (state.currentJobId === job.id) {
      state.currentJobType = null;
      state.currentJobId = null;
      state.currentMarketId = null;
      state.lastActivity = new Date().toISOString();
    }
  }
}

export async function runWorkerFlowUntilIdle(options: WorkerFlowOptions = {}): Promise<WorkerFlowResult> {
  const maxJobs = Math.max(1, Number(options.maxJobs ?? 50));
  const shouldRunMarketLoop = options.runMarketLoop ?? true;
  const processedJobs: ProcessedJobResult[] = [];
  let marketLoop: WorkerState['lastMarketLoopResult'] = null;

  await releaseAllStaleLocks();

  if (shouldRunMarketLoop) {
    const loopResult = await runMarketLoopOnce();
    marketLoop = {
      scanned: loopResult.scanned,
      candidatesCreated: loopResult.candidatesCreated,
      candidatesSkipped: loopResult.candidatesSkipped,
      jobsCreated: loopResult.jobsCreated,
    };
    state.lastMarketLoopResult = marketLoop;
    state.lastActivity = new Date().toISOString();

    if (options.failOnNoWork && loopResult.jobsCreated === 0) {
      throw new Error(
        `Market loop completed with no queued jobs: scanned=${loopResult.scanned}, candidatesCreated=${loopResult.candidatesCreated}, candidatesSkipped=${loopResult.candidatesSkipped}`,
      );
    }
  }

  for (let i = 0; i < maxJobs; i++) {
    const processedJob = await processNextQueuedJobOnce();
    if (!processedJob) {
      return {
        marketLoop,
        processedJobs,
        jobsProcessed: processedJobs.length,
        completed: true,
      };
    }

    processedJobs.push(processedJob);
    state.lastActivity = new Date().toISOString();

    if (processedJob.status !== 'COMPLETED') {
      state.errors++;
      state.error = processedJob.error;
      if (options.failOnJobError !== false) {
        throw new Error(
          `Job ${processedJob.jobId} (${processedJob.jobType}) ${processedJob.status}: ${processedJob.error ?? 'unknown error'}`,
        );
      }
      return {
        marketLoop,
        processedJobs,
        jobsProcessed: processedJobs.length,
        completed: false,
      };
    }

    state.jobsProcessed++;
  }

  return {
    marketLoop,
    processedJobs,
    jobsProcessed: processedJobs.length,
    completed: false,
  };
}

async function tick() {
  if (state.status !== 'RUNNING' || tickInFlight) return;
  tickInFlight = true;
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
  } finally {
    tickInFlight = false;
  }
}

// ── Inter-stage data lookups ─────────────────────────────────────────
// Each stage persists output to DB; subsequent stages look up what they need.

async function lookupResearchRunForMarket(marketId: string, researchRunId?: string): Promise<{
  researchRunId: string;
  researchContext: string;
  depth: ResearchDepth;
} | null> {
  const where: any = { marketId, status: 'COMPLETED' };
  if (researchRunId) where.id = researchRunId;
  const researchRun = await db.researchRun.findFirst({
    where,
    orderBy: { completedAt: 'desc' },
  });
  const completedRun = researchRun ?? (researchRunId
    ? await db.researchRun.findFirst({
        where: { marketId, status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
      })
    : null);
  if (!completedRun) return null;

  // Gather research context from sources + agent outputs
  const [sources, agentOutputs] = await Promise.all([
    db.researchSource.findMany({
      where: { researchRunId: completedRun.id },
      orderBy: { extractedAt: 'asc' },
    }),
    db.agentOutput.findMany({
      where: { researchRunId: completedRun.id },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const parts: string[] = [];
  for (const s of sources) {
    if (s.content) parts.push(`Source: ${s.url}\n${s.title ? `Title: ${s.title}\n` : ''}${s.content.slice(0, 2000)}`);
  }
  for (const o of agentOutputs) {
    if (o.summary) parts.push(`[${o.role}] ${o.summary}`);
    else if (o.rawOutput) parts.push(`[${o.role}] ${o.rawOutput.slice(0, 2000)}`);
  }
  const researchContext = parts.join('\n\n');

  return {
    researchRunId: completedRun.id,
    researchContext,
    depth: (completedRun.depth as ResearchDepth) || 'STANDARD',
  };
}

async function requeueResearchForMarket(marketId: string, candidateId?: string): Promise<{ created: boolean; jobId?: string }> {
  const existing = await db.job.findFirst({
    where: {
      type: { in: ['STANDARD_RESEARCH', 'RESEARCH_MARKET', 'RESEARCH'] },
      status: { in: ['PENDING', 'RUNNING', 'RETRYING'] },
      payload: { contains: marketId },
    },
  });
  if (existing) return { created: false, jobId: existing.id };

  const job = await db.job.create({
    data: {
      type: 'STANDARD_RESEARCH',
      status: 'PENDING',
      priority: 8,
      payload: JSON.stringify({
        marketId,
        ...(candidateId ? { candidateId } : {}),
        trigger: 'judge_missing_completed_research',
      }),
    },
  });
  return { created: true, jobId: job.id };
}

async function lookupJudgeParams(marketId: string): Promise<{
  judgeProbability: number;
  judgeConfidence: number;
  judgeUncertainty: number;
  ensembleUncertaintyBoost: number;
  modelDisagreement: number;
  disagreementLevel: 'LOW' | 'MODERATE' | 'HIGH';
} | null> {
  // Check the latest Decision for judge params (written by runRiskStage)
  const decision = await db.decision.findFirst({
    where: { marketId },
    orderBy: { createdAt: 'desc' },
  });
  if (decision && decision.judgeProbability != null) {
    return {
      judgeProbability: decision.judgeProbability,
      judgeConfidence: decision.confidence ?? 0.5,
      judgeUncertainty: decision.uncertainty ?? 0.3,
      ensembleUncertaintyBoost: 0,
      modelDisagreement: 0,
      disagreementLevel: 'LOW' as const,
    };
  }

  // Fallback: look up agent_outputs for JUDGE/MIROFISH_PREDICT roles
  const agentOutputs = await db.agentOutput.findMany({
    where: {
      researchRun: { marketId, status: 'COMPLETED' },
      role: { in: ['JUDGE', 'MIROFISH_PREDICT', 'ENSEMBLE'] },
    },
    orderBy: { createdAt: 'desc' },
  });

  for (const output of agentOutputs) {
    try {
      const parsed = JSON.parse(output.output || '{}') as Record<string, unknown>;
      if (parsed.finalProbability != null || parsed.judgeProbability != null) {
        return {
          judgeProbability: (parsed.finalProbability as number) ?? (parsed.judgeProbability as number) ?? 0.5,
          judgeConfidence: (parsed.finalConfidence as number) ?? (parsed.judgeConfidence as number) ?? 0.5,
          judgeUncertainty: (parsed.finalUncertainty as number) ?? (parsed.judgeUncertainty as number) ?? 0.3,
          ensembleUncertaintyBoost: (parsed.ensembleUncertaintyBoost as number) ?? 0,
          modelDisagreement: (parsed.modelDisagreement as number) ?? 0,
          disagreementLevel: (parsed.disagreementLevel as 'LOW' | 'MODERATE' | 'HIGH') ?? 'LOW',
        };
      }
    } catch { /* skip unparseable */ }
  }

  return null;
}

async function lookupDecisionForMarket(marketId: string): Promise<{
  decisionId: string;
  judgeProbability: number;
  judgeConfidence: number;
  judgeUncertainty: number;
  action: string;
  side: string;
  maxSize: number;
  urgency: string;
  edge: number;
} | null> {
  const decision = await db.decision.findFirst({
    where: { marketId },
    orderBy: { createdAt: 'desc' },
  });
  if (!decision) return null;

  return {
    decisionId: decision.id,
    judgeProbability: decision.judgeProbability ?? 0.5,
    judgeConfidence: decision.confidence ?? 0.5,
    judgeUncertainty: decision.uncertainty ?? 0.3,
    action: decision.action ?? 'BID',
    side: decision.side ?? 'YES',
    maxSize: decision.maxSize ?? 0,
    urgency: decision.urgency ?? 'MEDIUM',
    edge: decision.edge ?? 0,
  };
}

function validateMarket(marketId: string): Promise<boolean> {
  return db.market
    .findUnique({ where: { id: marketId }, select: { id: true } })
    .then((m) => !!m);
}

function resolveDepthFromType(jobType: string): ResearchDepth {
  if (jobType.includes('QUICK')) return 'QUICK';
  if (jobType.includes('DEEP')) return 'FULL';
  return 'STANDARD';
}

async function resolveEffectiveResearchDepth(jobType: string, fallbackDepth: ResearchDepth): Promise<ResearchDepth> {
  if (jobType.includes('QUICK')) return 'QUICK';
  if (jobType.includes('DEEP')) return 'FULL';

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
  return config.stageRouting?.researchDepth ?? fallbackDepth;
}

function resolveJudgeParamsFromPayload(data: Record<string, unknown>): {
  judgeProbability: number;
  judgeConfidence: number;
  judgeUncertainty: number;
  ensembleUncertaintyBoost: number;
  modelDisagreement: number;
  disagreementLevel: 'LOW' | 'MODERATE' | 'HIGH';
} | null {
  if (
    typeof data.judgeProbability !== 'number' ||
    typeof data.judgeConfidence !== 'number' ||
    typeof data.judgeUncertainty !== 'number'
  ) {
    return null;
  }

  const disagreementLevel =
    data.disagreementLevel === 'MODERATE' || data.disagreementLevel === 'HIGH' || data.disagreementLevel === 'LOW'
      ? data.disagreementLevel
      : 'LOW';

  return {
    judgeProbability: data.judgeProbability,
    judgeConfidence: data.judgeConfidence,
    judgeUncertainty: data.judgeUncertainty,
    ensembleUncertaintyBoost: typeof data.ensembleUncertaintyBoost === 'number' ? data.ensembleUncertaintyBoost : 0,
    modelDisagreement: typeof data.modelDisagreement === 'number' ? data.modelDisagreement : 0,
    disagreementLevel,
  };
}

// ── processJob ───────────────────────────────────────────────────────

async function processJob(jobType: string, payload: string | null, jobId?: string): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = (payload && payload.trim()) ? JSON.parse(payload) : {};

  switch (jobType) {
    case 'SCAN_VENUE':
    case 'SCAN': {
      const scanResult = await runScanner(data.venues as string[], data.categories as string[]);
      const loopResult = await runMarketLoopOnce();
      return { ...loopResult, scanResult };
    }

    case 'SCORE_CANDIDATES':
      return { status: 'SCORED', scanRunId: data.scanRunId ?? null };

    case 'TRIAGE_MARKET':
    case 'TRIAGE': {
      const marketId = String(data.marketId);
      if (!(await validateMarket(marketId))) {
        throw new Error(`Market not found: ${marketId}`);
      }
      const result = await runTriageStage(marketId) as unknown as Record<string, unknown>;
      if (jobId) {
        await logStageTransition(marketId, {
          from: 'SCANNED',
          to: 'TRIAGED',
          timestamp: new Date().toISOString(),
          jobId,
        }).catch(() => {});
      }
      // Chain: triage complete with worthResearch → enqueue STANDARD_RESEARCH
      const triageReason = typeof (result as { triageResult?: { reason?: unknown } }).triageResult?.reason === 'string'
        ? String((result as { triageResult?: { reason?: unknown } }).triageResult?.reason)
        : '';
      const analysisDegraded = String((result as { triageStatus?: unknown }).triageStatus ?? '') === 'ANALYSIS_DEGRADED'
        || isAnalysisDegradedReason(triageReason);
      if (result.worthResearch === true && !analysisDegraded) {
        const existingResearchJob = await db.job.findFirst({
          where: { type: { in: ['STANDARD_RESEARCH', 'RESEARCH_MARKET', 'RESEARCH'] }, status: { in: ['PENDING', 'RUNNING', 'RETRYING'] }, payload: { contains: marketId } },
        });
        if (!existingResearchJob) {
          await db.job.create({
            data: { type: 'STANDARD_RESEARCH', status: 'PENDING', priority: 8, payload: JSON.stringify({ marketId, candidateId: data.candidateId, trigger: 'triage_chain', triageStatus: result.triageStatus }) },
          });
        }
      }
      return result;
    }

    case 'RESEARCH_MARKET':
    case 'RESEARCH':
    case 'QUICK_RESEARCH':
    case 'STANDARD_RESEARCH':
    case 'DEEP_RESEARCH': {
      const marketId = String(data.marketId);
      if (!(await validateMarket(marketId))) {
        throw new Error(`Market not found: ${marketId}`);
      }
      const depth = await resolveEffectiveResearchDepth(jobType, resolveDepthFromType(jobType));
      const researchBlockReason = await getResearchBlockReason(marketId);
      if (researchBlockReason) {
        await db.tradeCandidate.updateMany({
          where: { marketId },
          data: {
            stage: 'WATCHING',
            researchQueued: false,
            processingLock: null,
            lockExpiresAt: null,
            lastError: null,
            skipReason: researchBlockReason,
          },
        });
        return {
          skipped: true,
          marketId,
          depth,
          reason: researchBlockReason,
        };
      }

      let result: Record<string, unknown>;

      if (jobId && depth === 'DEEP') {
        const drProgress = await loadDeepResearchProgress(jobId).catch(() => null);
        const resumePayload = drProgress ? { ...drProgress, jobId } : { jobId };
        result = await runResearchStage(marketId, depth, undefined, resumePayload) as unknown as Record<string, unknown>;
        if (jobId) {
          await logStageTransition(marketId, {
            from: 'TRIAGED',
            to: 'RESEARCHING',
            timestamp: new Date().toISOString(),
            jobId,
          }).catch(() => {});
        }
      } else {
        if (jobId) {
          await logStageTransition(marketId, {
            from: 'TRIAGED',
            to: 'RESEARCHING',
            timestamp: new Date().toISOString(),
            jobId,
          }).catch(() => {});
        }
        result = await runResearchStage(marketId, depth) as unknown as Record<string, unknown>;
      }

      // Chain: research complete → enqueue JUDGE
      if (!result.skipped && result.researchRunId) {
        await db.job.create({
          data: {
            type: 'JUDGE_MARKET',
            status: 'PENDING',
            priority: 8,
            payload: JSON.stringify({ marketId, researchRunId: result.researchRunId }),
          },
        });
      }
      return result;
    }

    case 'JUDGE_MARKET':
    case 'JUDGE': {
      const marketId = String(data.marketId);
      if (!(await validateMarket(marketId))) {
        throw new Error(`Market not found: ${marketId}`);
      }
      const researchBlockReason = await getResearchBlockReason(marketId);
      if (researchBlockReason) {
        await db.tradeCandidate.updateMany({
          where: { marketId },
          data: {
            stage: 'WATCHING',
            researchQueued: false,
            processingLock: null,
            lockExpiresAt: null,
            lastError: null,
            skipReason: researchBlockReason,
          },
        });
        return {
          skipped: true,
          marketId,
          reason: researchBlockReason,
        };
      }
      const research = await lookupResearchRunForMarket(marketId, data.researchRunId as string | undefined);
      if (!research) {
        // Check if research is still in progress — if so, retry instead of failing
        const runningResearch = await db.researchRun.findFirst({
          where: { marketId, status: { in: ['PENDING', 'RUNNING'] } },
          orderBy: { createdAt: 'desc' },
        });
        if (runningResearch) {
          throw new Error(`Research still in progress for ${marketId} (status: ${runningResearch.status}). Retrying JUDGE_MARKET.`);
        }
        const requeued = await requeueResearchForMarket(
          marketId,
          typeof data.candidateId === 'string' ? data.candidateId : undefined,
        );
        return {
          status: 'RESEARCH_REQUEUED',
          marketId,
          jobId: requeued.jobId,
          created: requeued.created,
          reason: `No completed ResearchRun found for market: ${marketId}`,
        };
      }
      const result = await runJudgeStage(marketId, research.researchRunId, research.researchContext, research.depth) as unknown as Record<string, unknown>;
      if (jobId) {
        await logStageTransition(marketId, {
          from: 'RESEARCHING',
          to: 'JUDGED',
          timestamp: new Date().toISOString(),
          jobId,
        }).catch(() => {});
      }

      // Chain: judge complete → enqueue RISK
      if (!result.skipped) {
        await db.job.create({
            data: {
              type: 'RISK_CHECK',
              status: 'PENDING',
              priority: 9,
            payload: JSON.stringify({
              marketId,
              judgeProbability: result.judgeProbability as number ?? 0.5,
              judgeConfidence: result.judgeConfidence as number ?? 0.5,
              judgeUncertainty: result.judgeUncertainty as number ?? 0.3,
              ensembleUncertaintyBoost: result.ensembleUncertaintyBoost as number ?? 0,
              modelDisagreement: result.modelDisagreement as number ?? 0,
              disagreementLevel: (result.disagreementLevel as string) ?? 'LOW',
            }),
          },
        });
      }
      return result;
    }

    case 'RISK_CHECK':
    case 'RISK': {
      const marketId = String(data.marketId);
      if (!(await validateMarket(marketId))) {
        throw new Error(`Market not found: ${marketId}`);
      }
      const judge = resolveJudgeParamsFromPayload(data) ?? await lookupJudgeParams(marketId);
      if (!judge) {
        throw new Error(`No judge/decision data found for market: ${marketId}`);
      }
      const result = await runRiskStage(
        marketId,
        judge.judgeProbability,
        judge.judgeConfidence,
        judge.judgeUncertainty,
        judge.ensembleUncertaintyBoost,
        judge.modelDisagreement,
        judge.disagreementLevel,
      ) as unknown as Record<string, unknown>;
      if (jobId) {
        await logStageTransition(marketId, {
          from: 'JUDGED',
          to: 'DECIDED',
          timestamp: new Date().toISOString(),
          jobId,
        }).catch(() => {});
      }

      // Chain: risk passed with BID → enqueue EXECUTE
      if (!result.skipped && result.riskAction === 'BID') {
        const gatedRisk = result.gatedRiskResult as Record<string, unknown> | undefined;
        const dedupKey = `PAPER_EXECUTE:${result.decisionId}`;

        // Deduplication: skip if an active job already exists for this decision
        const existingExecJob = await db.job.findFirst({
          where: {
            type: 'PAPER_EXECUTE',
            dedupKey,
            status: { in: ['PENDING', 'RUNNING', 'RETRYING', 'COMPLETED'] },
          },
        });

        if (existingExecJob) {
          console.log(`[Worker] PAPER_EXECUTE job already exists for decision ${result.decisionId}, skipping duplicate`);
        } else {
          await db.job.create({
            data: {
              type: 'PAPER_EXECUTE',
              status: 'PENDING',
              priority: 10,
              dedupKey,
              payload: JSON.stringify({
                marketId,
                decisionId: result.decisionId as string,
                judgeProbability: judge.judgeProbability,
                judgeConfidence: judge.judgeConfidence,
                judgeUncertainty: judge.judgeUncertainty,
                aPlusGatePassed: result.aPlusGatePassed as boolean ?? false,
                gatedAction: gatedRisk?.action ?? 'BID',
                gatedAdjustedSize: gatedRisk?.adjustedSize ?? 0,
                gatedMaxSize: gatedRisk?.maxSize ?? 0,
                gatedEdge: gatedRisk?.edge ?? 0,
                gatedSide: gatedRisk?.side ?? 'YES',
                gatedReasonCode: gatedRisk?.reasonCode ?? '',
                gatedReason: gatedRisk?.reason ?? '',
                gatedUrgency: gatedRisk?.urgency ?? 'MEDIUM',
                gatedFees: gatedRisk?.fees ?? 0,
                gatedSlippage: gatedRisk?.slippage ?? 0,
              }),
            },
          });
        }
      }
      return result;
    }

    case 'PAPER_EXECUTE':
    case 'EXECUTE': {
      const marketId = String(data.marketId);
      if (!(await validateMarket(marketId))) {
        throw new Error(`Market not found: ${marketId}`);
      }
      let decisionId = typeof data.decisionId === 'string' ? data.decisionId : undefined;
      let judgeProb = typeof data.judgeProbability === 'number' ? data.judgeProbability : 0.5;
      let judgeConf = typeof data.judgeConfidence === 'number' ? data.judgeConfidence : 0.5;
      let judgeUnc = typeof data.judgeUncertainty === 'number' ? data.judgeUncertainty : 0.3;
      const aPlusGatePassed = typeof data.aPlusGatePassed === 'boolean' ? data.aPlusGatePassed : false;

      const market = await db.market.findUnique({
        where: { id: marketId },
        select: {
          oracleCheck: {
            select: {
              riskLevel: true,
              manualReviewStatus: true,
            },
          },
        },
      });

      // Reconstruct gatedRiskResult from job payload (passed through RISK_CHECK chain)
      const decision = await lookupDecisionForMarket(marketId).catch(() => null);

      if (!decisionId || !data.judgeProbability) {
        if (!decision) {
          throw new Error(`No Decision found for market: ${marketId}`);
        }
        decisionId = decisionId || decision.decisionId;
        judgeProb = data.judgeProbability != null ? judgeProb : decision.judgeProbability;
        judgeConf = data.judgeConfidence != null ? judgeConf : decision.judgeConfidence;
        judgeUnc = data.judgeUncertainty != null ? judgeUnc : decision.judgeUncertainty;
      }

      const tradingModeSetting = await db.settings.findUnique({ where: { key: 'trading_mode' } }).catch(() => null);
      const liveMode = String(tradingModeSetting?.value ?? '').toUpperCase() === 'LIVE';

      const shouldQuarantine = shouldQuarantineExecution({
        liveMode,
        oracleRiskLevel: market?.oracleCheck?.riskLevel,
        manualReviewStatus: market?.oracleCheck?.manualReviewStatus,
        modelDisagreement: null,
        rollingBrier: null,
      });

      if (shouldQuarantine) {
        await db.tradeCandidate.updateMany({
          where: { marketId },
          data: {
            stage: 'WATCHING',
            processingLock: null,
            lockExpiresAt: null,
            skipReason: 'ANOMALY_QUARANTINE_TRIGGERED',
            lastError: null,
          },
        });

        if (jobId) {
          await logStageTransition(marketId, {
            from: 'DECIDED',
            to: 'WATCHING',
            timestamp: new Date().toISOString(),
            reason: 'Anomaly quarantine triggered before execute stage',
            jobId,
          }).catch(() => {});
        }

        return {
          status: 'ANOMALY_QUARANTINED',
          marketId,
          decisionId,
        };
      }

      const hasGatedData = data.gatedEdge != null || data.gatedAdjustedSize != null || data.gatedMaxSize != null;

      const gatedRiskResult = {
        action: (data.gatedAction as 'BID' | 'WATCH' | 'SKIP') || decision?.action || 'BID',
        side: (data.gatedSide as 'YES' | 'NO') || decision?.side || 'YES',
        maxSize: Number(hasGatedData ? (data.gatedMaxSize ?? 0) : (decision?.maxSize ?? 0)),
        adjustedSize: Number(hasGatedData ? (data.gatedAdjustedSize ?? data.gatedMaxSize ?? 0) : (decision?.maxSize ?? 0)),
        urgency: (data.gatedUrgency as string) || decision?.urgency || 'MEDIUM',
        reasonCode: String(data.gatedReasonCode ?? ''),
        reason: String(data.gatedReason ?? ''),
        edge: Number(hasGatedData ? (data.gatedEdge ?? 0) : (decision?.edge ?? 0)),
        fees: Number(data.gatedFees ?? 0),
        slippage: Number(data.gatedSlippage ?? 0),
      };

      const result = await runExecuteStage(marketId, decisionId!, gatedRiskResult as any, aPlusGatePassed, judgeProb, judgeConf, judgeUnc) as unknown as Record<string, unknown>;
      if (jobId) {
        await logStageTransition(marketId, {
          from: 'DECIDED',
          to: 'EXECUTED',
          timestamp: new Date().toISOString(),
          jobId,
        }).catch(() => {});
      }
      return result;
    }

    case 'LIVE_EXECUTE':
      return { status: 'LIVE_EXECUTE_BLOCKED', marketId: data.marketId, message: 'Live execution disabled until safety flag enabled' };

    case 'ORDER_TRACK':
      return await processOrderTracking(data.marketId as string);

    case 'RESOLUTION_CHECK':
    case 'SETTLE': {
      const marketId = typeof data.marketId === 'string' ? data.marketId : undefined;
      if (marketId) {
        const existingOutcome = await db.outcome.findFirst({ where: { marketId } });
        if (existingOutcome) {
          const reconciled = await reconcileMarketResolution({
            marketId,
            outcome: existingOutcome.result as 'YES' | 'NO' | 'CANCELLED',
            resolvedProb: existingOutcome.resolvedProb ?? undefined,
            source: 'WORKER_RECONCILE',
          });
          return { status: 'SETTLED', marketId, ...reconciled };
        }
      }

      const cycle = await runResolutionCycle();
      return {
        status: 'RESOLUTION_CYCLE_COMPLETED',
        marketId: marketId ?? null,
        ...cycle,
      };
    }

    case 'ORACLE_CHECK':
      return await processOracleCheck(data.marketId as string);

    default:
      throw new Error(`Unknown job type: ${jobType}`);
  }
}

async function processOracleCheck(marketId: string): Promise<Record<string, unknown>> {
  if (!marketId) return { status: 'NO_MARKET_ID' };

  const market = await db.market.findUnique({
    where: { id: marketId },
    select: {
      id: true,
      title: true,
      description: true,
      venue: true,
      oracleCheck: true,
    },
  });

  if (!market) {
    return { status: 'MARKET_NOT_FOUND', marketId };
  }

  const result: OracleRiskResult = analyzeOracleRisk({
    title: market.title,
    description: market.description ?? '',
    crossVenueMismatch: 0,
  });

  const requiresManualReview = result.riskLevel === 'HIGH' || result.riskLevel === 'BLOCK';
  const existingManualStatus = market.oracleCheck?.manualReviewStatus;
  const manualReviewStatus = requiresManualReview
    ? (existingManualStatus === 'APPROVED' || existingManualStatus === 'REJECTED'
       ? existingManualStatus
       : 'PENDING')
    : 'NOT_REQUIRED';

  let resolutionDate: Date | null = null;
  if (result.deadline) {
    const parsed = new Date(result.deadline);
    if (!isNaN(parsed.getTime())) {
      resolutionDate = parsed;
    }
  }

  const oracleCheckData = {
    oracleSource: result.oracleSource,
    resolutionCriteria: result.resolutionCriteria,
    resolutionDate,
    timezone: result.timezone,
    ambiguousWording: result.hasAmbiguousWording,
    humanDiscretion: result.hasHumanDiscretion,
    appealProcess: result.hasAppealProcess,
    crossVenueMismatch: result.crossVenueMismatch > 0,
    riskLevel: result.riskLevel,
    oracleRiskReasons: result.issues.length > 0 ? result.issues.join('; ') : null,
    manualReviewRequired: requiresManualReview,
    manualReviewStatus,
    manualReviewRequestedAt: requiresManualReview && manualReviewStatus === 'PENDING'
      ? new Date()
      : undefined,
    notes: result.issues.length > 0 ? `Oracle risk issues: ${result.issues.join(', ')}` : null,
  };

  await db.oracleCheck.upsert({
    where: { marketId },
    create: { marketId, ...oracleCheckData },
    update: oracleCheckData,
  });

  return {
    status: 'COMPLETED',
    marketId,
    riskLevel: result.riskLevel,
    requiresManualReview,
    manualReviewStatus,
    issuesFound: result.issues.length,
  };
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
  let hasActiveOrders = false;
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
      await db.tradeCandidate.updateMany({
        where: { marketId },
        data: { stage: 'EXECUTION_FAILED' },
      });
      tracked++;
      continue;
    }

    const terminalState = classifyOrderTerminalState({
      lifecycleStatus: order.lifecycleStatus as any,
      remainingSize: order.remainingSize,
    });

    if (terminalState) {
      const newLifecycle = terminalState as any;
      await db.order.update({
        where: { id: order.id },
        data: {
          lifecycleStatus: newLifecycle,
          ...(newLifecycle === 'FILLED' ? { filledAt: new Date(), filledSize: order.size, remainingSize: 0 } : {}),
          ...(newLifecycle === 'EXPIRED' ? { expiredAt: new Date() } : {}),
          ...(newLifecycle === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
        },
      });
      if (newLifecycle === 'EXPIRED') {
        await db.tradeCandidate.updateMany({
          where: { marketId },
          data: { stage: 'EXECUTION_FAILED' },
        });
      }
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
    hasActiveOrders = true;
  }

  if (hasActiveOrders) {
    const existingTracker = await db.job.findFirst({
      where: {
        type: 'ORDER_TRACK',
        status: { in: ['PENDING', 'RUNNING', 'RETRYING'] },
        payload: JSON.stringify({ marketId }),
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!existingTracker) {
      await db.job.create({
        data: {
          type: 'ORDER_TRACK',
          status: 'PENDING',
          priority: 10,
          payload: JSON.stringify({ marketId }),
        },
      }).catch((err) => console.error('[Worker] Failed to reschedule ORDER_TRACK:', err));
    }
  }

  return { status: 'ORDER_TRACK_COMPLETED', marketId, ordersTracked: tracked };
}
