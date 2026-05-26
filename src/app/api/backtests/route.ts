import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/types';
import { DEFAULT_BACKTEST_CONFIG, getBacktestEngine } from '@/lib/engine/backtest-engine';
import {
  getProfitEvidenceSummary,
  summarizeProfitEvidence,
  type ProfitEvidenceSummary,
} from '@/lib/engine/profit-evidence';

function parseRunProfitEvidence(result: string | null, fallback: ProfitEvidenceSummary): ProfitEvidenceSummary {
  if (!result) return fallback;
  try {
    const parsed = JSON.parse(result) as {
      profitEvidence?: ProfitEvidenceSummary;
      summary?: {
        totalMarkets?: number;
        totalBets?: number;
      };
    };
    if (parsed.profitEvidence) return parsed.profitEvidence;

    const legacyEvidence = summarizeProfitEvidence({
      resolvedPaperBets: 0,
      executedUnresolvedPaperBets: 0,
      historicalResolvedMarkets: Number(parsed.summary?.totalMarkets ?? fallback.historicalResolvedMarkets ?? 0),
      historicalResolvedWithPredictions: fallback.historicalResolvedWithPredictions,
    });

    return {
      ...legacyEvidence,
      status: 'UNAVAILABLE',
      canEvaluateProfit: false,
      reason: 'Legacy backtest run has no embedded profit-evidence audit. Re-run the backtest with strict archived-prediction gating before using ROI as strategy evidence.',
    };
  } catch {
    return fallback;
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const pagination = parsePaginationParams(searchParams);
    const id = searchParams.get('id');
    const status = searchParams.get('status');

    if (id) {
      const run = await db.backtestRun.findUnique({
        where: { id },
      });
      if (!run) {
        return NextResponse.json({ error: 'Backtest run not found' }, { status: 404 });
      }
      const profitEvidence = await getProfitEvidenceSummary();
      return NextResponse.json({
        ...run,
        profitEvidence: parseRunProfitEvidence(run.result, profitEvidence),
      });
    }

    const where: Prisma.BacktestRunWhereInput = {};
    if (status) where.status = status;
    if (pagination.search) {
      where.OR = [
        { status: { contains: pagination.search } },
        { mode: { contains: pagination.search } },
        { result: { contains: pagination.search } },
      ];
    }

    const [data, total, profitEvidence] = await Promise.all([
      db.backtestRun.findMany({
        where,
        orderBy: { [pagination.sortBy || 'createdAt']: pagination.sortOrder || 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      db.backtestRun.count({ where }),
      getProfitEvidenceSummary(),
    ]);

    const annotatedData = data.map((run) => ({
      ...run,
      profitEvidence: parseRunProfitEvidence(run.result, profitEvidence),
    }));

    return NextResponse.json({ ...buildPaginatedResponse(annotatedData, total, pagination), profitEvidence });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch backtest runs' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const periodStart = body.periodStart ? new Date(body.periodStart) : new Date('2024-01-01');
    const periodEnd = body.periodEnd ? new Date(body.periodEnd) : new Date();
    const strategyConfigId = body.strategyConfigVersion ?? body.strategyConfigId ?? null;
    const mode = body.mode ?? 'DETERMINISTIC';
    const config = {
      ...DEFAULT_BACKTEST_CONFIG,
      ...(body.config && typeof body.config === 'object' ? body.config : {}),
    };

    const backtestableCount = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT h.marketId) AS count
      FROM HistoricalSnapshot h
      INNER JOIN Outcome o ON o.marketId = h.marketId
      WHERE h.snapshotTime >= ${periodStart}
        AND h.snapshotTime <= ${periodEnd}
    `;
    let count = Number(backtestableCount[0]?.count ?? 0);
    let backfillResult: Awaited<ReturnType<ReturnType<typeof getBacktestEngine>['backfillResolvedOutcomesForHistoricalSnapshots']>> | null = null;

    if (count === 0 && body.backfillOutcomes !== false) {
      backfillResult = await getBacktestEngine().backfillResolvedOutcomesForHistoricalSnapshots({
        periodStart,
        periodEnd,
        limit: Number.isFinite(Number(body.backfillLimit)) ? Number(body.backfillLimit) : 100,
      });

      const afterBackfillCount = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT h.marketId) AS count
        FROM HistoricalSnapshot h
        INNER JOIN Outcome o ON o.marketId = h.marketId
        WHERE h.snapshotTime >= ${periodStart}
          AND h.snapshotTime <= ${periodEnd}
      `;
      count = Number(afterBackfillCount[0]?.count ?? 0);
    }

    if (count === 0) {
      const failedRun = await db.backtestRun.create({
        data: {
          strategyConfigId,
          status: 'FAILED',
          mode,
          periodStart,
          periodEnd,
          startedAt: new Date(),
          completedAt: new Date(),
          result: JSON.stringify({
            error: 'No backtestable resolved markets found for this period. Backtests require historical snapshots plus resolved Outcome rows.',
            backfill: backfillResult,
            profitEvidence: await getProfitEvidenceSummary(),
          }),
        },
      });
      return NextResponse.json(
        {
          ...failedRun,
          error: 'No backtestable resolved markets found for this period. Backtests require historical snapshots plus resolved Outcome rows.',
          backfill: backfillResult,
        },
        { status: 422 },
      );
    }

    const result = await getBacktestEngine().runBacktest(config, {
      periodStart,
      periodEnd,
      strategyConfigId,
      mode,
    });

    const fallbackProfitEvidence = await getProfitEvidenceSummary();
    const run = await db.backtestRun.findUnique({ where: { id: result.backtestRunId } });
    return NextResponse.json({
      ...run,
      metrics: result.metrics,
      backfill: backfillResult,
      profitEvidence: parseRunProfitEvidence(run?.result ?? null, fallbackProfitEvidence),
    });
  } catch (error) {
    console.error('[Backtests API] Failed to run backtest:', error);
    return NextResponse.json(
      { error: 'Failed to run backtest', details: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
