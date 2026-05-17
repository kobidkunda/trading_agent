import { db } from '@/lib/db';

/**
 * Upsert a ResearchCheckpoint for the given job.
 * Serialises `state` as JSON into the `state` column.
 * Heartbeat timestamp always updated to now.
 */
export async function saveCheckpoint(jobId: string, state: Record<string, unknown>): Promise<void> {
  try {
    await db.researchCheckpoint.upsert({
      where: { jobId },
      update: {
        state: JSON.stringify(state),
        lastHeartbeatAt: new Date(),
      },
      create: {
        jobId,
        state: JSON.stringify(state),
        lastHeartbeatAt: new Date(),
      },
    });
  } catch {
    // Silently skip – checkpoint is best-effort
  }
}

/**
 * Load the checkpoint state for a job, or null if none exists.
 * If the checkpoint is stale (lastHeartbeatAt older than maxAgeMs), returns null.
 */
export async function loadCheckpoint(
  jobId: string,
  maxAgeMs: number = 600_000 // 10 min default
): Promise<Record<string, unknown> | null> {
  try {
    const checkpoint = await db.researchCheckpoint.findUnique({
      where: { jobId },
    });

    if (!checkpoint) return null;

    const age = Date.now() - new Date(checkpoint.lastHeartbeatAt).getTime();
    if (age > maxAgeMs) return null; // stale – don't trust it

    return JSON.parse(checkpoint.state);
  } catch {
    return null;
  }
}
