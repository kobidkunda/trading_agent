import { db } from '@/lib/db';
import { createTitleHash, normalizeMarketTitle } from '@/lib/engine/candidate-dedupe';
import { serializeCriteria } from '@/lib/engine/candidate-criteria';
import { classifyCandidateScore, computeCandidateScore } from '@/lib/engine/candidate-scoring';
import { enqueueCandidateJobs } from '@/lib/engine/candidate-job-enqueuer';
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
  priceImpact?: number;
  fillProbability?: number;
  spreadSource?: string;
  tokenId?: string | null;
  rawOrderbookJson?: string | null;
}

export async function upsertScannedMarket(params: {
  market: ScannerMarketInput;
  scanRunId: string;
}) {
  const { market, scanRunId } = params;
  const normalizedTitle = normalizeMarketTitle(market.title);
  const titleHash = createTitleHash(market.title);
  const dataSource = market.dataSource || 'REAL';
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
  });
  const scoreAction = classifyCandidateScore(scoreBreakdown.totalScore);

  const existing = await db.market.findFirst({
    where: { externalId: market.externalId, venue: market.venue },
  });

  if (!existing) {
    const created = await db.market.create({
      data: {
        externalId: market.externalId,
        venue: market.venue,
        title: market.title,
        normalizedTitle,
        titleHash,
        description: market.description || '',
        category: market.category,
        status: market.status,
        dataSource: dataSource as any,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        isActive: market.status === 'ACTIVE',
        isClosed: market.status !== 'ACTIVE',
        isResolved: market.status === 'RESOLVED',
      },
    });

    await db.marketSnapshot.create({
      data: {
        marketId: created.id,
        venue: market.venue,
        tokenId: market.tokenId ?? null,
        price: market.impliedProb,
        impliedProb: market.impliedProb,
        impliedProbability: market.impliedProb,
        liquidity: market.liquidity,
        spread: market.spread,
        spreadSource: market.spreadSource ?? null,
        volume24h: market.volume24h || 0,
        bestBid: market.bestBid ?? market.impliedProb - market.spread / 2,
        bestAsk: market.bestAsk ?? market.impliedProb + market.spread / 2,
        bidDepth: market.bidDepth ?? null,
        askDepth: market.askDepth ?? null,
        priceImpact: market.priceImpact ?? null,
        fillProbability: market.fillProbability ?? null,
        yesPrice: market.bestAsk ?? market.impliedProb,
        noPrice: 1 - (market.bestAsk ?? market.impliedProb),
        rawJson: market.rawOrderbookJson ?? null,
        capturedAt: new Date(),
      },
    });

    if (
      market.bidDepth != null ||
      market.askDepth != null ||
      market.priceImpact != null ||
      market.fillProbability != null
    ) {
      await db.orderbookSnapshot.create({
        data: {
          marketId: created.id,
          bestBid: market.bestBid ?? null,
          bestAsk: market.bestAsk ?? null,
          spread: market.spread,
          bidDepth: market.bidDepth ?? null,
          askDepth: market.askDepth ?? null,
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
        bestBid: market.bestBid ?? market.impliedProb - market.spread / 2,
        bestAsk: market.bestAsk ?? market.impliedProb + market.spread / 2,
        snapshotTime: new Date(),
      },
    });

    const acceptedStr = serializeCriteria(scoreBreakdown.acceptedCriteria);
    const rejectedStr = serializeCriteria(scoreBreakdown.rejectedCriteria);

    await db.tradeCandidate.create({
      data: {
        marketId: created.id,
        stage: 'SCANNED',
        sourceScanRunId: scanRunId,
        candidateScore: scoreBreakdown.totalScore,
        acceptedCriteria: acceptedStr,
        rejectedCriteria: rejectedStr,
        skipReason: scoreBreakdown.skipReason || null,
      },
    });

    if (scoreAction !== 'SKIP' && scoreAction !== 'SNAPSHOT_ONLY') {
      await enqueueCandidateJobs(scoreAction, {
        marketId: created.id,
        candidateId: created.id,
      });
    }

    scanRelatedMarkets(created.id).catch(err =>
      console.error('Related market scan failed for', created.id, err),
    );
    correlationClusterManager.clusterAndLink({
      id: created.id,
      title: created.title,
      category: created.category,
      resolutionTime: created.resolutionTime,
      venue: created.venue,
    }).catch((err) =>
      console.error('Correlation cluster linking failed for', created.id, err),
    );

    return { created: true, updated: false, scoreAction, score: scoreBreakdown.totalScore };
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
      price: market.impliedProb,
      impliedProb: market.impliedProb,
      impliedProbability: market.impliedProb,
      liquidity: market.liquidity,
      spread: market.spread,
      spreadSource: market.spreadSource ?? null,
      volume24h: market.volume24h || 0,
      bestBid: market.bestBid ?? market.impliedProb - market.spread / 2,
      bestAsk: market.bestAsk ?? market.impliedProb + market.spread / 2,
      bidDepth: market.bidDepth ?? null,
      askDepth: market.askDepth ?? null,
      priceImpact: market.priceImpact ?? null,
      fillProbability: market.fillProbability ?? null,
      yesPrice: market.bestAsk ?? market.impliedProb,
      noPrice: 1 - (market.bestAsk ?? market.impliedProb),
      rawJson: market.rawOrderbookJson ?? null,
      capturedAt: new Date(),
    },
  });

  if (
    market.bidDepth != null ||
    market.askDepth != null ||
    market.priceImpact != null ||
    market.fillProbability != null
  ) {
    await db.orderbookSnapshot.create({
      data: {
        marketId: existing.id,
        bestBid: market.bestBid ?? null,
        bestAsk: market.bestAsk ?? null,
        spread: market.spread,
        bidDepth: market.bidDepth ?? null,
        askDepth: market.askDepth ?? null,
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
      bestBid: market.bestBid ?? market.impliedProb - market.spread / 2,
      bestAsk: market.bestAsk ?? market.impliedProb + market.spread / 2,
      snapshotTime: new Date(),
    },
  });

  const existingCandidate = await db.tradeCandidate.findFirst({
    where: { marketId: existing.id },
  });

  if (existingCandidate) {
    const acceptedStr = serializeCriteria(scoreBreakdown.acceptedCriteria);
    const rejectedStr = serializeCriteria(scoreBreakdown.rejectedCriteria);

    await db.tradeCandidate.update({
      where: { id: existingCandidate.id },
      data: {
        stage: scoreAction === 'SKIP' ? 'SCANNED' : 'TRIAGED',
        candidateScore: scoreBreakdown.totalScore,
        acceptedCriteria: acceptedStr,
        rejectedCriteria: rejectedStr,
        skipReason: scoreBreakdown.skipReason || null,
        sourceScanRunId: scanRunId,
        lastProcessedAt: new Date(),
      },
    });

    if (scoreAction !== 'SKIP' && scoreAction !== 'SNAPSHOT_ONLY') {
      await enqueueCandidateJobs(scoreAction, {
        marketId: existing.id,
        candidateId: existingCandidate.id,
      });
    }
  }

  scanRelatedMarkets(existing.id).catch(err =>
    console.error('Related market scan failed for', existing.id, err),
  );
  correlationClusterManager.clusterAndLink({
    id: existing.id,
    title: existing.title,
    category: existing.category,
    resolutionTime: existing.resolutionTime,
    venue: existing.venue,
  }).catch((err) =>
    console.error('Correlation cluster linking failed for', existing.id, err),
  );

  return { created: false, updated: true, scoreAction, score: scoreBreakdown.totalScore };
}
