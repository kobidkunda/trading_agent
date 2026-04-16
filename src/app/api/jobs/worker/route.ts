import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  const { getWorkerState } = await import('@/lib/engine/worker');
  return NextResponse.json(getWorkerState());
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const action = body.action as string;

  if (action === 'start') {
    const { startWorker } = await import('@/lib/engine/worker');
    const { setTestMode } = await import('@/lib/engine/mode');
    setTestMode(body.dryRun !== false);
    const intervalMs = body.intervalMs || 5000;
    return NextResponse.json(startWorker(intervalMs));
  }

  if (action === 'stop') {
    const { stopWorker } = await import('@/lib/engine/worker');
    return NextResponse.json(stopWorker());
  }

  return NextResponse.json({ error: 'Unknown action. Use: start, stop' }, { status: 400 });
}