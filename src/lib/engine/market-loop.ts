import { db } from '@/lib/db';
import { runScanner } from '@/lib/engine/scanner';
import { computeCandidateScore, classifyCandidateScore } from '@/lib/engine/candidate-scoring';
import { shouldSkipCandidate, normalizeMarketTitle, createTitleHash, shouldReprocessMarket, computeNextEligibleAt } from '@/lib/engine/candidate-dedupe';
import { getEffectiveTradingConfig } from '@/lib/engine/trading-settings';
import { logStageTransition } from '@/lib/engine/worker-checkpoint';
import { normalizeTradingMode } from '@/lib/engine/mode';
import { classifyOrderTerminalState } from '@/lib/engine/order-tracker';
import { analyzeOracleRisk } from '@/lib/engine/oracle-mismatch';
import { serializeCriteria } from '@/lib/engine/candidate-criteria';
import { categoryPriorityForMarket } from '@/lib/engine/market-loop-helpers';
import { enqueueCandidateJobs } from '@/lib/engine/candidate-job-enqueuer';
import { computeFreshWalletSignal } from '@/lib/engine/wallet-signal';

export interface MarketLoopResult {
  scanned: number;
  candidatesCreated: number;
  candidatesSkipped: number;
  jobsCreated: number;
  mode: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildThresholdSkipReason(score: number, candidateThreshold: number): string {
  return `BELOW_CANDIDATE_THRESHOLD:${score.toFixed(2)}<${candidateThreshold}`;
}

function computeResolutionClarity(market: {
  resolutionTime: Date | null;
  oracleCheck: {
    ambiguousWording: boolean;
    humanDiscretion: boolean;
    appealProcess: boolean;
    crossVenueMismatch: boolean;
    manualReviewRequired: boolean;
    resolutionDate: Date | null;
  } | null;
}): number {
  const oracleCheck = market.oracleCheck;

  if (!oracleCheck) {
    return market.resolutionTime ? 55 : 0;
  }

  let clarity = 85;
  if (!market.resolutionTime && !oracleCheck.resolutionDate) clarity -= 20;
  if (oracleCheck.ambiguousWording) clarity -= 20;
  if (oracleCheck.humanDiscretion) clarity -= 15;
  if (oracleCheck.appealProcess) clarity -= 10;
  if (oracleCheck.crossVenueMismatch) clarity -= 20;
  if (oracleCheck.manualReviewRequired) clarity -= 10;

  return clamp(clarity, 0, 100);
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
  const maxMarketsPerScan = config.maxMarketsPerScan ?? Number.POSITIVE_INFINITY;
  const orderExpiryMinutes = config.orderExpiryMinutes ?? 1440;
  const boundedMaxMarkets = Number.isFinite(maxMarketsPerScan) && maxMarketsPerScan > 0 ? maxMarketsPerScan : Number.POSITIVE_INFINITY;
  const marketBatchSize =
    Number.isFinite(boundedMaxMarkets)
      ? Math.max(25, Math.min(100, boundedMaxMarkets))
      : 100;

  let totalScanned = 0;
  let totalCandidatesCreated = 0;
  let totalCandidatesSkipped = 0;
  let totalJobsCreated = 0;

  // Step 1: Scan venues
  const scanResult = await runScanner(enabledVenues, enabledCategories, {
    suppressCandidateJobEnqueue: true,
  });
  totalScanned = (scanResult.totalScanned as number) || 0;

  const now = new Date().toISOString();
  let processedMarketCount = 0;

  while (processedMarketCount < boundedMaxMarkets) {
    const remaining = Number.isFinite(boundedMaxMarkets)
      ? boundedMaxMarkets - processedMarketCount
      : marketBatchSize;
    const recentMarkets = await db.market.findMany({
      where: {
        isActive: true,
        isClosed: false,
        venue: { in: enabledVenues },
        ...(enabledCategories.length > 0 ? { category: { in: enabledCategories } } : {}),
        AND: [
          { resolutionTime: null },
          { resolutionTime: { gt: new Date() } },
        ],
      },
      orderBy: { id: 'desc' },
      skip: processedMarketCount,
      take: Math.min(marketBatchSize, remaining),
      include: {
        oracleCheck: true,
        orderbookSnapshots: {
          take: 1,
          orderBy: { capturedAt: 'desc' },
        },
        relatedAsA: {
          take: 5,
        },
        relatedAsB: {
          take: 5,
        },
        ensemblePredictions: {
          take: 5,
          orderBy: { createdAt: 'desc' },
        },
        positions: {
          where: { status: 'OPEN' },
          select: { currentSize: true },
        },
        tradeCandidates: {
          take: 1,
        },
        snapshots: {
          take: 2,
          orderBy: { capturedAt: 'desc' },
        },
      },
    });

    if (recentMarkets.length === 0) {
      break;
    }

    processedMarketCount += recentMarkets.length;

    // Sort batch by reprocess priority: NEW → MATERIAL_CHANGE → WALLET_SIGNAL → RELATED_CONTRADICTION → APLUS_SCORE → REFRESHED_ONLY → terminal
    recentMarkets.sort((a, b) => {
      const aCand = a.tradeCandidates[0] ?? null;
      const bCand = b.tradeCandidates[0] ?? null;
      // Terminal candidates always last
      const aTerminal = aCand ? (['DECIDED', 'EXECUTED'].includes(aCand.stage) ? 1 : 0) : 0;
      const bTerminal = bCand ? (['DECIDED', 'EXECUTED'].includes(bCand.stage) ? 1 : 0) : 0;
      if (aTerminal !== bTerminal) return aTerminal - bTerminal;
      // New markets (no candidate) get top priority
      if (!aCand && bCand) return -1;
      if (aCand && !bCand) return 1;
      if (!aCand && !bCand) return a.id.localeCompare(b.id);
      // For existing candidates, quick heuristic: prioritize by stage freshness
      // SCANNED/WATCHING before DECIDED/EXECUTED (terminal already handled)
      const aStagePri = aCand.stage === 'SCANNED' ? 0 : aCand.stage === 'WATCHING' ? 1 : 2;
      const bStagePri = bCand.stage === 'SCANNED' ? 0 : bCand.stage === 'WATCHING' ? 1 : 2;
      if (aStagePri !== bStagePri) return aStagePri - bStagePri;
      // Stable secondary sort
      return a.id.localeCompare(b.id);
    });

    for (const market of recentMarkets) {
      const existingCandidate = market.tradeCandidates[0] ?? null;
      const latestSnapshot = market.snapshots[0] ?? null;
      const previousSnapshot = market.snapshots[1] ?? null;

      const latestOrderbook = market.orderbookSnapshots[0] ?? null;
      const liquidity = latestSnapshot?.liquidity ?? 0;
      const spread = latestSnapshot?.spread ?? 0.05;
      const volume24h = latestSnapshot?.volume24h ?? 0;
      const currentProb = latestSnapshot?.impliedProb ?? 0.5;
      const previousProb = previousSnapshot?.impliedProb ?? currentProb;
      const impliedPredictions = market.ensemblePredictions.map((prediction) => prediction.predictedProb);
      const averagePredictedProb =
        impliedPredictions.length > 0
          ? impliedPredictions.reduce((sum, prob) => sum + prob, 0) / impliedPredictions.length
          : currentProb;
      const confidence =
        market.ensemblePredictions.length > 0
          ? market.ensemblePredictions.reduce((sum, prediction) => sum + (prediction.confidence ?? 0.5), 0) / market.ensemblePredictions.length
          : 0.5;
      const modelDisagreement =
        impliedPredictions.length > 1
          ? Math.sqrt(
              impliedPredictions.reduce((sum, prob) => sum + Math.pow(prob - averagePredictedProb, 2), 0) /
                impliedPredictions.length,
            )
          : 0;
      const freshWalletSignal = await computeFreshWalletSignal(market.id);
      const walletSignalScore = freshWalletSignal.score;
      const walletSignalReason = freshWalletSignal.signalReason;
      const signalFreshnessHours = freshWalletSignal.signalFreshnessHours;
      const hasTrustedWalletSignal = freshWalletSignal.hasTrustedSignal;
      const relatedMarketSignalScore =
        existingCandidate?.relatedMarketSignal ??
        (() => {
          const allRelated = [...market.relatedAsA, ...market.relatedAsB];
          if (allRelated.length === 0) return 0;
          const violationSum = allRelated.reduce((sum, rel) => {
            const v = rel.violationScore ?? 0;
            if (v <= 0) return sum;
            try {
              const rule = rel.expectedRule ? JSON.parse(rel.expectedRule) : null;
              if (rule?.source && rule.source !== 'FRESH_PRICE') return sum;
            } catch {  }
            return sum + v;
          }, 0);
          return Math.min(16, violationSum * 80);
        })();
      const correlationRiskPenalty =
        existingCandidate?.correlationRiskPenalty ??
        Math.min(20, market.positions.reduce((sum, position) => sum + position.currentSize, 0) / 1000);
      const orderbookQuality =
        latestOrderbook == null
          ? 10
          : Math.max(
              0,
              Math.min(
                20,
                (latestOrderbook.fillProbability ?? 0) * 10 +
                  ((latestOrderbook.bidDepth ?? 0) + (latestOrderbook.askDepth ?? 0)) / 1000 -
                  (latestOrderbook.thinBookDanger ? 5 : 0),
              ),
            );
      const oracleRisk =
        market.oracleCheck != null
          ? ({
              riskLevel: market.oracleCheck.riskLevel,
            } as const)
          : analyzeOracleRisk({
              title: market.title,
              description: market.description ?? '',
              crossVenueMismatch: 0,
            });
      const spreadSource = (latestOrderbook?.spreadSource as 'REAL_ORDERBOOK' | 'ESTIMATED') || 'ESTIMATED';

      const freshnessMinutes = Math.max(0, (Date.now() - new Date(market.lastSeenAt).getTime()) / 60000);
      const priceMovePercent = Math.abs(currentProb - previousProb);
      const categoryPriority = categoryPriorityForMarket(market.category);
      const adjustedEdge = averagePredictedProb - currentProb;
      const sourceQuality =
        market.ensemblePredictions.length > 0
          ? clamp(confidence * 80 + market.ensemblePredictions.length * 4, 0, 100)
          : 0;
      const resolutionClarity = computeResolutionClarity(market);
      const uncertaintyPenalty = clamp(modelDisagreement * 3, 0, 1);
      const contradictionPenalty = clamp(modelDisagreement * 5, 0, 1);
      const manipulationRiskPenalty =
        existingCandidate?.manipulationRiskPenalty ??
        clamp(
          (latestOrderbook?.thinBookDanger ? 7 : 0) +
            (spread > 0.08 ? 5 : 0) +
            (liquidity < 2_500 ? 4 : 0),
          0,
          20,
        );

      // Dedupe check
      const normalizedTitle = normalizeMarketTitle(market.title);
      const titleHash = createTitleHash(market.title);

      const dedupeInput = {
        venue: market.venue,
        externalId: market.externalId,
        normalizedTitle,
        titleHash,
        resolutionTime: market.resolutionTime?.toISOString() ?? null,
        existingMarket: null,
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

      // ── Material-change reprocess gate ────────────────────────────────────
      const prevLiquidity = previousSnapshot?.liquidity ?? liquidity;
      const prevSpread = previousSnapshot?.spread ?? spread;
      const liquidityChange = prevLiquidity > 0 ? Math.abs(liquidity - prevLiquidity) / prevLiquidity : 0;
      const spreadImprovement = prevSpread > 0 ? (prevSpread - spread) / prevSpread : 0;
      const hasNewWalletSignal =
        hasTrustedWalletSignal &&
        existingCandidate != null &&
        walletSignalScore > 0 &&
        walletSignalScore > (existingCandidate.walletSignalScore ?? 0);
      const hasRelatedContradiction =
        existingCandidate != null &&
        relatedMarketSignalScore > (existingCandidate.relatedMarketSignal ?? 0);

      const reprocessCheck = shouldReprocessMarket({
        existingCandidate: existingCandidate ? {
          stage: existingCandidate.stage,
          cooldownUntil: existingCandidate.cooldownUntil?.toISOString() ?? null,
          nextEligibleAt: existingCandidate.nextEligibleAt?.toISOString() ?? null,
          lastDecisionAt: existingCandidate.lastDecisionAt?.toISOString() ?? null,
          lastExecutionAt: existingCandidate.lastExecutionAt?.toISOString() ?? null,
          lastResearchAt: existingCandidate.lastResearchAt?.toISOString() ?? null,
          walletSignalScore: existingCandidate.walletSignalScore,
          retryCount: existingCandidate.retryCount,
        } : null,
        priceChange: priceMovePercent,
        priceChangeThreshold: 0.03,
        liquidityChange,
        liquidityChangeThreshold: 0.25,
        spreadImprovement,
        spreadImprovementThreshold: 0.30,
        hasNewWalletSignal,
        hasRelatedContradiction,
        now,
      });

      const reprocessBlocked = !reprocessCheck.shouldReprocess;
      const isTerminalCandidate = existingCandidate && ['DECIDED', 'EXECUTED'].includes(existingCandidate.stage);

      let effectiveSkip = dedupeDecision.skip;
      let effectiveSkipReason = dedupeDecision.reason;

      if (dedupeDecision.skip && dedupeDecision.reason === 'COOLDOWN_ACTIVE' && existingCandidate) {
        if (reprocessCheck.shouldReprocess) {
          effectiveSkip = false;
          effectiveSkipReason = null;
        }
      }
      const duplicatePenalty = existingCandidate ? 15 : 0;
      const stalePenalty = freshnessMinutes > 60 ? 10 : 0;
      const alreadyProcessedPenalty = existingCandidate && ['DECIDED', 'EXECUTED'].includes(existingCandidate.stage) ? 25 : 0;

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
        adjustedEdge,
        confidence,
        sourceQuality,
        resolutionClarity,
        walletSignalScore,
        signalFreshnessHours,
        relatedMarketSignalScore,
        orderbookQuality,
        oracleRiskLevel: oracleRisk.riskLevel,
        correlationRiskPenalty,
        uncertaintyPenalty,
        contradictionPenalty,
        manipulationRiskPenalty,
      });

      const action = classifyCandidateScore(score.totalScore);
      const thresholdBlocked = score.totalScore < candidateThreshold;
      const refreshOnlyBlock =
        reprocessBlocked && existingCandidate && score.totalScore >= candidateThreshold;
      const queueBlocked =
        thresholdBlocked || action === 'SKIP' || action === 'SNAPSHOT_ONLY' || effectiveSkip || refreshOnlyBlock;
      const skipReason = thresholdBlocked
        ? buildThresholdSkipReason(score.totalScore, candidateThreshold)
        : effectiveSkip
          ? effectiveSkipReason
          : refreshOnlyBlock
            ? `REFRESHED_ONLY:${reprocessCheck.reason}`
            : score.skipReason || null;
      const targetStage =
        queueBlocked && (!existingCandidate || ['SCANNED', 'WATCHING'].includes(existingCandidate.stage))
          ? 'WATCHING'
          : existingCandidate?.stage ?? 'SCANNED';

      const acceptedCriteriaStr = serializeCriteria([
        ...score.acceptedCriteria,
        `SPREAD_SOURCE:${spreadSource}`,
      ]);
      const rejectedCriteriaStr = serializeCriteria(
        thresholdBlocked
          ? [...score.rejectedCriteria, 'BELOW_CANDIDATE_THRESHOLD']
          : score.rejectedCriteria,
      );
      const candidateData: Record<string, unknown> = {
        stage: targetStage,
        candidateScore: score.totalScore,
        adjustedEdge,
        rawEdge: adjustedEdge,
        walletSignalScore,
        walletSignalReason,
        relatedMarketSignal: relatedMarketSignalScore,
        oracleRiskPenalty: score.oracleRiskPenalty,
        correlationRiskPenalty,
        manipulationRiskPenalty,
        uncertaintyPenalty: score.uncertaintyPenalty,
        contradictionPenalty: score.contradictionPenalty,
        acceptedCriteria: acceptedCriteriaStr,
        rejectedCriteria: rejectedCriteriaStr,
        skipReason,
        lastProcessedAt: new Date(),
        reprocessReason: refreshOnlyBlock ? reprocessCheck.reason : (reprocessCheck.shouldReprocess ? reprocessCheck.reason : null),
        ...(queueBlocked ? {} : { lastQueuedAt: new Date() }),
      };

      let candidateId = existingCandidate?.id ?? null;

      if (!existingCandidate) {
        const scanRun = await db.scanRun.findFirst({
          where: { venue: market.venue, status: 'COMPLETED' },
          orderBy: { startedAt: 'desc' },
        });

        const createdCandidate = await db.tradeCandidate.create({
          data: {
            marketId: market.id,
            sourceScanRunId: scanRun?.id ?? null,
            ...(candidateData as any),
          },
        });
        candidateId = createdCandidate.id;
        totalCandidatesCreated++;
      } else if (isTerminalCandidate) {
        // Never overwrite DECIDED/EXECUTED candidates — read-only pass
        candidateId = existingCandidate.id;
        totalCandidatesSkipped++;
        continue;
      } else {
        await db.tradeCandidate.update({
          where: { marketId: market.id },
          data: candidateData as any,
        });
        candidateId = existingCandidate.id;
      }

      if (queueBlocked) {
        totalCandidatesSkipped++;
        continue;
      }

      if (score.totalScore >= 85) {
        const oracleResult = analyzeOracleRisk({
          title: market.title,
          description: market.description ?? '',
          crossVenueMismatch: 0,
        });
        const requiresManual = oracleResult.riskLevel === 'HIGH' || oracleResult.riskLevel === 'BLOCK';
        let resolutionDate: Date | null = null;
        if (oracleResult.deadline) {
          const parsed = new Date(oracleResult.deadline);
          if (!isNaN(parsed.getTime())) resolutionDate = parsed;
        }
        await db.oracleCheck.upsert({
          where: { marketId: market.id },
          create: {
            marketId: market.id,
            oracleSource: oracleResult.oracleSource,
            resolutionCriteria: oracleResult.resolutionCriteria,
            resolutionDate,
            timezone: oracleResult.timezone,
            ambiguousWording: oracleResult.hasAmbiguousWording,
            humanDiscretion: oracleResult.hasHumanDiscretion,
            appealProcess: oracleResult.hasAppealProcess,
            crossVenueMismatch: oracleResult.crossVenueMismatch > 0,
            riskLevel: oracleResult.riskLevel,
            oracleRiskReasons: oracleResult.issues.length > 0 ? oracleResult.issues.join('; ') : null,
            manualReviewRequired: requiresManual,
            manualReviewStatus: requiresManual ? 'PENDING' : 'NOT_REQUIRED',
            manualReviewRequestedAt: requiresManual ? new Date() : undefined,
            notes: oracleResult.issues.length > 0 ? `Oracle risk issues: ${oracleResult.issues.join(', ')}` : null,
          },
          update: {
            oracleSource: oracleResult.oracleSource,
            resolutionCriteria: oracleResult.resolutionCriteria,
            resolutionDate,
            timezone: oracleResult.timezone,
            ambiguousWording: oracleResult.hasAmbiguousWording,
            humanDiscretion: oracleResult.hasHumanDiscretion,
            appealProcess: oracleResult.hasAppealProcess,
            crossVenueMismatch: oracleResult.crossVenueMismatch > 0,
            riskLevel: oracleResult.riskLevel,
            oracleRiskReasons: oracleResult.issues.length > 0 ? oracleResult.issues.join('; ') : null,
            manualReviewRequired: requiresManual,
            manualReviewStatus: 'PENDING',
            manualReviewRequestedAt: requiresManual ? new Date() : undefined,
            notes: oracleResult.issues.length > 0 ? `Oracle risk issues: ${oracleResult.issues.join(', ')}` : null,
          },
        });
      }

      if (totalJobsCreated < maxJobs && candidateId) {
        const createdJobs = await enqueueCandidateJobs(action, {
          marketId: market.id,
          candidateId,
          trigger: 'market_loop',
          extraPayload: {
            action,
            score: score.totalScore,
            candidateThreshold,
            spreadSource,
          },
        });
        totalJobsCreated += createdJobs.length;
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
    const newRetryCount = candidate.retryCount + 1;
    const backoffHours = Math.pow(2, newRetryCount);
    const nextEligible = computeNextEligibleAt(new Date(), backoffHours);

    await db.tradeCandidate.update({
      where: { id: candidate.id },
      data: {
        stage: 'SCANNED',
        processingLock: null,
        lockExpiresAt: null,
        retryCount: newRetryCount,
        nextEligibleAt: nextEligible,
      },
    });

    await logStageTransition(candidate.marketId, {
      from: 'RESEARCHING',
      to: 'SCANNED',
      timestamp: new Date().toISOString(),
      reason: `Stale research lock expired (retry ${newRetryCount}/3)`,
    }).catch(() => {});
  }

  // Step 4: Clean up expired paper orders
  const pendingOrders = await db.order.findMany({
    where: {
      lifecycleStatus: { in: ['PLANNED', 'SUBMITTED', 'PARTIALLY_FILLED'] },
      submittedAt: { lt: new Date(Date.now() - orderExpiryMinutes * 60_000) },
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
        data: { lifecycleStatus: 'EXPIRED', status: 'EXPIRED', expiredAt: new Date() },
      });
      await db.paperBet.updateMany({
        where: { orderId: order.id },
        data: { executionStatus: 'EXPIRED' },
      });
      await db.tradeCandidate.updateMany({
        where: { marketId: order.marketId },
        data: { stage: 'EXECUTION_FAILED' },
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
