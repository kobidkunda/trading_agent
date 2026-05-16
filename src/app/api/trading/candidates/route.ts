import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getEffectiveTradingConfig, STRATEGY_SETTINGS_KEY, TRADING_CONFIG_KEY, TRADING_MODE_KEY } from '@/lib/engine/trading-settings';
import { filterMarketsForMode } from '@/lib/engine/market-triage-mode-filter';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10), 1), 100);

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

    const candidates = await db.tradeCandidate.findMany({
      orderBy: { updatedAt: 'desc' },
      take: limit,
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
      },
    });

    const visibleCandidates = filterMarketsForMode(
      candidates.map((candidate) => ({
        ...candidate,
        externalId: candidate.market.externalId,
      })),
      tradingConfig.mode,
    ).map(({ externalId: _externalId, ...candidate }) => candidate);

    return NextResponse.json({ candidates: visibleCandidates });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch candidates' }, { status: 500 });
  }
}
