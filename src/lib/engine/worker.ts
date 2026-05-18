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
        data: { status: 'FAILED', error: 'Heartbeat lost — stale job recovered at startup' },
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
    const result = await processJob(job.type, job.payload, job.id);
    await db.job.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        result: JSON.stringify(result),
        completedAt: new Date(),
        lockExpiresAt: null,
      },
    });

    await deleteCheckpoint(job.id).catch(() => {});

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

    // Save failure checkpoint for post-mortem / retry analysis
    const marketId = extractMarketId(job.payload);
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

// ── Inter-stage data lookups ─────────────────────────────────────────
// Each stage persists output to DB; subsequent stages look up what they need.

async function lookupResearchRunForMarket(marketId: string): Promise<{
  researchRunId: string;
  researchContext: string;
  depth: ResearchDepth;
} | null> {
  const researchRun = await db.researchRun.findFirst({
    where: { marketId, status: 'COMPLETED' },
    orderBy: { completedAt: 'desc' },
  });
  if (!researchRun) return null;

  // Gather research context from sources + agent outputs
  const [sources, agentOutputs] = await Promise.all([
    db.researchSource.findMany({
      where: { researchRunId: researchRun.id },
      orderBy: { extractedAt: 'asc' },
    }),
    db.agentOutput.findMany({
      where: { researchRunId: researchRun.id },
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
    researchRunId: researchRun.id,
    researchContext,
    depth: (researchRun.depth as ResearchDepth) || 'STANDARD',
  };
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
  };
}

function validateMarket(marketId: string): Promise<boolean> {
  return db.market
    .findUnique({ where: { id: marketId }, select: { id: true } })
    .then((m) => !!m);
}

function resolveDepthFromType(jobType: string): ResearchDepth {
  if (jobType.includes('QUICK')) return 'QUICK';
  if (jobType.includes('DEEP')) return 'DEEP';
  return 'STANDARD';
}

// ── processJob ───────────────────────────────────────────────────────

async function processJob(jobType: string, payload: string | null, jobId?: string): Promise<Record<string, unknown>> {
  const data: Record<string, unknown> = payload ? JSON.parse(payload) : {};

  switch (jobType) {
    case 'SCAN_VENUE':
    case 'SCAN':
      return await runScanner(data.venues as string[], data.categories as string[]);

    case 'SCORE_CANDIDATES':
      return { status: 'SCORED', scanRunId: data.scanRunId ?? null };

    case 'TRIAGE_MARKET':
    case 'TRIAGE': {
      const marketId = String(data.marketId);
      if (!(await validateMarket(marketId))) {
        return { status: 'MARKET_NOT_FOUND', marketId, skipped: true };
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
      return result;
    }

    case 'RESEARCH_MARKET':
    case 'RESEARCH':
    case 'QUICK_RESEARCH':
    case 'STANDARD_RESEARCH':
    case 'DEEP_RESEARCH': {
      const marketId = String(data.marketId);
      if (!(await validateMarket(marketId))) {
        return { status: 'MARKET_NOT_FOUND', marketId, skipped: true };
      }
      const depth = resolveDepthFromType(jobType);

      if (jobId && depth === 'DEEP') {
        const drProgress = await loadDeepResearchProgress(jobId).catch(() => null);
        const resumePayload = drProgress ? { ...drProgress, jobId } : { jobId };
        const result = await runResearchStage(marketId, depth, undefined, resumePayload) as unknown as Record<string, unknown>;
        if (jobId) {
          await logStageTransition(marketId, {
            from: 'TRIAGED',
            to: 'RESEARCHING',
            timestamp: new Date().toISOString(),
            jobId,
          }).catch(() => {});
        }
        return result;
      }

      if (jobId) {
        await logStageTransition(marketId, {
          from: 'TRIAGED',
          to: 'RESEARCHING',
          timestamp: new Date().toISOString(),
          jobId,
        }).catch(() => {});
      }
      return await runResearchStage(marketId, depth) as unknown as Record<string, unknown>;
    }

    case 'JUDGE_MARKET':
    case 'JUDGE': {
      const marketId = String(data.marketId);
      if (!(await validateMarket(marketId))) {
        return { status: 'MARKET_NOT_FOUND', marketId, skipped: true };
      }
      const research = await lookupResearchRunForMarket(marketId);
      if (!research) {
        return { status: 'NO_RESEARCH_RUN', marketId, skipped: true, message: 'No completed ResearchRun found for market' };
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
      return result;
    }

    case 'RISK_CHECK':
    case 'RISK': {
      const marketId = String(data.marketId);
      if (!(await validateMarket(marketId))) {
        return { status: 'MARKET_NOT_FOUND', marketId, skipped: true };
      }
      const judge = await lookupJudgeParams(marketId);
      if (!judge) {
        return { status: 'NO_JUDGE_PARAMS', marketId, skipped: true, message: 'No judge/decision data found for market' };
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
      return result;
    }

    case 'PAPER_EXECUTE':
    case 'EXECUTE': {
      const marketId = String(data.marketId);
      if (!(await validateMarket(marketId))) {
        return { status: 'MARKET_NOT_FOUND', marketId, skipped: true };
      }
      let decisionId = typeof data.decisionId === 'string' ? data.decisionId : undefined;
      let judgeProb = typeof data.judgeProbability === 'number' ? data.judgeProbability : 0.5;
      let judgeConf = typeof data.judgeConfidence === 'number' ? data.judgeConfidence : 0.5;
      let judgeUnc = typeof data.judgeUncertainty === 'number' ? data.judgeUncertainty : 0.3;

      if (!decisionId || !data.judgeProbability) {
        const decision = await lookupDecisionForMarket(marketId);
        if (!decision) {
          return { status: 'NO_DECISION', marketId, skipped: true, message: 'No Decision found for market' };
        }
        decisionId = decisionId || decision.decisionId;
        judgeProb = data.judgeProbability != null ? judgeProb : decision.judgeProbability;
        judgeConf = data.judgeConfidence != null ? judgeConf : decision.judgeConfidence;
        judgeUnc = data.judgeUncertainty != null ? judgeUnc : decision.judgeUncertainty;
      }

      const result = await runExecuteStage(marketId, decisionId!, undefined as any, false, judgeProb, judgeConf, judgeUnc) as unknown as Record<string, unknown>;
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
    case 'SETTLE':
      return { status: 'SETTLE_PENDING', marketId: data.marketId };

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
