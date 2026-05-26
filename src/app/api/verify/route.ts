import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runResolutionCycle } from '@/lib/engine/resolution-poller';
import { getAccuracyMetrics } from '@/lib/engine/paper-bets';
import {
  ACTIVE_OPPOSITE_SIDE_PAPER_BET,
  ACTIVE_SAME_SIDE_PAPER_BET,
  UNRESOLVED_PAPER_BET_STATUSES,
} from '@/lib/engine/paper-bets';
import { getProfitEvidenceSummary } from '@/lib/engine/profit-evidence';
import { PAPER_LOOP_TEST_MARKET_EXTERNAL_ID, PAPER_LOOP_TEST_MARKET_TITLE } from '@/lib/engine/paper-loop-test-market';
import { getSearchConfig, getStageRouting } from '@/lib/engine/service-routing';
import type { Prisma } from '@prisma/client';

/**
 * Comprehensive verification endpoint
 * Tests:
 * 1. Source aggregation (nonblank recent research with explicit degraded-provider reasons)
 * 2. Outcome pulling in dry-run mode
 * 3. Paper bet resolution
 * 4. All provider connections
 */

export async function GET() {
  const results: Record<string, any> = {};
  const errors: string[] = [];

  try {
    // Test 1: Check outcome pulling for dry-run markets
    console.log('[Verify] Testing outcome pulling...');
    
    const dryRunMarkets = await db.market.findMany({
      where: {
        decisions: { some: { dryRun: true } },
        status: { in: ['ACTIVE', 'CLOSED'] },
        dataSource: 'REAL',
      },
      include: { outcomes: true, decisions: true },
      take: 10,
    });

    const unresolvedDryRun = dryRunMarkets.filter(m => m.outcomes.length === 0);
    
    results.outcomePulling = {
      dryRunMarketsTotal: dryRunMarkets.length,
      unresolvedCount: unresolvedDryRun.length,
      canPoll: unresolvedDryRun.length > 0,
      venues: dryRunMarkets.map(m => m.venue),
    };

    // Actually run resolution cycle to test it
    const resolutionResult = await runResolutionCycle();
    results.resolutionCycle = resolutionResult;

    // Test 2: Check paper bets
    console.log('[Verify] Testing paper bets...');
    
    const paperBetWhere: Prisma.PaperBetWhereInput = {
      market: {
        dataSource: 'REAL',
        externalId: { not: PAPER_LOOP_TEST_MARKET_EXTERNAL_ID },
        title: { not: PAPER_LOOP_TEST_MARKET_TITLE },
      },
      decision: { mode: 'PAPER' },
    };

    const [paperBetTotal, paperBetStatusCounts, accuracy] = await Promise.all([
      db.paperBet.count({ where: paperBetWhere }),
      db.paperBet.groupBy({ by: ['executionStatus'], where: paperBetWhere, _count: { _all: true } }),
      getAccuracyMetrics(100),
    ]);

    const executionStatusCounts = Object.fromEntries(
      paperBetStatusCounts.map((row) => [row.executionStatus, row._count._all]),
    );

    results.paperBets = {
      total: paperBetTotal,
      executed: accuracy.totalBets,
      resolved: accuracy.resolvedBets,
      pending: accuracy.pendingBets,
      cancelled: Number(executionStatusCounts.CANCELLED ?? 0),
      executionStatusCounts,
      resolutionRate: accuracy.totalBets > 0 ? Math.round((accuracy.resolvedBets / accuracy.totalBets) * 100) : 0,
    };

    results.accuracy = accuracy;

    console.log('[Verify] Testing profit evidence readiness...');
    results.profitEvidence = await getProfitEvidenceSummary();

    // Test 2b: Paper trading price integrity.
    // Prediction contracts must stay within [0, 1]. Any value outside that
    // range corrupts P&L, Brier-score interpretation, and position exposure.
    console.log('[Verify] Testing paper price bounds...');

    const [
      impossibleOrders,
      impossiblePaperBets,
      impossibleFills,
      impossiblePositions,
    ] = await Promise.all([
      db.order.count({
        where: {
          OR: [
            { price: { lt: 0 } },
            { price: { gt: 1 } },
            { avgFillPrice: { lt: 0 } },
            { avgFillPrice: { gt: 1 } },
          ],
        },
      }),
      db.paperBet.count({
        where: {
          OR: [
            { entryPrice: { lt: 0 } },
            { entryPrice: { gt: 1 } },
            { predictedProb: { lt: 0 } },
            { predictedProb: { gt: 1 } },
            { impliedProb: { lt: 0 } },
            { impliedProb: { gt: 1 } },
          ],
        },
      }),
      db.fill.count({
        where: {
          OR: [
            { price: { lt: 0 } },
            { price: { gt: 1 } },
          ],
        },
      }),
      db.position.count({
        where: {
          OR: [
            { entryPrice: { lt: 0 } },
            { entryPrice: { gt: 1 } },
            { avgEntryPrice: { lt: 0 } },
            { avgEntryPrice: { gt: 1 } },
          ],
        },
      }),
    ]);

    results.paperPriceBounds = {
      impossibleOrders,
      impossiblePaperBets,
      impossibleFills,
      impossiblePositions,
      total:
        impossibleOrders
        + impossiblePaperBets
        + impossibleFills
        + impossiblePositions,
    };

    if (results.paperPriceBounds.total > 0) {
      errors.push(`Paper price bounds violated: ${JSON.stringify(results.paperPriceBounds)}`);
    }

    // Test 2c: Market/orderbook quality. The old Kalshi fallback bug created
    // rows with 0 bid, 1 ask, 100% spread, and zero depth. Historical rows may
    // remain, but no active market is allowed to expose one as its latest state.
    console.log('[Verify] Testing market/orderbook data quality...');

    const [
      activeBadKalshiComboRows,
      activeFakeLatestSnapshotRows,
      fakeOrderbookRows,
      activeOrderbookDiversityRows,
    ] = await Promise.all([
      db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM Market
        WHERE lower(title) LIKE 'yes %,yes %'
          AND status NOT IN ('CLOSED', 'RESOLVED', 'QUARANTINED')
      `,
      db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM Market m
        WHERE m.status = 'ACTIVE'
          AND EXISTS (
            SELECT 1
            FROM MarketSnapshot s
            WHERE s.marketId = m.id
              AND s.timestamp = (
                SELECT MAX(s2.timestamp)
                FROM MarketSnapshot s2
                WHERE s2.marketId = m.id
              )
              AND s.impliedProb IN (0, 1)
              AND s.liquidity = 0
              AND s.spread = 1
          )
      `,
      db.orderbookSnapshot.count({
        where: {
          bestBid: 0,
          bestAsk: 1,
          bidDepth: 0,
          askDepth: 0,
        },
      }),
      db.$queryRaw<Array<{
        total: bigint;
        uniqueBid: bigint;
        uniqueAsk: bigint;
        uniqueSpread: bigint;
        uniqueBidDepth: bigint;
        uniqueAskDepth: bigint;
      }>>`
        SELECT
          COUNT(*) AS total,
          COUNT(DISTINCT os.bestBid) AS uniqueBid,
          COUNT(DISTINCT os.bestAsk) AS uniqueAsk,
          COUNT(DISTINCT os.spread) AS uniqueSpread,
          COUNT(DISTINCT os.bidDepth) AS uniqueBidDepth,
          COUNT(DISTINCT os.askDepth) AS uniqueAskDepth
        FROM OrderbookSnapshot os
        INNER JOIN Market m ON m.id = os.marketId
        WHERE m.status = 'ACTIVE'
      `,
    ]);

    const orderbookDiversity = activeOrderbookDiversityRows[0];
    results.marketDataQuality = {
      activeBadKalshiComboMarkets: Number(activeBadKalshiComboRows[0]?.count ?? 0),
      activeFakeLatestSnapshots: Number(activeFakeLatestSnapshotRows[0]?.count ?? 0),
      fakeOrderbookRows,
      activeOrderbookRows: Number(orderbookDiversity?.total ?? 0),
      uniqueBidValues: Number(orderbookDiversity?.uniqueBid ?? 0),
      uniqueAskValues: Number(orderbookDiversity?.uniqueAsk ?? 0),
      uniqueSpreadValues: Number(orderbookDiversity?.uniqueSpread ?? 0),
      uniqueBidDepthValues: Number(orderbookDiversity?.uniqueBidDepth ?? 0),
      uniqueAskDepthValues: Number(orderbookDiversity?.uniqueAskDepth ?? 0),
    };

    if (results.marketDataQuality.activeBadKalshiComboMarkets > 0) {
      errors.push(`Active bad Kalshi combo markets: ${results.marketDataQuality.activeBadKalshiComboMarkets}`);
    }
    if (results.marketDataQuality.activeFakeLatestSnapshots > 0) {
      errors.push(`Active markets exposing fake latest snapshots: ${results.marketDataQuality.activeFakeLatestSnapshots}`);
    }
    if (results.marketDataQuality.fakeOrderbookRows > 0) {
      errors.push(`Fake orderbook rows exposed: ${results.marketDataQuality.fakeOrderbookRows}`);
    }
    if (
      results.marketDataQuality.activeOrderbookRows >= 25
      && (
        results.marketDataQuality.uniqueBidValues < 5
        || results.marketDataQuality.uniqueAskValues < 5
        || results.marketDataQuality.uniqueSpreadValues < 5
      )
    ) {
      errors.push(`Collapsed active orderbook diversity: ${JSON.stringify({
        rows: results.marketDataQuality.activeOrderbookRows,
        uniqueBidValues: results.marketDataQuality.uniqueBidValues,
        uniqueAskValues: results.marketDataQuality.uniqueAskValues,
        uniqueSpreadValues: results.marketDataQuality.uniqueSpreadValues,
      })}`);
    }

    // Test 2d: Paper exposure integrity.
    // Every executed paper bet must have an archived model prediction for future
    // realized-profit/backtest evidence, and active market exposure must not be duplicated.
    console.log('[Verify] Testing paper exposure integrity...');

    const [
      executedUnresolvedPaperBetRows,
      executedUnresolvedWithArchivedPredictionRows,
      executedUnresolvedPaperBetMarketRows,
      activeResolutionJobMarketRows,
      dueResolutionJobRows,
      nextResolutionJob,
      nextExecutedMarketResolution,
      activeSameSideDuplicateRows,
      activeOppositeSideExposureRows,
    ] = await Promise.all([
      db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM PaperBet p
        INNER JOIN Decision d ON d.id = p.decisionId
        INNER JOIN Market m ON m.id = p.marketId
        WHERE p.actualOutcome IS NULL
          AND p.executionStatus IN ('FILLED', 'PARTIAL')
          AND d.mode = 'PAPER'
          AND m.dataSource = 'REAL'
      `,
      db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM PaperBet p
        INNER JOIN Decision d ON d.id = p.decisionId
        INNER JOIN Market m ON m.id = p.marketId
        WHERE p.actualOutcome IS NULL
          AND p.executionStatus IN ('FILLED', 'PARTIAL')
          AND d.mode = 'PAPER'
          AND m.dataSource = 'REAL'
          AND EXISTS (
            SELECT 1
            FROM HistoricalSnapshot h
            WHERE h.marketId = p.marketId
              AND h.predictedProb IS NOT NULL
          )
      `,
      db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT p.marketId) AS count
        FROM PaperBet p
        INNER JOIN Decision d ON d.id = p.decisionId
        INNER JOIN Market m ON m.id = p.marketId
        WHERE p.actualOutcome IS NULL
          AND p.executionStatus IN ('FILLED', 'PARTIAL')
          AND d.mode = 'PAPER'
          AND m.dataSource = 'REAL'
      `,
      db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(DISTINCT p.marketId) AS count
        FROM PaperBet p
        INNER JOIN Decision d ON d.id = p.decisionId
        INNER JOIN Market m ON m.id = p.marketId
        WHERE p.actualOutcome IS NULL
          AND p.executionStatus IN ('FILLED', 'PARTIAL')
          AND d.mode = 'PAPER'
          AND m.dataSource = 'REAL'
          AND EXISTS (
            SELECT 1
            FROM Job j
            WHERE j.type = 'RESOLUTION_CHECK'
              AND j.status IN ('PENDING', 'RUNNING', 'RETRYING')
              AND (
                j.dedupKey = ('resolution:' || p.marketId)
                OR j.payload LIKE ('%' || p.marketId || '%')
              )
          )
      `,
      db.job.count({
        where: {
          type: 'RESOLUTION_CHECK',
          status: { in: ['PENDING', 'RUNNING', 'RETRYING'] },
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
        },
      }),
      db.job.findFirst({
        where: {
          type: 'RESOLUTION_CHECK',
          status: { in: ['PENDING', 'RUNNING', 'RETRYING'] },
          nextRetryAt: { gt: new Date() },
        },
        orderBy: { nextRetryAt: 'asc' },
        select: {
          id: true,
          status: true,
          nextRetryAt: true,
          dedupKey: true,
          payload: true,
        },
      }),
      db.market.findFirst({
        where: {
          dataSource: 'REAL',
          resolutionTime: { not: null },
          paperBets: {
            some: {
              actualOutcome: null,
              executionStatus: { in: ['FILLED', 'PARTIAL'] },
              decision: { mode: 'PAPER' },
            },
          },
        },
        orderBy: { resolutionTime: 'asc' },
        select: {
          id: true,
          title: true,
          resolutionTime: true,
        },
      }),
      db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM (
          SELECT marketId, predictedSide, COUNT(*) AS c
          FROM PaperBet
          WHERE actualOutcome IS NULL
            AND executionStatus IN ('FILLED', 'PARTIAL')
          GROUP BY marketId, predictedSide
          HAVING c > 1
        )
      `,
      db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count
        FROM (
          SELECT marketId, COUNT(DISTINCT predictedSide) AS c
          FROM PaperBet
          WHERE actualOutcome IS NULL
            AND executionStatus IN ('FILLED', 'PARTIAL')
          GROUP BY marketId
          HAVING c > 1
        )
      `,
    ]);

    const executedUnresolvedPaperBets = Number(executedUnresolvedPaperBetRows[0]?.count ?? 0);
    const executedUnresolvedWithArchivedPrediction = Number(executedUnresolvedWithArchivedPredictionRows[0]?.count ?? 0);
    const executedUnresolvedPaperBetMarkets = Number(executedUnresolvedPaperBetMarketRows[0]?.count ?? 0);
    const activeResolutionJobMarkets = Number(activeResolutionJobMarketRows[0]?.count ?? 0);
    results.paperExposureIntegrity = {
      executedUnresolvedPaperBets,
      executedUnresolvedWithArchivedPrediction,
      missingArchivedPrediction: Math.max(0, executedUnresolvedPaperBets - executedUnresolvedWithArchivedPrediction),
      executedUnresolvedPaperBetMarkets,
      activeResolutionJobMarkets,
      missingResolutionJobs: Math.max(0, executedUnresolvedPaperBetMarkets - activeResolutionJobMarkets),
      dueResolutionJobs: dueResolutionJobRows,
      activeSameSideDuplicateExposures: Number(activeSameSideDuplicateRows[0]?.count ?? 0),
      activeOppositeSideExposures: Number(activeOppositeSideExposureRows[0]?.count ?? 0),
    };
    results.paperSettlementSchedule = {
      activeResolutionJobMarkets,
      executedUnresolvedPaperBetMarkets,
      dueResolutionJobs: dueResolutionJobRows,
      nextMarketResolutionAt: nextExecutedMarketResolution?.resolutionTime?.toISOString() ?? null,
      nextMarketResolution: nextExecutedMarketResolution ? {
        id: nextExecutedMarketResolution.id,
        title: nextExecutedMarketResolution.title,
        resolutionTime: nextExecutedMarketResolution.resolutionTime?.toISOString() ?? null,
      } : null,
      nextResolutionCheckAt: nextResolutionJob?.nextRetryAt?.toISOString() ?? null,
      nextResolutionJob: nextResolutionJob ? {
        id: nextResolutionJob.id,
        status: nextResolutionJob.status,
        dedupKey: nextResolutionJob.dedupKey,
        payload: nextResolutionJob.payload,
      } : null,
    };

    if (results.paperExposureIntegrity.missingArchivedPrediction > 0) {
      errors.push(`Executed paper bets missing archived predictions: ${results.paperExposureIntegrity.missingArchivedPrediction}`);
    }
    if (results.paperExposureIntegrity.missingResolutionJobs > 0) {
      errors.push(`Executed paper bet markets missing active resolution jobs: ${results.paperExposureIntegrity.missingResolutionJobs}`);
    }
    if (executedUnresolvedPaperBetMarkets > 0 && !nextResolutionJob && dueResolutionJobRows === 0) {
      errors.push('Executed unresolved paper bets exist but no future or due resolution job was found');
    }
    if (results.paperExposureIntegrity.activeSameSideDuplicateExposures > 0) {
      errors.push(`Active same-side duplicate paper exposures: ${results.paperExposureIntegrity.activeSameSideDuplicateExposures}`);
    }
    if (results.paperExposureIntegrity.activeOppositeSideExposures > 0) {
      errors.push(`Active opposite-side paper exposures: ${results.paperExposureIntegrity.activeOppositeSideExposures}`);
    }

    // Test 2e: Executed market detail visibility.
    // Every executed PAPER market must have enough persisted artifacts for the
    // detail page to explain why the bet exists: research run summary, source or
    // agent evidence, and at least one durable pipeline milestone.
    console.log('[Verify] Testing executed market detail visibility...');

    const [
      executedMarketDetailCoverageRows,
      executedMarketDetailIssueRows,
    ] = await Promise.all([
      db.$queryRaw<Array<{
        executedMarkets: bigint;
        missingResearchRuns: bigint;
        missingEvidence: bigint;
        missingPipelineMilestones: bigint;
      }>>`
        SELECT
          COUNT(DISTINCT p.marketId) AS executedMarkets,
          COUNT(DISTINCT CASE
            WHEN NOT EXISTS (
              SELECT 1 FROM ResearchRun r WHERE r.marketId = p.marketId
            )
            THEN p.marketId
          END) AS missingResearchRuns,
          COUNT(DISTINCT CASE
            WHEN NOT EXISTS (
              SELECT 1
              FROM ResearchRun r
              JOIN ResearchSource s ON s.researchRunId = r.id
              WHERE r.marketId = p.marketId
            )
            AND NOT EXISTS (
              SELECT 1
              FROM ResearchRun r
              JOIN AgentOutput a ON a.researchRunId = r.id
              WHERE r.marketId = p.marketId
            )
            THEN p.marketId
          END) AS missingEvidence,
          COUNT(DISTINCT CASE
            WHEN NOT EXISTS (SELECT 1 FROM TradeCandidate c WHERE c.marketId = p.marketId)
              AND NOT EXISTS (SELECT 1 FROM Decision d2 WHERE d2.marketId = p.marketId)
              AND NOT EXISTS (SELECT 1 FROM PaperBet p2 WHERE p2.marketId = p.marketId)
            THEN p.marketId
          END) AS missingPipelineMilestones
        FROM PaperBet p
        INNER JOIN Decision d ON d.id = p.decisionId
        INNER JOIN Market m ON m.id = p.marketId
        WHERE p.actualOutcome IS NULL
          AND p.executionStatus IN ('FILLED', 'PARTIAL')
          AND d.mode = 'PAPER'
          AND m.dataSource = 'REAL'
      `,
      db.$queryRaw<Array<{
        marketId: string;
        title: string;
        researchRuns: bigint;
        sources: bigint;
        agentOutputs: bigint;
        candidates: bigint;
        decisions: bigint;
        paperBets: bigint;
      }>>`
        SELECT
          m.id AS marketId,
          m.title AS title,
          COUNT(DISTINCT r.id) AS researchRuns,
          COUNT(DISTINCT s.id) AS sources,
          COUNT(DISTINCT a.id) AS agentOutputs,
          COUNT(DISTINCT c.id) AS candidates,
          COUNT(DISTINCT d2.id) AS decisions,
          COUNT(DISTINCT p2.id) AS paperBets
        FROM PaperBet p
        INNER JOIN Decision d ON d.id = p.decisionId
        INNER JOIN Market m ON m.id = p.marketId
        LEFT JOIN ResearchRun r ON r.marketId = m.id
        LEFT JOIN ResearchSource s ON s.researchRunId = r.id
        LEFT JOIN AgentOutput a ON a.researchRunId = r.id
        LEFT JOIN TradeCandidate c ON c.marketId = m.id
        LEFT JOIN Decision d2 ON d2.marketId = m.id
        LEFT JOIN PaperBet p2 ON p2.marketId = m.id
        WHERE p.actualOutcome IS NULL
          AND p.executionStatus IN ('FILLED', 'PARTIAL')
          AND d.mode = 'PAPER'
          AND m.dataSource = 'REAL'
        GROUP BY m.id, m.title
        HAVING researchRuns = 0
          OR (sources = 0 AND agentOutputs = 0)
          OR (candidates = 0 AND decisions = 0 AND paperBets = 0)
        LIMIT 5
      `,
    ]);

    const executedMarketDetailCoverage = executedMarketDetailCoverageRows[0];
    results.marketDetailVisibility = {
      executedMarkets: Number(executedMarketDetailCoverage?.executedMarkets ?? 0),
      missingResearchRuns: Number(executedMarketDetailCoverage?.missingResearchRuns ?? 0),
      missingEvidence: Number(executedMarketDetailCoverage?.missingEvidence ?? 0),
      missingPipelineMilestones: Number(executedMarketDetailCoverage?.missingPipelineMilestones ?? 0),
      issueSamples: executedMarketDetailIssueRows.map((row) => ({
        marketId: row.marketId,
        title: row.title,
        researchRuns: Number(row.researchRuns),
        sources: Number(row.sources),
        agentOutputs: Number(row.agentOutputs),
        candidates: Number(row.candidates),
        decisions: Number(row.decisions),
        paperBets: Number(row.paperBets),
      })),
    };

    if (results.marketDetailVisibility.missingResearchRuns > 0) {
      errors.push(`Executed paper markets missing detail research runs: ${results.marketDetailVisibility.missingResearchRuns}`);
    }
    if (results.marketDetailVisibility.missingEvidence > 0) {
      errors.push(`Executed paper markets missing detail source/agent evidence: ${results.marketDetailVisibility.missingEvidence}`);
    }
    if (results.marketDetailVisibility.missingPipelineMilestones > 0) {
      errors.push(`Executed paper markets missing detail pipeline milestones: ${results.marketDetailVisibility.missingPipelineMilestones}`);
    }

    // Test 2f: BID decision coverage.
    // A PAPER BID must either create its own PaperBet, explicitly reuse a same-side active
    // exposure, or explicitly block an opposite-side exposure. Silent BID-with-no-order
    // rows are not allowed because they make "no order getting placed" impossible to debug.
    console.log('[Verify] Testing BID decision coverage...');

    const bidDecisionsWithoutDirectBet = await db.decision.findMany({
      where: {
        action: 'BID',
        mode: 'PAPER',
        dataSource: 'REAL',
        paperBet: null,
      },
      select: {
        id: true,
        marketId: true,
        side: true,
        reasonCode: true,
        reason: true,
        market: {
          select: {
            title: true,
            paperBets: {
              where: {
                actualOutcome: null,
                executionStatus: { in: UNRESOLVED_PAPER_BET_STATUSES },
              },
              select: {
                id: true,
                predictedSide: true,
                executionStatus: true,
              },
              orderBy: [{ confidence: 'desc' }, { edge: 'desc' }, { createdAt: 'desc' }],
              take: 1,
            },
          },
        },
      },
      take: 50,
    });

    const uncoveredBidDecisions = bidDecisionsWithoutDirectBet.filter((decision) => {
      const activeBet = decision.market.paperBets[0];
      const decisionSide = decision.side === 'NO' ? 'NO' : 'YES';
      const explicitExposureReason = decision.reasonCode === ACTIVE_OPPOSITE_SIDE_PAPER_BET
        || decision.reasonCode === ACTIVE_SAME_SIDE_PAPER_BET;
      const coveredBySameSideActiveBet = activeBet?.predictedSide === decisionSide
        && (decision.reasonCode == null || decision.reasonCode === ACTIVE_SAME_SIDE_PAPER_BET);
      const coveredByExplicitOppositeBlock = activeBet
        && activeBet.predictedSide !== decisionSide
        && decision.reasonCode === ACTIVE_OPPOSITE_SIDE_PAPER_BET;
      return !(explicitExposureReason || coveredBySameSideActiveBet || coveredByExplicitOppositeBlock);
    });

    results.bidDecisionCoverage = {
      bidDecisionsWithoutDirectBet: bidDecisionsWithoutDirectBet.length,
      uncovered: uncoveredBidDecisions.length,
      samples: uncoveredBidDecisions.slice(0, 5).map((decision) => ({
        id: decision.id,
        marketId: decision.marketId,
        title: decision.market.title,
        side: decision.side,
        reasonCode: decision.reasonCode,
        activeBetId: decision.market.paperBets[0]?.id ?? null,
        activeBetSide: decision.market.paperBets[0]?.predictedSide ?? null,
      })),
    };

    if (uncoveredBidDecisions.length > 0) {
      errors.push(`Uncovered PAPER BID decisions without PaperBet: ${uncoveredBidDecisions.length}`);
    }

    // Test 2g: Active work deduplication.
    // Duplicate active jobs/research runs waste rate limits and make queue pages
    // look noisy or stuck. Completed history can contain repeats; active work cannot.
    console.log('[Verify] Testing active work deduplication...');

    const [
      activeDuplicateJobRows,
      activeDuplicateResearchRows,
    ] = await Promise.all([
      db.$queryRaw<Array<{ workKey: string; type: string; status: string; count: bigint }>>`
        SELECT
          COALESCE(dedupKey, type || ':' || COALESCE(payload, '')) AS workKey,
          type,
          status,
          COUNT(*) AS count
        FROM Job
        WHERE status IN ('PENDING', 'RUNNING', 'RETRYING')
        GROUP BY workKey, type, status
        HAVING COUNT(*) > 1
        LIMIT 10
      `,
      db.$queryRaw<Array<{ marketId: string; status: string; depth: string; count: bigint }>>`
        SELECT
          marketId,
          status,
          depth,
          COUNT(*) AS count
        FROM ResearchRun
        WHERE status IN ('PENDING', 'RUNNING')
        GROUP BY marketId, status, depth
        HAVING COUNT(*) > 1
        LIMIT 10
      `,
    ]);

    results.activeWorkDeduplication = {
      duplicateActiveJobGroups: activeDuplicateJobRows.length,
      duplicateActiveResearchGroups: activeDuplicateResearchRows.length,
      jobSamples: activeDuplicateJobRows.map((row) => ({
        workKey: row.workKey,
        type: row.type,
        status: row.status,
        count: Number(row.count),
      })),
      researchSamples: activeDuplicateResearchRows.map((row) => ({
        marketId: row.marketId,
        status: row.status,
        depth: row.depth,
        count: Number(row.count),
      })),
    };

    if (activeDuplicateJobRows.length > 0) {
      errors.push(`Duplicate active job groups: ${activeDuplicateJobRows.length}`);
    }
    if (activeDuplicateResearchRows.length > 0) {
      errors.push(`Duplicate active research groups: ${activeDuplicateResearchRows.length}`);
    }

    // Test 3: Check provider configurations
    console.log('[Verify] Testing provider configs...');
    const [stageRouting, searchConfig] = await Promise.all([
      getStageRouting(),
      getSearchConfig({}),
    ]);
    
    const configs = {
      deerflow: {
        url: process.env.DEERFLOW_URL,
        configured: Boolean(process.env.DEERFLOW_URL),
        required: false,
      },
      agentReach: {
        url: stageRouting.agentReachServiceUrl || process.env.AGENT_REACH_URL,
        configured: Boolean(stageRouting.agentReachServiceUrl || process.env.AGENT_REACH_URL),
        required: true,
      },
      tradingagents: {
        url: process.env.TRADINGAGENTS_URL || 'http://localhost:6503',
        configured: Boolean(process.env.TRADINGAGENTS_URL || 'http://localhost:6503'),
        required: true,
      },
      searxng: {
        url: searchConfig.baseUrl,
        configured: Boolean(searchConfig.baseUrl),
        required: true,
      },
    };

    results.providerConfigs = configs;

    // Check if all critical providers are configured
    const missingProviders = Object.entries(configs)
      .filter(([, v]) => (v as { configured: boolean; required?: boolean }).required !== false)
      .filter(([, v]) => !(v as { configured: boolean }).configured)
      .map(([k]) => k);

    if (missingProviders.length > 0) {
      errors.push(`Missing provider configs: ${missingProviders.join(', ')}`);
    }

    // Test 4: Check research runs and source counts
    console.log('[Verify] Testing research aggregation...');
    
    const recentResearch = await db.researchRun.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        sources: true,
        agentOutputs: true,
      },
    });

    const researchStats = recentResearch.map(r => ({
      id: r.id,
      createdAt: r.createdAt,
      sourceCount: r.sources.length,
      agentOutputCount: r.agentOutputs.length,
      totalSources: r.sources.length + r.agentOutputs.length,
    }));

    const totalSources = researchStats.reduce((a, r) => a + r.totalSources, 0);
    const blankRuns = researchStats.filter(r => r.totalSources === 0);

    results.researchRuns = {
      recent: researchStats,
      averageSources: researchStats.length > 0 
        ? Math.round(totalSources / researchStats.length)
        : 0,
      blankRuns: blankRuns.length,
    };

    // Check the real app contract: recent research must not be blank.
    // The old 500+ target was stale: SearXNG/Agent-Reach are capped to bounded
    // batches and public engines often rate-limit/CAPTCHA local metasearch.
    const avgSources = results.researchRuns.averageSources as number;
    if (recentResearch.length === 0) {
      errors.push('No research runs captured');
    } else if (blankRuns.length > 0) {
      errors.push(`Blank research runs: ${blankRuns.length}/${researchStats.length}`);
    } else if (avgSources < 10) {
      errors.push(`Low source count: averaging ${avgSources} sources per research (minimum healthy threshold: 10+)`);
    }

    // Final verdict
    const passed = errors.length === 0;

    return NextResponse.json({
      status: passed ? 'passed' : 'failed',
      timestamp: new Date().toISOString(),
      results,
      errors: errors.length > 0 ? errors : undefined,
      recommendations: errors.length > 0 ? [
        '1. Check provider URLs in .env file',
        '2. Ensure all services are running (docker compose ps)',
        '3. Verify network connectivity to providers',
        '4. Check provider logs for errors',
        '5. Run source verification: npm run verify-sources',
      ] : undefined,
    }, { status: passed ? 200 : 500 });

  } catch (error) {
    console.error('[Verify] Error:', error);
    return NextResponse.json({
      status: 'error',
      error: String(error),
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

// Allow manual resolution trigger for testing
export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (body.action === 'trigger_resolution') {
      console.log('[Verify] Manually triggering resolution cycle...');
      const result = await runResolutionCycle();
      
      return NextResponse.json({
        status: 'success',
        action: 'resolution_triggered',
        result,
        timestamp: new Date().toISOString(),
      });
    }

    if (body.action === 'test_outcome_pull') {
      console.log('[Verify] Testing outcome pull for specific market...');
      
      const { marketId } = body;
      if (!marketId) {
        return NextResponse.json({
          status: 'error',
          error: 'marketId required',
        }, { status: 400 });
      }

      const market = await db.market.findUnique({
        where: { id: marketId },
        include: { outcomes: true, decisions: true },
      });

      if (!market) {
        return NextResponse.json({
          status: 'error',
          error: 'Market not found',
        }, { status: 404 });
      }

      // Check if market has dry-run decisions
      const hasDryRun = market.decisions.some(d => d.dryRun);
      
      return NextResponse.json({
        status: 'success',
        market: {
          id: market.id,
          venue: market.venue,
          externalId: market.externalId,
          status: market.status,
          hasDryRunDecisions: hasDryRun,
          outcomeCount: market.outcomes.length,
          outcomes: market.outcomes,
        },
        canPollForResolution: market.status === 'ACTIVE' || market.status === 'CLOSED',
        resolutionPollingEnabled: hasDryRun && market.outcomes.length === 0,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      status: 'error',
      error: 'Unknown action. Use: trigger_resolution, test_outcome_pull',
    }, { status: 400 });

  } catch (error) {
    console.error('[Verify POST] Error:', error);
    return NextResponse.json({
      status: 'error',
      error: String(error),
    }, { status: 500 });
  }
}
