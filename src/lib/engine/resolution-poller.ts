import { db } from '@/lib/db';
import { resolveAllPaperBetsForMarket } from '@/lib/engine/paper-bets';

const POLYMARKET_API = 'https://clob.polymarket.com';
const KALSHI_API = 'https://api.elections.kalshi.com/trade-api/v2';

interface ResolutionResult {
  marketId: string;
  externalId: string;
  venue: string;
  outcome: 'YES' | 'NO' | 'CANCELLED';
  resolvedProb?: number;
}

export async function pollPolymarketResolutions(externalIds: string[]): Promise<ResolutionResult[]> {
  const results: ResolutionResult[] = [];

  for (const conditionId of externalIds) {
    try {
      const response = await fetch(`${POLYMARKET_API}/markets/${conditionId}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) continue;

      const data = await response.json();
      if (!data.closed && !data.resolved) continue;

      const tokens = data.tokens || [];
      const yesToken = tokens.find((t: { outcome: string }) => t.outcome === 'Yes');
      const noToken = tokens.find((t: { outcome: string }) => t.outcome === 'No');

      let outcome: 'YES' | 'NO' | 'CANCELLED' = 'CANCELLED';
      let resolvedProb: number | undefined;

      if (yesToken && yesToken.price !== undefined) {
        if (yesToken.price >= 0.95) {
          outcome = 'YES';
          resolvedProb = 1;
        } else if (yesToken.price <= 0.05) {
          outcome = 'NO';
          resolvedProb = 0;
        } else if (data.resolved) {
          outcome = yesToken.price >= 0.5 ? 'YES' : 'NO';
          resolvedProb = yesToken.price >= 0.5 ? 1 : 0;
        }
      }

      if (outcome !== 'CANCELLED' || data.resolved) {
        const market = await db.market.findFirst({
          where: { externalId: conditionId, venue: 'POLYMARKET' },
        });
        if (market) {
          results.push({
            marketId: market.id,
            externalId: conditionId,
            venue: 'POLYMARKET',
            outcome,
            resolvedProb,
          });
        }
      }
    } catch (e) {
      console.error(`[Resolution] Polymarket poll failed for ${conditionId}:`, e);
    }
  }

  return results;
}

export async function pollKalshiResolutions(tickers: string[]): Promise<ResolutionResult[]> {
  const results: ResolutionResult[] = [];

  for (const ticker of tickers) {
    try {
      const response = await fetch(`${KALSHI_API}/markets/${ticker}`, {
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const market = data.market;
      if (!market) continue;

      if (market.status !== 'settled' && market.status !== 'closed') continue;

      let outcome: 'YES' | 'NO' | 'CANCELLED' = 'CANCELLED';
      let resolvedProb: number | undefined;

      if (market.settlement_price !== undefined && market.settlement_price !== null) {
        const settlePrice = market.settlement_price / 100;
        if (settlePrice >= 0.95) {
          outcome = 'YES';
          resolvedProb = 1;
        } else if (settlePrice <= 0.05) {
          outcome = 'NO';
          resolvedProb = 0;
        } else {
          outcome = settlePrice >= 0.5 ? 'YES' : 'NO';
          resolvedProb = settlePrice >= 0.5 ? 1 : 0;
        }
      } else if (market.status === 'settled') {
        outcome = market.last_price >= 50 ? 'YES' : 'NO';
        resolvedProb = market.last_price >= 50 ? 1 : 0;
      }

      if (outcome !== 'CANCELLED') {
        const dbMarket = await db.market.findFirst({
          where: { externalId: ticker, venue: 'KALSHI' },
        });
        if (dbMarket) {
          results.push({
            marketId: dbMarket.id,
            externalId: ticker,
            venue: 'KALSHI',
            outcome,
            resolvedProb,
          });
        }
      }
    } catch (e) {
      console.error(`[Resolution] Kalshi poll failed for ${ticker}:`, e);
    }
  }

  return results;
}

export async function runResolutionCycle(): Promise<{
  checked: number;
  resolved: number;
  scored: number;
  results: ResolutionResult[];
}> {
  console.log('[Resolution] Starting resolution cycle...');
  
  // Find markets with dry-run decisions that need resolution
  // This includes ACTIVE, CLOSED, and RESOLVED markets that haven't been scored yet
  const activeMarkets = await db.market.findMany({
    where: {
      status: { in: ['ACTIVE', 'CLOSED', 'RESOLVED'] },
      decisions: { some: { dryRun: true } },
      venue: { in: ['POLYMARKET', 'KALSHI'] }, // Only venues we can poll
    },
    include: { 
      outcomes: true,
      decisions: { where: { dryRun: true } },
    },
  });

  console.log(`[Resolution] Found ${activeMarkets.length} markets with dry-run decisions`);

  // Filter to markets that either:
  // 1. Have no outcomes yet (need to poll for resolution)
  // 2. Are RESOLVED but have paper bets that haven't been scored
  const unresolvedMarkets = activeMarkets.filter((m) => {
    const hasNoOutcomes = m.outcomes.length === 0;
    const isResolvedNoOutcome = m.status === 'RESOLVED' && m.outcomes.length === 0;
    const needsPolling = hasNoOutcomes || isResolvedNoOutcome;
    
    if (needsPolling) {
      console.log(`[Resolution] Market ${m.id} (${m.venue}): needs polling, outcomes=${m.outcomes.length}, status=${m.status}`);
    }
    
    return needsPolling;
  });

  console.log(`[Resolution] ${unresolvedMarkets.length} markets need resolution polling`);

  if (unresolvedMarkets.length === 0) {
    console.log('[Resolution] No markets to poll, skipping');
    return { checked: activeMarkets.length, resolved: 0, scored: 0, results: [] };
  }

  const polymarketIds = unresolvedMarkets
    .filter((m) => m.venue === 'POLYMARKET')
    .map((m) => m.externalId);

  const kalshiTickers = unresolvedMarkets
    .filter((m) => m.venue === 'KALSHI')
    .map((m) => m.externalId);

  const [polyResults, kalshiResults] = await Promise.all([
    polymarketIds.length > 0 ? pollPolymarketResolutions(polymarketIds) : Promise.resolve([]),
    kalshiTickers.length > 0 ? pollKalshiResolutions(kalshiTickers) : Promise.resolve([]),
  ]);

  const allResults = [...polyResults, ...kalshiResults];
  let resolvedCount = 0;
  let scoredCount = 0;

  for (const result of allResults) {
    console.log(`[Resolution] Processing result for market ${result.marketId}: ${result.outcome}`);
    
    const existingOutcome = await db.outcome.findFirst({
      where: { marketId: result.marketId },
    });

    if (existingOutcome) {
      console.log(`[Resolution] Market ${result.marketId} already has outcome, skipping`);
      continue;
    }

    console.log(`[Resolution] Creating outcome for market ${result.marketId}: ${result.outcome}`);
    
    await db.outcome.create({
      data: {
        marketId: result.marketId,
        result: result.outcome,
        resolvedProb: result.resolvedProb ?? null,
      },
    });

    await db.market.update({
      where: { id: result.marketId },
      data: { status: 'RESOLVED', resolutionTime: new Date() },
    });

    await db.auditLog.create({
      data: {
        action: 'MARKET_RESOLVED',
        entityType: 'Market',
        entityId: result.marketId,
        details: `Auto-resolved via ${result.venue} poll: ${result.outcome}`,
      },
    });

    const betResults = await resolveAllPaperBetsForMarket(
      result.marketId,
      result.outcome,
      result.resolvedProb,
    );

    const candidates = await db.tradeCandidate.findMany({
      where: { marketId: result.marketId },
    });
    for (const c of candidates) {
      await db.tradeCandidate.update({
        where: { id: c.id },
        data: { stage: 'SETTLED' },
      });
    }

    resolvedCount++;
    scoredCount += betResults.length;
  }

  return {
    checked: unresolvedMarkets.length,
    resolved: resolvedCount,
    scored: scoredCount,
    results: allResults,
  };
}