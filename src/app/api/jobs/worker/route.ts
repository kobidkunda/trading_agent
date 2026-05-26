import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRoutePermission } from '@/lib/engine/auth';

export async function GET(request: NextRequest) {
  const denied = enforceRoutePermission(request, '/api/jobs/worker', 'GET');
  if (denied) return denied;

  const { getWorkerStatusSnapshot } = await import('@/lib/engine/worker');
  return NextResponse.json(await getWorkerStatusSnapshot());
}

export async function POST(request: NextRequest) {
  const denied = enforceRoutePermission(request, '/api/jobs/worker', 'POST');
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch (error) {
    console.error('Failed to parse worker control request', error);
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = body.action as string;

  if (action === 'start') {
    const { startWorker } = await import('@/lib/engine/worker');
    const { setTradingMode, normalizeTradingMode } = await import('@/lib/engine/mode');
    const requestedMode = normalizeTradingMode(
      typeof body.mode === 'string' ? body.mode : (body.dryRun === false ? 'LIVE' : 'PAPER'),
    );
    if (requestedMode === 'LIVE' || body.dryRun === false) {
      return NextResponse.json(
        { error: 'LIVE worker execution is disabled. Use PAPER mode for production deployment until live governance is explicitly approved.' },
        { status: 403 },
      );
    }

    setTradingMode(requestedMode);
    const intervalMs = typeof body.intervalMs === 'number' ? body.intervalMs : 5000;

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

    const result = await startWorker(intervalMs);
    return NextResponse.json(result);
  }

  if (action === 'stop') {
    const { stopWorker } = await import('@/lib/engine/worker');
    return NextResponse.json(stopWorker());
  }

  return NextResponse.json({ error: 'Unknown action. Use: start, stop' }, { status: 400 });
}
