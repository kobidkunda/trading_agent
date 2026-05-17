import { NextRequest, NextResponse } from 'next/server';
import { runParameterSweep } from '@/lib/engine/parameter-sweep';
import type { SweepConfig, ParamRange } from '@/lib/engine/parameter-sweep';
import { DEFAULT_BACKTEST_CONFIG } from '@/lib/engine/backtest-engine';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const paramRanges: ParamRange[] = body.paramRanges;
    if (!Array.isArray(paramRanges) || paramRanges.length === 0) {
      return NextResponse.json(
        { error: 'paramRanges must be a non-empty array' },
        { status: 400 },
      );
    }

    for (const range of paramRanges) {
      if (!range.paramName || !Array.isArray(range.values)) {
        return NextResponse.json(
          { error: 'Each paramRange must have paramName (string) and values (number[])' },
          { status: 400 },
        );
      }
      const validKeys = [
        'candidateScoreThreshold',
        'minAdjustedEdge',
        'minLiquidity',
        'maxSpread',
        'confidenceThreshold',
        'maxPositionSize',
      ];
      if (!validKeys.includes(range.paramName)) {
        return NextResponse.json(
          { error: `Invalid paramName: "${range.paramName}". Must be one of: ${validKeys.join(', ')}` },
          { status: 400 },
        );
      }
    }

    const periodStart = body.periodStart ? new Date(body.periodStart) : null;
    const periodEnd = body.periodEnd ? new Date(body.periodEnd) : null;

    if (!periodStart || !periodEnd) {
      return NextResponse.json(
        { error: 'periodStart and periodEnd are required' },
        { status: 400 },
      );
    }

    if (periodStart >= periodEnd) {
      return NextResponse.json(
        { error: 'periodStart must be before periodEnd' },
        { status: 400 },
      );
    }

    if (!body.strategyConfigId) {
      return NextResponse.json(
        { error: 'strategyConfigId is required' },
        { status: 400 },
      );
    }

    const config: SweepConfig = {
      paramRanges,
      baseConfig: body.baseConfig ?? DEFAULT_BACKTEST_CONFIG,
      periodStart,
      periodEnd,
      strategyConfigId: body.strategyConfigId,
      maxCombinations: body.maxCombinations ?? 50,
    };

    const result = await runParameterSweep(config);

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Parameter sweep failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
