import { db } from '@/lib/db';
import { PAPER_LOOP_TEST_MARKET_EXTERNAL_ID, PAPER_LOOP_TEST_MARKET_TITLE } from './paper-loop-test-market';

export type ProfitEvidenceStatus = 'AVAILABLE' | 'AWAITING_RESOLUTION' | 'UNAVAILABLE';

export interface ProfitEvidenceCounts {
  resolvedPaperBets: number;
  executedUnresolvedPaperBets: number;
  historicalResolvedMarkets: number;
  historicalResolvedWithPredictions: number;
  openPaperStake?: number;
  openModelExpectedValue?: number;
  openModelExpectedRoi?: number | null;
  openPositiveEvBets?: number;
  openNegativeEvBets?: number;
  openAverageEdge?: number | null;
}

export interface ProfitEvidenceSummary extends ProfitEvidenceCounts {
  openPaperStake: number;
  openModelExpectedValue: number;
  openModelExpectedRoi: number | null;
  openPositiveEvBets: number;
  openNegativeEvBets: number;
  openAverageEdge: number | null;
  status: ProfitEvidenceStatus;
  canEvaluateProfit: boolean;
  reason: string;
}

export interface PaperSettlementReadiness {
  executedUnresolvedPaperBets: number;
  executedUnresolvedWithArchivedPrediction: number;
  missingArchivedPrediction: number;
  executedUnresolvedPaperBetMarkets: number;
  activeResolutionJobMarkets: number;
  missingResolutionJobs: number;
  dueResolutionJobs: number;
  nextResolutionAt: string | null;
  nextResolutionMarket: { id: string; title: string } | null;
}

function withOpenMetrics(counts: ProfitEvidenceCounts) {
  return {
    ...counts,
    openPaperStake: Math.round((counts.openPaperStake ?? 0) * 100) / 100,
    openModelExpectedValue: Math.round((counts.openModelExpectedValue ?? 0) * 100) / 100,
    openModelExpectedRoi: counts.openModelExpectedRoi == null
      ? null
      : Math.round(counts.openModelExpectedRoi * 10000) / 10000,
    openPositiveEvBets: counts.openPositiveEvBets ?? 0,
    openNegativeEvBets: counts.openNegativeEvBets ?? 0,
    openAverageEdge: counts.openAverageEdge == null
      ? null
      : Math.round(counts.openAverageEdge * 10000) / 10000,
  };
}

export function summarizeProfitEvidence(counts: ProfitEvidenceCounts): ProfitEvidenceSummary {
  const normalizedCounts = withOpenMetrics(counts);
  if (counts.resolvedPaperBets > 0 || counts.historicalResolvedWithPredictions > 0) {
    return {
      ...normalizedCounts,
      status: 'AVAILABLE',
      canEvaluateProfit: true,
      reason: 'Profit evidence is available from resolved paper bets or historical markets that also have archived predictions.',
    };
  }

  if (counts.executedUnresolvedPaperBets > 0) {
    return {
      ...normalizedCounts,
      status: 'AWAITING_RESOLUTION',
      canEvaluateProfit: false,
      reason: normalizedCounts.openModelExpectedValue > 0
        ? 'Paper bets have been placed with real data and are positive expected value by stored model probabilities, but none have resolved yet. ROI/PnL is not meaningful until settlement.'
        : 'Paper bets have been placed with real data, but none have resolved yet. ROI/PnL is not meaningful until settlement.',
    };
  }

  return {
    ...normalizedCounts,
    status: 'UNAVAILABLE',
    canEvaluateProfit: false,
    reason: 'No resolved paper bets and no historical resolved markets with archived predictions were found. ROI/PnL cannot be evaluated yet.',
  };
}

