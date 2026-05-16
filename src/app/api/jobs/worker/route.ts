import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const { getWorkerState } = await import('@/lib/engine/worker');
  return NextResponse.json(getWorkerState());
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const action = body.action as string;

  if (action === 'start') {
    const { startWorker } = await import('@/lib/engine/worker');
    const { setTradingMode, normalizeTradingMode } = await import('@/lib/engine/mode');
    setTradingMode(normalizeTradingMode(body.mode ?? (body.dryRun === false ? 'LIVE' : 'PAPER')));
    const intervalMs = body.intervalMs || 5000;

    const pendingScan = await db.job.findFirst({
      where: { type: 'SCAN_VENUE', status: 'PENDING' },
    });
    if (!pendingScan) {
      await db.job.create({
        data: {
          type: 'SCAN_VENUE',
          status: 'PENDING',
          priority: 10,
          payload: JSON.stringify({ trigger: 'pipeline_start' }),
        },
      });
    }

    const result = startWorker(intervalMs);
    return NextResponse.json(result);
  }

  if (action === 'stop') {
    const { stopWorker } = await import('@/lib/engine/worker');
    return NextResponse.json(stopWorker());
  }

  return NextResponse.json({ error: 'Unknown action. Use: start, stop' }, { status: 400 });
}
