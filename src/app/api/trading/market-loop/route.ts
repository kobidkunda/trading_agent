import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEffectiveTradingConfig, STRATEGY_SETTINGS_KEY, TRADING_CONFIG_KEY, TRADING_MODE_KEY } from '@/lib/engine/trading-settings';
import { enforceRoutePermission } from '@/lib/engine/auth';

export async function GET() {
  try {
    const { getWorkerStatusSnapshot } = await import('@/lib/engine/worker');
    const [strategySetting, tradingConfigSetting, tradingModeSetting, lastScanSetting] = await Promise.all([
      db.settings.findUnique({ where: { key: STRATEGY_SETTINGS_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_CONFIG_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_MODE_KEY } }),
      db.settings.findUnique({ where: { key: 'last_scan_time' } }),
    ]);

    const config = getEffectiveTradingConfig({
      strategySettings: strategySetting ? JSON.parse(strategySetting.value) : null,
      tradingConfig: tradingConfigSetting ? JSON.parse(tradingConfigSetting.value) : null,
      tradingMode: tradingModeSetting?.value ?? null,
    });

    return NextResponse.json({
      worker: await getWorkerStatusSnapshot(),
      mode: config.mode,
      dataSource: config.dataSource,
      executionMode: config.executionMode,
      globalKillSwitch: config.globalKillSwitch,
      scanIntervalMinutes: config.scanIntervalMinutes,
      lastScanAt: lastScanSetting?.value ?? null,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load market loop status' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = enforceRoutePermission(request, '/api/trading/market-loop', 'POST');
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'JSON body required. Use action start or stop.' }, { status: 400 });
    }
    const action = body.action as string;

    if (action === 'start') {
      const { startWorker, runWorkerFlowUntilIdle, getWorkerState } = await import('@/lib/engine/worker');
      const intervalMs = Math.max(1, Number(body.intervalMinutes ?? 5)) * 60 * 1000;
      if (body.waitUntilComplete === true) {
        const maxWaitMs = Math.max(1, Math.min(240_000, Number(body.maxWaitMs ?? 90_000)));
        const flowPromise = runWorkerFlowUntilIdle({
          maxJobs: Number(body.maxJobs ?? 50),
          runMarketLoop: body.runMarketLoop !== false,
          failOnNoWork: body.failOnNoWork !== false,
          failOnJobError: body.failOnJobError === true,
        }).then(
          (result) => ({ status: 'completed' as const, result }),
          (error) => ({ status: 'failed' as const, error }),
        );
        const timeoutPromise = new Promise<{ status: 'timeout' }>((resolve) => {
          setTimeout(() => resolve({ status: 'timeout' }), maxWaitMs);
        });
        const settled = await Promise.race([flowPromise, timeoutPromise]);
        if (settled.status === 'timeout') {
          return NextResponse.json(
            {
              action: 'processing',
              timedOut: true,
              maxWaitMs,
              worker: getWorkerState(),
              message: 'Worker flow is still running. Poll /api/jobs or call again with a smaller maxJobs/maxWaitMs.',
            },
            { status: 202 },
          );
        }
        if (settled.status === 'failed') {
          throw settled.error;
        }
        return NextResponse.json({ action: 'completed', ...settled.result });
      }
      return NextResponse.json(await startWorker(intervalMs));
    }

    if (action === 'stop') {
      const { stopWorker } = await import('@/lib/engine/worker');
      return NextResponse.json(stopWorker());
    }

    return NextResponse.json({ error: 'Unknown action. Use start or stop.' }, { status: 400 });
  } catch (error) {
    console.error('[Market Loop API] POST error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
