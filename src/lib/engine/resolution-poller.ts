import { db } from '@/lib/db';
import { resolveAllPaperBetsForMarket } from '@/lib/engine/paper-bets';
import { BrierCalibrationEngine } from '@/lib/engine/brier-calibration';
import { getActiveVenueProxyUrl } from '@/lib/engine/venue-proxy-settings';

const POLYMARKET_DIRECT_API = 'https://clob.polymarket.com';
const KALSHI_DIRECT_API = 'https://api.elections.kalshi.com/trade-api/v2';

interface ResolutionResult {
  marketId: string;
  externalId: string;
  venue: string;
  outcome: 'YES' | 'NO' | 'CANCELLED';
  resolvedProb?: number;
}


export async function reconcileMarketResolution(params: {
  marketId: string;
  outcome: 'YES' | 'NO' | 'CANCELLED';
  resolvedProb?: number;
  source: string;
}): Promise<{
  outcomeCreated: boolean;
  paperBetsScored: number;
  positionsClosed: number;
  candidatesSettled: number;
  outcomeRecord: { id: string; marketId: string; result: string; resolvedProb: number | null };
}> {
  const existingOutcomes = await db.outcome.findMany({ where: { marketId: params.marketId }, orderBy: { resolvedAt: 'desc' }, take: 2 });
  if (existingOutcomes.length > 1) {
    throw new Error(`Duplicate outcomes detected for market ${params.marketId}`);
  }
  const existingOutcome = existingOutcomes[0] ?? null;
  const settledOutcome = (existingOutcome?.result as 'YES' | 'NO' | 'CANCELLED' | undefined) ?? params.outcome;
  const settledProb = existingOutcome?.resolvedProb ?? params.resolvedProb ?? null;

  const outcomeRecord = existingOutcome ?? await db.outcome.create({
    data: {
      marketId: params.marketId,
      result: settledOutcome,
      resolvedProb: settledProb,
    },
  });

  await db.market.update({
    where: { id: params.marketId },
    data: { status: 'RESOLVED', resolutionTime: new Date() },
  });

  if (!existingOutcome) {
    await db.auditLog.create({
      data: {
        action: 'MARKET_RESOLVED',
        entityType: 'Market',
        entityId: params.marketId,
        details: `Resolved via ${params.source}: ${settledOutcome}`,
      },
    });
  }

  const positionsClosed = await db.position.count({
    where: { marketId: params.marketId, status: { in: ['OPEN', 'WATCH'] } },
  });
  const unsettledCandidates = await db.tradeCandidate.count({
    where: { marketId: params.marketId, stage: { not: 'SETTLED' } },
  });

  const betResults = await resolveAllPaperBetsForMarket(
    params.marketId,
    settledOutcome,
    settledProb ?? undefined,
  );

  const decisions = await db.decision.findMany({
    where: { marketId: params.marketId, dryRun: true },
  });

  for (const decision of decisions) {
    if (decision.judgeProbability !== null) {
      const brier = settledOutcome === 'CANCELLED' ? null : BrierCalibrationEngine.computeBrier(decision.judgeProbability, settledOutcome);
      await (db.decision as any).update({
        where: { id: decision.id },
        data: { brierScore: brier },
      });
    }
  }

  if (unsettledCandidates > 0) {
    await db.tradeCandidate.updateMany({
      where: { marketId: params.marketId, stage: { not: 'SETTLED' } },
      data: { stage: 'SETTLED' },
    });
  }

  return {
    outcomeCreated: !existingOutcome,
    paperBetsScored: betResults.filter(Boolean).length,
    positionsClosed,
    candidatesSettled: unsettledCandidates,
    outcomeRecord: {
      id: outcomeRecord.id,
      marketId: outcomeRecord.marketId,
      result: outcomeRecord.result,
      resolvedProb: outcomeRecord.resolvedProb,
    },
  };
}

export async function pollPolymarketResolutions(externalIds: string[]): Promise<ResolutionResult[]> {
  const results: ResolutionResult[] = [];
  const baseUrl = (await getActiveVenueProxyUrl('polymarket')) || POLYMARKET_DIRECT_API;

  for (const conditionId of externalIds) {
    try {
      const response = await fetch(`${baseUrl}/markets/${conditionId}`, {
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
  const baseUrl = (await getActiveVenueProxyUrl('kalshi')) || KALSHI_DIRECT_API;

  for (const ticker of tickers) {
    try {
      const response = await fetch(`${baseUrl}/markets/${ticker}`, {
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

  const reconciliableMarkets = activeMarkets.filter((m) => m.outcomes.length > 0);
  const unresolvedMarkets = activeMarkets.filter((m) => m.outcomes.length === 0);

  console.log(`[Resolution] ${unresolvedMarkets.length} markets need resolution polling`);
  console.log(`[Resolution] ${reconciliableMarkets.length} markets already have outcomes and will be reconciled`);

  if (unresolvedMarkets.length === 0 && reconciliableMarkets.length === 0) {
    console.log('[Resolution] No markets to poll or reconcile, skipping');
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
    const reconciled = await reconcileMarketResolution({
      marketId: result.marketId,
      outcome: result.outcome,
      resolvedProb: result.resolvedProb,
      source: `${result.venue}_POLL`,
    });

    resolvedCount += reconciled.outcomeCreated ? 1 : 0;
    scoredCount += reconciled.paperBetsScored;
  }

  for (const market of reconciliableMarkets) {
    const outcome = market.outcomes[0];
    if (!outcome) continue;

    const reconciled = await reconcileMarketResolution({
      marketId: market.id,
      outcome: outcome.result as 'YES' | 'NO' | 'CANCELLED',
      resolvedProb: outcome.resolvedProb ?? undefined,
      source: 'EXISTING_OUTCOME_RECONCILE',
    });
    scoredCount += reconciled.paperBetsScored;
  }

  return {
    checked: activeMarkets.length,
    resolved: resolvedCount,
    scored: scoredCount,
    results: allResults,
  };
}
