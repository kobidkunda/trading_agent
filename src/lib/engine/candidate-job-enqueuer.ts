import { db } from '@/lib/db';
import { buildCandidateJobs, type CandidateQueueAction } from '@/lib/engine/candidate-queue';
import { ACTIVE_JOB_STATUSES, type JobType } from '@/lib/types';

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
    return [{ type: 'STANDARD_RESEARCH', priority: 8, payload: basePayload }];
  }

  if (action === 'FULL_RESEARCH') {
    return [{ type: 'DEEP_RESEARCH', priority: 10, payload: basePayload }];
  }

  return buildCandidateJobs(action, {
    marketId: String(basePayload.marketId),
    candidateId: String(basePayload.candidateId),
  }) as CandidateJobSpec[];
}

function payloadMatchesMarket(payload: string | null, marketId: string): boolean {
  if (!payload) return false;

  try {
    const parsed = JSON.parse(payload) as { marketId?: unknown };
    return parsed.marketId === marketId;
  } catch {
    return false;
  }
}

export async function enqueueCandidateJobs(action: CandidateQueueAction, params: EnqueueCandidateJobParams) {
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

  const existingJobs = await db.job.findMany({
    where: {
      type: { in: plannedJobs.map((plannedJob) => plannedJob.type) },
      status: { in: [...ACTIVE_JOB_STATUSES] },
      payload: { contains: `"marketId":"${params.marketId}"` },
    },
    select: {
      type: true,
      payload: true,
    },
  });

  const activeJobTypes = new Set(
    existingJobs
      .filter((job) => payloadMatchesMarket(job.payload, params.marketId))
      .map((job) => job.type as JobType),
  );

  const createdJobs: Array<Record<string, unknown>> = [];
  for (const plannedJob of plannedJobs) {
    if (activeJobTypes.has(plannedJob.type)) {
      continue;
    }

    const job = await db.job.create({
      data: {
        type: plannedJob.type,
        status: 'PENDING',
        priority: plannedJob.priority,
        payload: JSON.stringify(plannedJob.payload),
      },
    });
    createdJobs.push(job);
  }

  return createdJobs;
}
