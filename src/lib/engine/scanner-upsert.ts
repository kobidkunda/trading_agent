import { db } from '@/lib/db';
import { createTitleHash, normalizeMarketTitle } from '@/lib/engine/candidate-dedupe';
import { classifyCandidateScore, computeCandidateScore } from '@/lib/engine/candidate-scoring';
import { scanRelatedMarkets } from '@/lib/engine/related-market';
import { correlationClusterManager } from '@/lib/engine/correlation-risk';

export interface ScannerMarketInput {
  dataSource?: string;
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
  bidDepth?: number;
  askDepth?: number;
  yesTokenId?: string | null;
  noTokenId?: string | null;
  noBestBid?: number;
  noBestAsk?: number;
  noBidDepth?: number;
  noAskDepth?: number;
  priceImpact?: number;
  fillProbability?: number;
  spreadSource?: string;
  tokenId?: string | null;
  rawOrderbookJson?: string | null;
  resolutionTime?: Date | string | null;
}

function normalizeResolutionTime(value: ScannerMarketInput['resolutionTime']): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function getSnapshotPricing(market: ScannerMarketInput) {
  const yesMid = market.bestAsk ?? market.impliedProb;
  // If we have NO-side orderbook, derive noPrice from NO bestAsk (cost to buy NO)
  // Otherwise fall back to 1 - yesPrice (complement assumption)
  const noFromOrderbook = market.noBestAsk ?? null;
  const noPrice = noFromOrderbook != null ? noFromOrderbook : 1 - yesMid;

  return {
    bestBid: market.bestBid ?? null,
    bestAsk: market.bestAsk ?? null,
    yesPrice: yesMid,
    noPrice,
    noBestBid: market.noBestBid ?? null,
    noBestAsk: market.noBestAsk ?? null,
    noBidDepth: market.noBidDepth ?? null,
    noAskDepth: market.noAskDepth ?? null,
  };
}

function scannerBackgroundMaintenanceEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    String(process.env.SCANNER_BACKGROUND_MAINTENANCE ?? '').toLowerCase(),
  );
}

let scannerMaintenanceQueue: Promise<void> = Promise.resolve();

export function enqueueScannerBackgroundMaintenance(market: {
  id: string;
  title: string;
  category: string;
  resolutionTime?: Date | string | null;
  venue: string;
}): void {
  if (!scannerBackgroundMaintenanceEnabled()) {
    return;
  }

  scannerMaintenanceQueue = scannerMaintenanceQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        await scanRelatedMarkets(market.id);
      } catch (err) {
        console.error('Related market scan failed for', market.id, err);
      }

      try {
        await correlationClusterManager.clusterAndLink(market);
      } catch (err) {
        console.error('Correlation cluster linking failed for', market.id, err);
      }
    });
}

