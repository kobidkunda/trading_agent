import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  buildTradingConfigUpdate,
  getEffectiveTradingConfig,
  STRATEGY_SETTINGS_KEY,
  TRADING_CONFIG_KEY,
  TRADING_MODE_KEY,
} from '@/lib/engine/trading-settings';
import { enforceRoutePermission } from '@/lib/engine/auth';

export async function GET(request: NextRequest) {
  const denied = enforceRoutePermission(request, '/api/trading/mode', 'GET');
  if (denied) return denied;
  try {
    const [strategySetting, tradingConfigSetting, tradingModeSetting] = await Promise.all([
      db.settings.findUnique({ where: { key: STRATEGY_SETTINGS_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_CONFIG_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_MODE_KEY } }),
    ]);

    const config = getEffectiveTradingConfig({
      strategySettings: strategySetting ? JSON.parse(strategySetting.value) : null,
      tradingConfig: tradingConfigSetting ? JSON.parse(tradingConfigSetting.value) : null,
      tradingMode: tradingModeSetting?.value ?? null,
    });

    return NextResponse.json({
      mode: config.mode,
      dataSource: config.dataSource,
      executionMode: config.executionMode,
      globalKillSwitch: config.globalKillSwitch,
      liveExecutionEnabled: config.liveExecutionEnabled,
      scanIntervalMinutes: config.scanIntervalMinutes,
      candidateThreshold: config.candidateThreshold,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load trading mode' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = enforceRoutePermission(request, '/api/trading/mode', 'PUT');
  if (denied) return denied;
  try {
    const body = await request.json();
    const update = buildTradingConfigUpdate(body);

    await Promise.all([
      db.settings.upsert({
        where: { key: update.strategyKey },
        update: { value: JSON.stringify(update.strategySettings), updatedAt: new Date() },
        create: { key: update.strategyKey, value: JSON.stringify(update.strategySettings), description: 'Global strategy settings' },
      }),
      db.settings.upsert({
        where: { key: update.tradingConfigKey },
        update: { value: JSON.stringify(update.tradingConfig), updatedAt: new Date() },
        create: { key: update.tradingConfigKey, value: JSON.stringify(update.tradingConfig), description: 'Trading mode and loop settings' },
      }),
      db.settings.upsert({
        where: { key: update.modeKey },
        update: { value: update.modeValue, updatedAt: new Date() },
        create: { key: update.modeKey, value: update.modeValue, description: 'Current trading mode' },
      }),
    ]);

    return NextResponse.json({
      mode: update.modeValue,
      dataSource: update.tradingConfig.dataSource,
      executionMode: update.tradingConfig.executionMode,
      globalKillSwitch: update.tradingConfig.globalKillSwitch,
      liveExecutionEnabled: update.tradingConfig.liveExecutionEnabled,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to update trading mode' }, { status: 500 });
  }
}
