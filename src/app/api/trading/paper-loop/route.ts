import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
  try {
    const { getPaperLoopState } = await import('@/lib/engine/paper-order-loop');
    return NextResponse.json(getPaperLoopState());
  } catch {
    return NextResponse.json({ error: 'Failed to load paper loop status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = (body.action as string) ?? 'start';
    const intervalMs = Math.max(1000, Number(body.intervalMs ?? 3000));

    const {
      startPaperLoop,
      stopPaperLoop,
      pausePaperLoop,
      resetPaperLoopStats,
      fillAllPendingPaperOrders,
    } = await import('@/lib/engine/paper-order-loop');

    switch (action) {
      case 'start': {
        const state = startPaperLoop(intervalMs);
        return NextResponse.json({ action: 'started', ...state });
      }

      case 'stop': {
        const state = stopPaperLoop();
        return NextResponse.json({ action: 'stopped', ...state });
      }

      case 'pause': {
        const state = pausePaperLoop();
        return NextResponse.json({ action: 'paused', ...state });
      }

      case 'reset': {
        const state = resetPaperLoopStats();
        return NextResponse.json({ action: 'reset', ...state });
      }

      case 'fill-all': {
        const result = await fillAllPendingPaperOrders();
        return NextResponse.json({
          action: 'fill-all',
          ...result,
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Use start | stop | pause | reset | fill-all` },
          { status: 400 },
        );
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Paper loop error' },
      { status: 500 },
    );
  }
}
