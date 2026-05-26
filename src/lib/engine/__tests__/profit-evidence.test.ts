import { describe, expect, it } from 'bun:test';
import { summarizeProfitEvidence } from '../profit-evidence';

describe('profit evidence gate', () => {
  it('reports awaiting resolution instead of treating pending paper bets as zero profit', () => {
    const summary = summarizeProfitEvidence({
      resolvedPaperBets: 0,
      executedUnresolvedPaperBets: 55,
      historicalResolvedMarkets: 50,
      historicalResolvedWithPredictions: 0,
    });

    expect(summary.status).toBe('AWAITING_RESOLUTION');
    expect(summary.canEvaluateProfit).toBe(false);
    expect(summary.reason).toContain('not meaningful until settlement');
    expect(summary.openModelExpectedValue).toBe(0);
  });

  it('allows profit evaluation when at least one resolved paper bet exists', () => {
    const summary = summarizeProfitEvidence({
      resolvedPaperBets: 1,
      executedUnresolvedPaperBets: 0,
      historicalResolvedMarkets: 50,
      historicalResolvedWithPredictions: 0,
    });

    expect(summary.status).toBe('AVAILABLE');
    expect(summary.canEvaluateProfit).toBe(true);
  });

  it('allows profit evaluation when historical outcomes overlap archived predictions', () => {
    const summary = summarizeProfitEvidence({
      resolvedPaperBets: 0,
      executedUnresolvedPaperBets: 0,
      historicalResolvedMarkets: 50,
      historicalResolvedWithPredictions: 3,
    });

    expect(summary.status).toBe('AVAILABLE');
    expect(summary.canEvaluateProfit).toBe(true);
  });

  it('includes open expected-value metrics without treating them as realized profit', () => {
    const summary = summarizeProfitEvidence({
      resolvedPaperBets: 0,
      executedUnresolvedPaperBets: 2,
      historicalResolvedMarkets: 0,
      historicalResolvedWithPredictions: 0,
      openPaperStake: 100,
      openModelExpectedValue: 12.345,
      openModelExpectedRoi: 0.12345,
      openPositiveEvBets: 2,
      openNegativeEvBets: 0,
      openAverageEdge: 0.0617,
    });

    expect(summary.status).toBe('AWAITING_RESOLUTION');
    expect(summary.canEvaluateProfit).toBe(false);
    expect(summary.openModelExpectedValue).toBe(12.35);
    expect(summary.openModelExpectedRoi).toBe(0.1235);
    expect(summary.reason).toContain('positive expected value');
  });
});
