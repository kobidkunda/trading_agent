import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEffectiveTradingConfig, STRATEGY_SETTINGS_KEY, TRADING_CONFIG_KEY, TRADING_MODE_KEY } from '@/lib/engine/trading-settings';
import { enforceRoutePermission } from '@/lib/engine/auth';

export async function GET() {
  try {
    const { getWorkerState } = await import('@/lib/engine/worker');
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
      worker: getWorkerState(),
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
    const body = await request.json();
    const action = body.action as string;

    if (action === 'start') {
      const { startWorker } = await import('@/lib/engine/worker');
      const intervalMs = Math.max(1, Number(body.intervalMinutes ?? 5)) * 60 * 1000;
      return NextResponse.json(startWorker(intervalMs));
    }

    if (action === 'stop') {
      const { stopWorker } = await import('@/lib/engine/worker');
      return NextResponse.json(stopWorker());
    }

    return NextResponse.json({ error: 'Unknown action. Use start or stop.' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Failed to update market loop state' }, { status: 500 });
  }
}
