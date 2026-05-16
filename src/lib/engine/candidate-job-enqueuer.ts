import { db } from '@/lib/db';
import { buildCandidateJobs, type CandidateQueueAction } from '@/lib/engine/candidate-queue';

export async function enqueueCandidateJobs(action: CandidateQueueAction, params: { marketId: string; candidateId: string }) {
  const plannedJobs = buildCandidateJobs(action, params);

  const createdJobs: Array<Record<string, unknown>> = [];
  for (const plannedJob of plannedJobs) {
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
