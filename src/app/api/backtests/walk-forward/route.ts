import { NextRequest, NextResponse } from 'next/server';
import { runWalkForward } from '@/lib/engine/walk-forward';
import type { WalkForwardConfig } from '@/lib/engine/walk-forward';
import { DEFAULT_BACKTEST_CONFIG } from '@/lib/engine/backtest-engine';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const overallStart = body.overallStart ? new Date(body.overallStart) : null;
    const overallEnd = body.overallEnd ? new Date(body.overallEnd) : null;

    if (!overallStart || !overallEnd) {
      return NextResponse.json(
        { error: 'overallStart and overallEnd are required' },
        { status: 400 },
      );
    }

    if (overallStart >= overallEnd) {
      return NextResponse.json(
        { error: 'overallStart must be before overallEnd' },
        { status: 400 },
      );
    }

    const trainDays = typeof body.trainDays === 'number' && body.trainDays > 0 ? body.trainDays : null;
    const testDays = typeof body.testDays === 'number' && body.testDays > 0 ? body.testDays : null;
    const stepDays = typeof body.stepDays === 'number' && body.stepDays > 0 ? body.stepDays : null;

    if (!trainDays || !testDays || !stepDays) {
      return NextResponse.json(
        { error: 'trainDays, testDays, and stepDays must be positive numbers' },
        { status: 400 },
      );
    }

    const config: WalkForwardConfig = {
      overallStart,
      overallEnd,
      trainDays,
      testDays,
      stepDays,
      strategyConfig: body.strategyConfig ?? DEFAULT_BACKTEST_CONFIG,
      strategyConfigVersionId: body.strategyConfigVersionId ?? undefined,
    };

    const result = await runWalkForward(config);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Walk-forward validation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
