import { db } from '@/lib/db';

export interface LineageRecord {
  trigger: string;
  action: string;
  outcome: string;
  jobId: string;
  timestamp: string;
}

export async function exportLineage(limit = 200): Promise<LineageRecord[]> {
  const jobs = await db.job.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, type: true, status: true, payload: true, createdAt: true },
  });

  return jobs.map((j) => {
    let trigger = 'UNKNOWN';
    try {
      const p = j.payload ? JSON.parse(j.payload) : {};
      trigger = String(p.trigger ?? p.marketId ?? 'UNKNOWN');
    } catch {
      trigger = 'UNKNOWN';
    }
    return {
      trigger,
      action: j.type,
      outcome: j.status,
      jobId: j.id,
      timestamp: j.createdAt.toISOString(),
    };
  });
}
