import { db } from '@/lib/db';
import { getPolymarketMarkets } from '@/lib/venues/polymarket';
import { getKalshiMarkets } from '@/lib/venues/kalshi';

export async function runScanner(
  venues?: string[],
  categories?: string[],
): Promise<Record<string, unknown>> {
  const strategySetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  const strategy = strategySetting ? JSON.parse(strategySetting.value) : {};
  const enabledVenues = venues || strategy.enabledVenues || ['POLYMARKET', 'KALSHI'];
  const enabledCategories = categories || strategy.enabledCategories || [];

  let totalScanned = 0;
  let totalNew = 0;

  for (const venue of enabledVenues) {
    try {
      let markets: Array<{
        externalId: string;
        title: string;
        description: string;
        category: string;
        venue: string;
        status: string;
        impliedProb: number;
        liquidity: number;
        spread: number;
        volume24h?: number;
        bestBid?: number;
        bestAsk?: number;
      }> = [];

      if (venue === 'POLYMARKET') {
        markets = await getPolymarketMarkets();
      } else if (venue === 'KALSHI') {
        const kalshiRaw = await getKalshiMarkets();
        markets = kalshiRaw.map((m) => ({
          externalId: m.ticker,
          title: m.title,
          description: m.subtitle || '',
          category: (m.category || 'other').toLowerCase(),
          venue: 'KALSHI',
          status: m.status === 'active' ? 'ACTIVE' : 'INACTIVE',
          impliedProb: m.last_price / 100,
          liquidity: m.volume,
          spread: Math.max(0.01, (m.yes_ask - m.yes_bid) / 100),
          volume24h: m.volume,
          bestBid: m.yes_bid / 100,
          bestAsk: m.yes_ask / 100,
        }));
      } else {
        continue;
      }

      for (const m of markets) {
        if (enabledCategories.length > 0 && !enabledCategories.includes(m.category)) continue;

        const existing = await db.market.findFirst({
          where: { externalId: m.externalId, venue: m.venue },
        });

        if (!existing) {
          const created = await db.market.create({
            data: {
              externalId: m.externalId,
              venue: m.venue,
              title: m.title,
              description: m.description || '',
              category: m.category,
              status: m.status,
            },
          });

          await db.marketSnapshot.create({
            data: {
              marketId: created.id,
              impliedProb: m.impliedProb,
              liquidity: m.liquidity,
              spread: m.spread,
              volume24h: m.volume24h || 0,
              bestBid: m.bestBid ?? m.impliedProb - m.spread / 2,
              bestAsk: m.bestAsk ?? m.impliedProb + m.spread / 2,
            },
          });

          await db.tradeCandidate.create({
            data: { marketId: created.id, stage: 'SCANNED' },
          });

          totalNew++;
        } else {
          await db.marketSnapshot.create({
            data: {
              marketId: existing.id,
              impliedProb: m.impliedProb,
              liquidity: m.liquidity,
              spread: m.spread,
              volume24h: m.volume24h || 0,
              bestBid: m.bestBid ?? m.impliedProb - m.spread / 2,
              bestAsk: m.bestAsk ?? m.impliedProb + m.spread / 2,
            },
          });
        }
        totalScanned++;
      }

      await db.auditLog.create({
        data: {
          action: `SCAN_${venue}`,
          entityType: 'Market',
          details: `Scanned ${markets.length} ${venue} markets, ${totalNew} new`,
        },
      });
    } catch (error) {
      console.error(`Failed to scan ${venue}:`, error);
    }
  }

  await db.settings.upsert({
    where: { key: 'last_scan_time' },
    update: { value: new Date().toISOString() },
    create: { key: 'last_scan_time', value: new Date().toISOString() },
  });

  return { totalScanned, totalNew, venues: enabledVenues };
}