export async function upsertScannedMarket(params: {
  market: ScannerMarketInput;
  scanRunId: string;
  enqueueCandidateJobs?: boolean;
}) {
  const { market, scanRunId } = params;
  // enqueueCandidateJobs param accepted for backward compatibility but no-ops here.
  // market-loop.ts is sole owner of candidate job enqueueing.
  const normalizedTitle = normalizeMarketTitle(market.title);
  const titleHash = createTitleHash(market.title);
  const dataSource = market.dataSource || 'REAL';
  const resolutionTime = normalizeResolutionTime(market.resolutionTime);
  const snapshotCapturedAt = new Date();
  const snapshotPricing = getSnapshotPricing(market);
  const scoreBreakdown = computeCandidateScore({
    liquidity: market.liquidity,
    spread: market.spread,
    volume24h: market.volume24h || 0,
    freshnessMinutes: 0,
    priceMovePercent: 0,
    categoryPriority: 5,
    duplicatePenalty: 0,
    stalePenalty: 0,
    alreadyProcessedPenalty: 0,
    orderbookPenaltyMode: 'STRICT',
    missingOrderbookPenalty: 15,
  });
  const scoreAction = classifyCandidateScore(scoreBreakdown.totalScore);

  let existing = await db.market.findFirst({
    where: { externalId: market.externalId, venue: market.venue },
  });

  // Fallback: Polymarket may return different externalIds for same market across scans.
  // Check by title hash then normalized title to prevent duplicate markets.
  if (!existing && titleHash) {
    existing = await db.market.findFirst({
      where: { titleHash, venue: market.venue },
    });
  }
  if (!existing && normalizedTitle) {
    existing = await db.market.findFirst({
      where: { normalizedTitle, venue: market.venue },
    });
  }

  if (!existing) {
    const created = await db.market.upsert({
      where: {
        venue_externalId: {
          venue: market.venue,
          externalId: market.externalId,
        },
      },
      update: {
        title: market.title,
        normalizedTitle,
        titleHash,
        description: market.description || '',
        category: market.category,
        status: market.status,
        dataSource: dataSource as any,
        resolutionTime,
        lastSeenAt: new Date(),
        lastSnapshotAt: snapshotCapturedAt,
        latestPrice: market.impliedProb,
        latestSpread: market.spread,
        latestLiquidity: market.liquidity,
        isActive: market.status === 'ACTIVE',
        isClosed: market.status !== 'ACTIVE',
        isResolved: market.status === 'RESOLVED',
      },
      create: {
        externalId: market.externalId,
        venue: market.venue,
        title: market.title,
        normalizedTitle,
        titleHash,
        description: market.description || '',
        category: market.category,
        status: market.status,
        dataSource: dataSource as any,
        resolutionTime,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        lastSnapshotAt: snapshotCapturedAt,
        latestPrice: market.impliedProb,
        latestSpread: market.spread,
        latestLiquidity: market.liquidity,
        isActive: market.status === 'ACTIVE',
        isClosed: market.status !== 'ACTIVE',
        isResolved: market.status === 'RESOLVED',
      },
    });

    const existingCandidateForCreated = await db.tradeCandidate.findUnique({
      where: { marketId: created.id },
      select: { id: true },
    });

    if (!existingCandidateForCreated) {

      await db.marketSnapshot.create({
        data: {
          marketId: created.id,
          venue: market.venue,
          tokenId: market.tokenId ?? null,
          noTokenId: market.noTokenId ?? null,
          price: market.impliedProb,
          impliedProb: market.impliedProb,
          impliedProbability: market.impliedProb,
          liquidity: market.liquidity,
          spread: market.spread,
          spreadSource: market.spreadSource ?? null,
          volume24h: market.volume24h || 0,
          bestBid: snapshotPricing.bestBid,
          bestAsk: snapshotPricing.bestAsk,
          bidDepth: market.bidDepth ?? null,
          askDepth: market.askDepth ?? null,
          noBestBid: snapshotPricing.noBestBid,
          noBestAsk: snapshotPricing.noBestAsk,
          noBidDepth: snapshotPricing.noBidDepth,
          noAskDepth: snapshotPricing.noAskDepth,
          priceImpact: market.priceImpact ?? null,
          fillProbability: market.fillProbability ?? null,
          yesPrice: snapshotPricing.yesPrice,
          noPrice: snapshotPricing.noPrice,
          rawJson: market.rawOrderbookJson ?? null,
          capturedAt: snapshotCapturedAt,
        },
      });

      if (
        market.bestBid != null ||
        market.bestAsk != null ||
        market.spread != null ||
        market.spreadSource != null ||
        market.bidDepth != null ||
        market.askDepth != null ||
        market.priceImpact != null ||
        market.fillProbability != null ||
        market.noBestBid != null ||
        market.noBestAsk != null ||
        market.noBidDepth != null ||
        market.noAskDepth != null
      ) {
        await db.orderbookSnapshot.create({
          data: {
            marketId: created.id,
            bestBid: market.bestBid ?? null,
            bestAsk: market.bestAsk ?? null,
            spread: market.spread,
            spreadSource: market.spreadSource ?? null,
            orderbookSource: market.venue ?? null,
            bidDepth: market.bidDepth ?? null,
            askDepth: market.askDepth ?? null,
            noBestBid: market.noBestBid ?? null,
            noBestAsk: market.noBestAsk ?? null,
            noBidDepth: market.noBidDepth ?? null,
            noAskDepth: market.noAskDepth ?? null,
            priceImpact: market.priceImpact ?? null,
            fillProbability: market.fillProbability ?? null,
            rawJson: market.rawOrderbookJson ?? null,
          },
        });
      }

      await db.historicalSnapshot.create({
        data: {
          marketId: created.id,
          price: market.impliedProb,
          impliedProb: market.impliedProb,
          liquidity: market.liquidity,
          spread: market.spread,
          volume24h: market.volume24h || 0,
          bestBid: snapshotPricing.bestBid,
          bestAsk: snapshotPricing.bestAsk,
          snapshotTime: snapshotCapturedAt,
        },
      });

      try {
        await db.tradeCandidate.upsert({
          where: { marketId: created.id },
          update: {},
          create: {
            marketId: created.id,
            stage: 'SCANNED',
            sourceScanRunId: scanRunId,
          },
        });
      } catch (err: any) {
        // Race condition: another scan already created the candidate
        if (!err?.code || !['P2002', 'Unique constraint failed'].some(p => String(err).includes(p) || err.code === p)) {
          throw err;
        }
        console.warn(`[Scanner] TradeCandidate race condition for market ${created.id}, skipping`);
      }

      enqueueScannerBackgroundMaintenance({
        id: created.id,
        title: created.title,
        category: created.category,
        resolutionTime: created.resolutionTime,
        venue: created.venue,
      });

      return { created: true, updated: false, scoreAction, score: scoreBreakdown.totalScore };
    }

    existing = created;
  }

  await db.market.update({
    where: { id: existing.id },
    data: {
      title: market.title,
      normalizedTitle,
      titleHash,
      description: market.description || '',
      category: market.category,
      status: market.status,
      dataSource: dataSource as any,
      lastSeenAt: new Date(),
      lastSnapshotAt: snapshotCapturedAt,
      latestPrice: market.impliedProb,
      latestSpread: market.spread,
      latestLiquidity: market.liquidity,
      resolutionTime: resolutionTime ?? existing.resolutionTime,
      isActive: market.status === 'ACTIVE',
      isClosed: market.status !== 'ACTIVE',
      isResolved: market.status === 'RESOLVED',
    },
  });

  await db.marketSnapshot.create({
    data: {
      marketId: existing.id,
      venue: market.venue,
      tokenId: market.tokenId ?? null,
      noTokenId: market.noTokenId ?? null,
      price: market.impliedProb,
      impliedProb: market.impliedProb,
      impliedProbability: market.impliedProb,
      liquidity: market.liquidity,
      spread: market.spread,
      spreadSource: market.spreadSource ?? null,
      volume24h: market.volume24h || 0,
      bestBid: snapshotPricing.bestBid,
      bestAsk: snapshotPricing.bestAsk,
      bidDepth: market.bidDepth ?? null,
      askDepth: market.askDepth ?? null,
      noBestBid: snapshotPricing.noBestBid,
      noBestAsk: snapshotPricing.noBestAsk,
      noBidDepth: snapshotPricing.noBidDepth,
      noAskDepth: snapshotPricing.noAskDepth,
      priceImpact: market.priceImpact ?? null,
      fillProbability: market.fillProbability ?? null,
      yesPrice: snapshotPricing.yesPrice,
      noPrice: snapshotPricing.noPrice,
      rawJson: market.rawOrderbookJson ?? null,
      capturedAt: snapshotCapturedAt,
    },
  });

  if (
    market.bestBid != null ||
    market.bestAsk != null ||
    market.spread != null ||
    market.spreadSource != null ||
    market.bidDepth != null ||
    market.askDepth != null ||
    market.priceImpact != null ||
    market.fillProbability != null ||
    market.noBestBid != null ||
    market.noBestAsk != null ||
    market.noBidDepth != null ||
    market.noAskDepth != null
  ) {
    await db.orderbookSnapshot.create({
      data: {
        marketId: existing.id,
        bestBid: market.bestBid ?? null,
        bestAsk: market.bestAsk ?? null,
        spread: market.spread,
        spreadSource: market.spreadSource ?? null,
        orderbookSource: market.venue ?? null,
        bidDepth: market.bidDepth ?? null,
        askDepth: market.askDepth ?? null,
        noBestBid: market.noBestBid ?? null,
        noBestAsk: market.noBestAsk ?? null,
        noBidDepth: market.noBidDepth ?? null,
        noAskDepth: market.noAskDepth ?? null,
        priceImpact: market.priceImpact ?? null,
        fillProbability: market.fillProbability ?? null,
        rawJson: market.rawOrderbookJson ?? null,
      },
    });
  }

  await db.historicalSnapshot.create({
    data: {
      marketId: existing.id,
      price: market.impliedProb,
      impliedProb: market.impliedProb,
      liquidity: market.liquidity,
      spread: market.spread,
      volume24h: market.volume24h || 0,
      bestBid: snapshotPricing.bestBid,
      bestAsk: snapshotPricing.bestAsk,
      snapshotTime: snapshotCapturedAt,
    },
  });

  // Only run relation/cluster scans for new markets.

  return { created: false, updated: true, scoreAction, score: scoreBreakdown.totalScore };
}
