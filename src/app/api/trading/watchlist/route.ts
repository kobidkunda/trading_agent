import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEffectiveTradingConfig, STRATEGY_SETTINGS_KEY, TRADING_CONFIG_KEY, TRADING_MODE_KEY } from '@/lib/engine/trading-settings';
import { filterWatchlistByMode } from '@/lib/engine/watchlist-scanrun-filters';

export async function GET() {
  try {
    const [strategySetting, tradingConfigSetting, tradingModeSetting] = await Promise.all([
      db.settings.findUnique({ where: { key: STRATEGY_SETTINGS_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_CONFIG_KEY } }),
      db.settings.findUnique({ where: { key: TRADING_MODE_KEY } }),
    ]);

    const tradingConfig = getEffectiveTradingConfig({
      strategySettings: strategySetting ? JSON.parse(strategySetting.value) : null,
      tradingConfig: tradingConfigSetting ? JSON.parse(tradingConfigSetting.value) : null,
      tradingMode: tradingModeSetting?.value ?? null,
    });

    const watchlist = await db.watchlist.findMany({
      include: {
        market: {
          select: {
            id: true,
            title: true,
            venue: true,
            category: true,
            externalId: true,
          },
        },
        decision: {
          select: {
            id: true,
            action: true,
            reason: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ watchlist: filterWatchlistByMode(watchlist, tradingConfig.mode) });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch watchlist' }, { status: 500 });
  }
}
