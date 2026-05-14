import { NextRequest, NextResponse } from 'next/server';
import { getAccuracyMetrics, resolvePaperBet } from '@/lib/engine/paper-bets';
import { runResolutionCycle } from '@/lib/engine/resolution-poller';

export async function GET() {
  try {
    const metrics = await getAccuracyMetrics(500);
    return NextResponse.json(metrics);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch accuracy metrics' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === 'resolve_poll') {
      const result = await runResolutionCycle();
      return NextResponse.json(result);
    }

    if (body.action === 'resolve_bet') {
      const { betId, actualOutcome, resolvedProb } = body;
      if (!betId || !actualOutcome) {
        return NextResponse.json({ error: 'betId and actualOutcome required' }, { status: 400 });
      }
      const result = await resolvePaperBet(betId, actualOutcome, resolvedProb);
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: 'Unknown action. Use: resolve_poll or resolve_bet' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to process paper bet action' }, { status: 500 });
  }
}