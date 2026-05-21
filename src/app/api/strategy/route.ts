import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import {
  buildTradingConfigUpdate,
  getEffectiveTradingConfig,
  STRATEGY_SETTINGS_KEY,
  TRADING_CONFIG_KEY,
  TRADING_MODE_KEY,
} from '@/lib/engine/trading-settings';

export async function GET() {
  try {
    const [strategySetting, tradingConfigSetting, tradingModeSetting] = await Promise.all([
      db.settings.findUnique({ where: { key: STRATEGY_SETTINGS_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_CONFIG_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_MODE_KEY } }),
    ]);

    const strategy = getEffectiveTradingConfig({
      strategySettings: strategySetting ? JSON.parse(strategySetting.value) : null,
      tradingConfig: tradingConfigSetting ? JSON.parse(tradingConfigSetting.value) : null,
      tradingMode: tradingModeSetting?.value ?? null,
    });

    return NextResponse.json(strategy);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch strategy settings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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

    await db.auditLog.create({
      data: { action: 'UPDATE_STRATEGY', entityType: 'Settings', entityId: update.strategyKey, details: `Strategy settings updated for mode ${update.modeValue}` },
    });

    const [strategySetting, tradingConfigSetting, tradingModeSetting] = await Promise.all([
      db.settings.findUnique({ where: { key: STRATEGY_SETTINGS_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_CONFIG_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_MODE_KEY } }),
    ]);

    const effectiveSettings = getEffectiveTradingConfig({
      strategySettings: strategySetting ? JSON.parse(strategySetting.value) : null,
      tradingConfig: tradingConfigSetting ? JSON.parse(tradingConfigSetting.value) : null,
      tradingMode: tradingModeSetting?.value ?? null,
    });

    return NextResponse.json({
      success: true,
      mode: effectiveSettings.mode,
      settings: effectiveSettings,
      persistedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save strategy settings' }, { status: 500 });
  }
}
