import { db } from '@/lib/db';
import { runScanner } from '@/lib/engine/scanner';
import { computeCandidateScore, classifyCandidateScore } from '@/lib/engine/candidate-scoring';
import { shouldSkipCandidate, normalizeMarketTitle, createTitleHash } from '@/lib/engine/candidate-dedupe';
import { getEffectiveTradingConfig } from '@/lib/engine/trading-settings';
import { normalizeTradingMode } from '@/lib/engine/mode';
import { classifyOrderTerminalState } from '@/lib/engine/order-tracker';

export interface MarketLoopResult {
  scanned: number;
  candidatesCreated: number;
  candidatesSkipped: number;
  jobsCreated: number;
  mode: string;
}

export async function runMarketLoopOnce(): Promise<MarketLoopResult> {
  const [strategySetting, tradingConfigSetting, tradingModeSetting] = await Promise.all([
    db.settings.findUnique({ where: { key: 'strategy_settings' } }),
    db.settings.findUnique({ where: { key: 'trading_config' } }),
    db.settings.findUnique({ where: { key: 'trading_mode' } }),
  ]);

  const config = getEffectiveTradingConfig({
    strategySettings: strategySetting ? JSON.parse(strategySetting.value) : null,
    tradingConfig: tradingConfigSetting ? JSON.parse(tradingConfigSetting.value) : null,
    tradingMode: tradingModeSetting?.value ?? null,
  });

  const mode = normalizeTradingMode(config.mode);

  // DEMO mode: skip market loop (handled by live-simulation.ts demo templates)
  if (mode === 'DEMO') {
    return { scanned: 0, candidatesCreated: 0, candidatesSkipped: 0, jobsCreated: 0, mode: 'DEMO' };
  }

  const enabledVenues = config.enabledVenues || ['POLYMARKET', 'KALSHI'];
  const enabledCategories = config.enabledCategories || [];
  const candidateThreshold = config.candidateThreshold ?? 75;
  const maxJobs = config.maxResearchJobsPerCycle ?? 5;

  let totalScanned = 0;
  let totalCandidatesCreated = 0;
  let totalCandidatesSkipped = 0;
  let totalJobsCreated = 0;

  // Step 1: Scan venues
  const scanResult = await runScanner(enabledVenues, enabledCategories);
  totalScanned = (scanResult.totalScanned as number) || 0;

  // Step 2: Get recently upserted markets that need candidate scoring
  const recentMarkets = await db.market.findMany({
    where: {
      isActive: true,
      isClosed: false,
      venue: { in: enabledVenues },
    },
    orderBy: { lastSeenAt: 'desc' },
    take: 200,
  });

  const now = new Date().toISOString();

  for (const market of recentMarkets) {
    // Check if this market already has a trade candidate
    const existingCandidate = await db.tradeCandidate.findUnique({
      where: { marketId: market.id },
    });

    // Get latest snapshot for scoring
    const latestSnapshot = await db.marketSnapshot.findFirst({
      where: { marketId: market.id },
      orderBy: { capturedAt: 'desc' },
    });

    // Check for previous snapshot to detect price movement
    const previousSnapshot = await db.marketSnapshot.findFirst({
      where: { marketId: market.id },
      orderBy: { capturedAt: 'desc' },
      skip: 1,
    });

    const liquidity = latestSnapshot?.liquidity ?? 0;
    const spread = latestSnapshot?.spread ?? 0.05;
    const volume24h = latestSnapshot?.volume24h ?? 0;
    const currentProb = latestSnapshot?.impliedProb ?? 0.5;
    const previousProb = previousSnapshot?.impliedProb ?? currentProb;

    const freshnessMinutes = Math.max(0, (Date.now() - new Date(market.lastSeenAt).getTime()) / 60000);
    const priceMovePercent = Math.abs(currentProb - previousProb);
    const categoryPriority = ['crypto', 'economics'].includes(market.category) ? 3 : ['technology', 'politics'].includes(market.category) ? 2 : 0;

    // Dedupe check
    const normalizedTitle = normalizeMarketTitle(market.title);
    const titleHash = createTitleHash(market.title);

    const dedupeInput = {
      venue: market.venue,
      externalId: market.externalId,
      normalizedTitle,
      titleHash,
      resolutionTime: market.resolutionTime?.toISOString() ?? null,
      existingMarket: null, // we already have the market
      existingCandidate: existingCandidate ? {
        stage: existingCandidate.stage,
        cooldownUntil: existingCandidate.cooldownUntil?.toISOString() ?? null,
        nextEligibleAt: existingCandidate.nextEligibleAt?.toISOString() ?? null,
        lockExpiresAt: existingCandidate.lockExpiresAt?.toISOString() ?? null,
      } : null,
      now,
      priceChangeThreshold: 0.03,
      currentProbability: currentProb,
      previousProbability: previousProb,
    };

    const dedupeDecision = shouldSkipCandidate(dedupeInput);
    const duplicatePenalty = existingCandidate ? 15 : 0;
    const stalePenalty = freshnessMinutes > 60 ? 10 : 0;
    const alreadyProcessedPenalty = existingCandidate && ['DECIDED', 'EXECUTED'].includes(existingCandidate.stage) ? 25 : 0;

    // Score the candidate
    const score = computeCandidateScore({
      liquidity,
      spread,
      volume24h,
      freshnessMinutes,
      priceMovePercent,
      categoryPriority,
      duplicatePenalty,
      stalePenalty,
      alreadyProcessedPenalty,
    });

    const action = classifyCandidateScore(score.totalScore);

    if (action === 'SKIP' || dedupeDecision.skip) {
      totalCandidatesSkipped++;
      continue;
    }

    // Create or update candidate
    const acceptedCriteriaStr = score.acceptedCriteria.length > 0 ? score.acceptedCriteria.join(',') : null;
    const rejectedCriteriaStr = score.rejectedCriteria.length > 0 ? score.rejectedCriteria.join(',') : null;
    const candidateData: Record<string, unknown> = {
      stage: action === 'FULL_RESEARCH' ? 'SCANNED' : 'SCANNED',
      candidateScore: score.totalScore,
      acceptedCriteria: acceptedCriteriaStr,
      rejectedCriteria: rejectedCriteriaStr,
      skipReason: score.skipReason || null,
      lastProcessedAt: new Date(),
    };

    if (!existingCandidate) {
      const scanRun = await db.scanRun.findFirst({
        where: { venue: market.venue, status: 'COMPLETED' },
        orderBy: { startedAt: 'desc' },
      });

      await db.tradeCandidate.create({
        data: {
          marketId: market.id,
          stage: 'SCANNED',
          candidateScore: score.totalScore,
          acceptedCriteria: acceptedCriteriaStr,
          rejectedCriteria: rejectedCriteriaStr,
          skipReason: score.skipReason || null,
          sourceScanRunId: scanRun?.id ?? null,
        },
      });
      totalCandidatesCreated++;
    } else {
      await db.tradeCandidate.update({
        where: { marketId: market.id },
        data: candidateData as any,
      });
    }

    // Create lifecycle jobs for eligible candidates
    if (totalJobsCreated < maxJobs && (action === 'TRIAGE' || action === 'TRIAGE_AND_RESEARCH' || action === 'FULL_RESEARCH')) {
      const existingJobs = await db.job.count({
        where: {
          payload: { contains: `"marketId":"${market.id}"` },
          status: { in: ['PENDING', 'RUNNING'] },
        },
      });

      if (existingJobs === 0) {
        await db.job.create({
          data: {
            type: 'TRIAGE_MARKET',
            status: 'PENDING',
            priority: action === 'FULL_RESEARCH' ? 8 : 6,
            payload: JSON.stringify({ marketId: market.id, action }),
          },
        });
        totalJobsCreated++;
      }
    }
  }

  // Step 3: Process stale candidates - retry RESEARCHING jobs past lock expiry
  const staleCandidates = await db.tradeCandidate.findMany({
    where: {
      stage: 'RESEARCHING',
      lockExpiresAt: { lt: new Date() },
      retryCount: { lt: 3 },
    },
    take: 10,
  });

  for (const candidate of staleCandidates) {
    await db.tradeCandidate.update({
      where: { id: candidate.id },
      data: {
        stage: 'SCANNED',
        processingLock: null,
        lockExpiresAt: null,
        retryCount: { increment: 1 },
      },
    });
  }

  // Step 4: Clean up expired paper orders
  const pendingOrders = await db.order.findMany({
    where: {
      lifecycleStatus: { in: ['PLANNED', 'SUBMITTED', 'PARTIALLY_FILLED'] },
      submittedAt: { lt: new Date(Date.now() - 86400000) }, // older than 24h
    },
  });

  for (const order of pendingOrders) {
    const terminalState = classifyOrderTerminalState({
      lifecycleStatus: order.lifecycleStatus as any,
      remainingSize: order.remainingSize,
    });

    if (!terminalState) {
      await db.order.update({
        where: { id: order.id },
        data: { lifecycleStatus: 'EXPIRED', expiredAt: new Date() },
      });
    }
  }

  return {
    scanned: totalScanned,
    candidatesCreated: totalCandidatesCreated,
    candidatesSkipped: totalCandidatesSkipped,
    jobsCreated: totalJobsCreated,
    mode,
  };
}