export async function getProfitEvidenceSummary(): Promise<ProfitEvidenceSummary> {
  const [
    resolvedPaperBets,
    executedUnresolvedPaperBets,
    openPaperBets,
    historicalResolvedRows,
    historicalResolvedWithPredictionsRows,
  ] = await Promise.all([
    db.paperBet.count({
      where: {
        actualOutcome: { in: ['YES', 'NO'] },
        market: {
          dataSource: 'REAL',
          externalId: { not: PAPER_LOOP_TEST_MARKET_EXTERNAL_ID },
          title: { not: PAPER_LOOP_TEST_MARKET_TITLE },
        },
        decision: { mode: 'PAPER' },
      },
    }),
    db.paperBet.count({
      where: {
        actualOutcome: null,
        executionStatus: { in: ['PARTIAL', 'FILLED'] },
        market: {
          dataSource: 'REAL',
          externalId: { not: PAPER_LOOP_TEST_MARKET_EXTERNAL_ID },
          title: { not: PAPER_LOOP_TEST_MARKET_TITLE },
        },
        decision: { mode: 'PAPER' },
      },
    }),
    db.paperBet.findMany({
      where: {
        actualOutcome: null,
        executionStatus: { in: ['PARTIAL', 'FILLED'] },
        market: {
          dataSource: 'REAL',
          externalId: { not: PAPER_LOOP_TEST_MARKET_EXTERNAL_ID },
          title: { not: PAPER_LOOP_TEST_MARKET_TITLE },
        },
        decision: { mode: 'PAPER' },
      },
      select: {
        predictedSide: true,
        predictedProb: true,
        entryPrice: true,
        stake: true,
        edge: true,
      },
    }),
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT h.marketId) AS count
      FROM HistoricalSnapshot h
      INNER JOIN Outcome o ON o.marketId = h.marketId
      WHERE o.result IN ('YES', 'NO')
    `,
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT h.marketId) AS count
      FROM HistoricalSnapshot h
      INNER JOIN Outcome o ON o.marketId = h.marketId
      WHERE o.result IN ('YES', 'NO')
        AND h.predictedProb IS NOT NULL
    `,
  ]);

  return summarizeProfitEvidence({
    resolvedPaperBets,
    executedUnresolvedPaperBets,
    historicalResolvedMarkets: Number(historicalResolvedRows[0]?.count ?? 0),
    historicalResolvedWithPredictions: Number(historicalResolvedWithPredictionsRows[0]?.count ?? 0),
    openPaperStake: openPaperBets.reduce((sum, bet) => sum + bet.stake, 0),
    openModelExpectedValue: openPaperBets.reduce((sum, bet) => {
      const sideProbability = bet.predictedSide === 'NO' ? 1 - bet.predictedProb : bet.predictedProb;
      return sum + ((sideProbability - bet.entryPrice) * bet.stake);
    }, 0),
    openModelExpectedRoi: (() => {
      const stake = openPaperBets.reduce((sum, bet) => sum + bet.stake, 0);
      if (stake <= 0) return null;
      const expectedValue = openPaperBets.reduce((sum, bet) => {
        const sideProbability = bet.predictedSide === 'NO' ? 1 - bet.predictedProb : bet.predictedProb;
        return sum + ((sideProbability - bet.entryPrice) * bet.stake);
      }, 0);
      return expectedValue / stake;
    })(),
    openPositiveEvBets: openPaperBets.filter((bet) => {
      const sideProbability = bet.predictedSide === 'NO' ? 1 - bet.predictedProb : bet.predictedProb;
      return sideProbability > bet.entryPrice;
    }).length,
    openNegativeEvBets: openPaperBets.filter((bet) => {
      const sideProbability = bet.predictedSide === 'NO' ? 1 - bet.predictedProb : bet.predictedProb;
      return sideProbability < bet.entryPrice;
    }).length,
    openAverageEdge: openPaperBets.length > 0
      ? openPaperBets.reduce((sum, bet) => sum + bet.edge, 0) / openPaperBets.length
      : null,
  });
}

export async function getPaperSettlementReadiness(now = new Date()): Promise<PaperSettlementReadiness> {
  const [
    executedUnresolvedPaperBetRows,
    executedUnresolvedWithArchivedPredictionRows,
    executedUnresolvedPaperBetMarketRows,
    activeResolutionJobMarketRows,
    dueResolutionJobs,
    nextResolutionMarket,
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
        AND m.externalId != ${PAPER_LOOP_TEST_MARKET_EXTERNAL_ID}
        AND m.title != ${PAPER_LOOP_TEST_MARKET_TITLE}
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
        AND m.externalId != ${PAPER_LOOP_TEST_MARKET_EXTERNAL_ID}
        AND m.title != ${PAPER_LOOP_TEST_MARKET_TITLE}
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
        AND m.externalId != ${PAPER_LOOP_TEST_MARKET_EXTERNAL_ID}
        AND m.title != ${PAPER_LOOP_TEST_MARKET_TITLE}
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
        AND m.externalId != ${PAPER_LOOP_TEST_MARKET_EXTERNAL_ID}
        AND m.title != ${PAPER_LOOP_TEST_MARKET_TITLE}
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
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
    }),
    db.market.findFirst({
      where: {
        dataSource: 'REAL',
        externalId: { not: PAPER_LOOP_TEST_MARKET_EXTERNAL_ID },
        title: { not: PAPER_LOOP_TEST_MARKET_TITLE },
        outcomes: { none: {} },
        resolutionTime: { gt: now },
        paperBets: {
          some: {
            actualOutcome: null,
            executionStatus: { in: ['FILLED', 'PARTIAL'] },
            decision: { mode: 'PAPER' },
          },
        },
      },
      select: { id: true, title: true, resolutionTime: true },
      orderBy: { resolutionTime: 'asc' },
    }),
  ]);
  const executedUnresolvedPaperBets = Number(executedUnresolvedPaperBetRows[0]?.count ?? 0);
  const executedUnresolvedWithArchivedPrediction = Number(executedUnresolvedWithArchivedPredictionRows[0]?.count ?? 0);
  const executedUnresolvedPaperBetMarkets = Number(executedUnresolvedPaperBetMarketRows[0]?.count ?? 0);
  const activeResolutionJobMarkets = Number(activeResolutionJobMarketRows[0]?.count ?? 0);

  return {
    executedUnresolvedPaperBets,
    executedUnresolvedWithArchivedPrediction,
    missingArchivedPrediction: Math.max(0, executedUnresolvedPaperBets - executedUnresolvedWithArchivedPrediction),
    executedUnresolvedPaperBetMarkets,
    activeResolutionJobMarkets,
    missingResolutionJobs: Math.max(0, executedUnresolvedPaperBetMarkets - activeResolutionJobMarkets),
    dueResolutionJobs,
    nextResolutionAt: nextResolutionMarket?.resolutionTime?.toISOString() ?? null,
    nextResolutionMarket: nextResolutionMarket
      ? { id: nextResolutionMarket.id, title: nextResolutionMarket.title }
      : null,
  };
}
