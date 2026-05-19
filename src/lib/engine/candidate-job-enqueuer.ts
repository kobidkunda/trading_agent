import { db } from '@/lib/db';
import { buildCandidateJobs, type CandidateQueueAction } from '@/lib/engine/candidate-queue';
import { ACTIVE_JOB_STATUSES, type JobType } from '@/lib/types';

// ── Stage cooldown durations ────────────────────────────────────────────────
const STAGE_COOLDOWN: Record<string, number> = {
  TRIAGE_MARKET:     6 * 60 * 60 * 1000,   // 6h
  QUICK_RESEARCH:    12 * 60 * 60 * 1000,  // 12h
  STANDARD_RESEARCH: 12 * 60 * 60 * 1000,  // 12h
  DEEP_RESEARCH:     24 * 60 * 60 * 1000,  // 24h
  JUDGE_MARKET:      12 * 60 * 60 * 1000,  // 12h
  RISK_CHECK:        6 * 60 * 60 * 1000,   // 6h
};

// ── Types ───────────────────────────────────────────────────────────────────
interface CandidateJobSpec {
  type: JobType;
  priority: number;
  payload?: Record<string, unknown>;
}

interface EnqueueCandidateJobParams {
  marketId: string;
  candidateId: string;
  trigger?: string;
  extraPayload?: Record<string, unknown>;
  jobSpecs?: CandidateJobSpec[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build dedupKey: venue:marketId:stage:cooldownBucket */
function buildDedupKey(venue: string, marketId: string, jobType: string): string {
  const ms = STAGE_COOLDOWN[jobType] ?? 0;
  const bucket = ms ? `${ms / (60 * 60 * 1000)}h` : 'none';
  return `${venue}:${marketId}:${jobType}:${bucket}`;
}

/** Map CandidateQueueAction → CandidateJobSpec[] (same logic, unchanged) */
function buildStageAwareJobs(
  action: CandidateQueueAction,
  basePayload: Record<string, unknown>,
): CandidateJobSpec[] {
  if (action === 'SKIP' || action === 'SNAPSHOT_ONLY') {
    return [];
  }

  if (action === 'TRIAGE') {
    return [{ type: 'TRIAGE_MARKET', priority: 7, payload: basePayload }];
  }

  if (action === 'TRIAGE_AND_RESEARCH') {
    return [
      { type: 'TRIAGE_MARKET', priority: 7, payload: basePayload },
      { type: 'STANDARD_RESEARCH', priority: 8, payload: basePayload },
    ];
  }

  if (action === 'FULL_RESEARCH') {
    return [
      { type: 'TRIAGE_MARKET', priority: 7, payload: basePayload },
      { type: 'DEEP_RESEARCH', priority: 10, payload: basePayload },
    ];
  }

  return buildCandidateJobs(action, {
    marketId: String(basePayload.marketId),
    candidateId: String(basePayload.candidateId),
  }) as CandidateJobSpec[];
}

// ── Main export ─────────────────────────────────────────────────────────────

export async function enqueueCandidateJobs(
  action: CandidateQueueAction,
  params: EnqueueCandidateJobParams,
) {
  const basePayload = {
    marketId: params.marketId,
    candidateId: params.candidateId,
    trigger: params.trigger ?? 'scanner_score',
    ...(params.extraPayload ?? {}),
  };
  const plannedJobs = (params.jobSpecs ?? buildStageAwareJobs(action, basePayload)).map((plannedJob) => ({
    ...plannedJob,
    payload: {
      ...basePayload,
      ...(plannedJob.payload ?? {}),
    },
  }));

  if (plannedJobs.length === 0) {
    return [];
  }

  // Look up venue for dedupKey construction
  const market = await db.market.findUnique({
    where: { id: params.marketId },
    select: { venue: true },
  });
  const venue = market?.venue ?? 'UNKNOWN';

  // Build dedupKeys for each planned job
  const jobDedupKeys = plannedJobs.map((job) => ({
    type: job.type,
    dedupKey: venue !== 'UNKNOWN' ? buildDedupKey(venue, params.marketId, job.type) : null,
    cooldownMs: STAGE_COOLDOWN[job.type] ?? 0,
  }));

  const validKeys = jobDedupKeys.filter((j) => j.dedupKey !== null).map((j) => j.dedupKey!);

  // ── Active jobs (PENDING / RUNNING / RETRYING) ────────────────────────────
  let activeKeys = new Set<string>();
  let legacyActiveTypes = new Set<string>();

  if (validKeys.length > 0) {
    const activeByDedup = await db.job.findMany({
      where: {
        dedupKey: { in: validKeys },
        status: { in: [...ACTIVE_JOB_STATUSES] },
      },
      select: { dedupKey: true },
    });
    activeKeys = new Set(activeByDedup.map((j) => j.dedupKey!).filter(Boolean));
  }

  // Legacy fallback: jobs created before dedupKey existed (type+payload match)
  const legacyActive = await db.job.findMany({
    where: {
      type: { in: plannedJobs.map((j) => j.type) },
      status: { in: [...ACTIVE_JOB_STATUSES] },
      dedupKey: null,
      payload: { contains: `"marketId":"${params.marketId}"` },
    },
    select: { type: true, payload: true },
  });
  legacyActiveTypes = new Set(
    legacyActive
      .filter((job) => {
        if (!job.payload) return false;
        try {
          const p = JSON.parse(job.payload) as { marketId?: unknown };
          return String(p.marketId) === params.marketId;
        } catch { return false; }
      })
      .map((j) => j.type as string),
  );

  // ── Completed jobs (cooldown check) ───────────────────────────────────────
  let cooledKeys = new Set<string>();
  const now = Date.now();

  if (validKeys.length > 0) {
    const completedByDedup = await db.job.findMany({
      where: {
        dedupKey: { in: validKeys },
        status: 'COMPLETED',
        completedAt: { not: null },
      },
      select: { dedupKey: true, type: true, completedAt: true },
    });

    for (const job of completedByDedup) {
      if (!job.dedupKey || !job.completedAt) continue;
      const cooldownMs = STAGE_COOLDOWN[job.type] ?? 0;
      if (!cooldownMs) continue;
      const deadline = job.completedAt.getTime() + cooldownMs;
      if (deadline > now) {
        cooledKeys.add(job.dedupKey);
      }
    }
  }

  // ── Create jobs ───────────────────────────────────────────────────────────
  const createdJobs: Array<Record<string, unknown>> = [];

  for (let i = 0; i < plannedJobs.length; i++) {
    const plannedJob = plannedJobs[i];
    const { dedupKey } = jobDedupKeys[i];

    // Block: active dedupKey match
    if (dedupKey && activeKeys.has(dedupKey)) continue;

    // Block: legacy active (type+payload, no dedupKey)
    if (legacyActiveTypes.has(plannedJob.type)) continue;

    // Block: completed within cooldown
    if (dedupKey && cooledKeys.has(dedupKey)) continue;

    const job = await db.job.create({
      data: {
        type: plannedJob.type,
        status: 'PENDING',
        priority: plannedJob.priority,
        payload: JSON.stringify(plannedJob.payload),
        ...(dedupKey ? { dedupKey } : {}),
      },
    });
    createdJobs.push(job);
  }

  return createdJobs;
}
