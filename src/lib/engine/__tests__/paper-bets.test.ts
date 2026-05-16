import { describe, expect, it } from 'bun:test';

import { scorePaperBet } from '../paper-bets';

describe('paper bet scoring', () => {
  it('scores YES and NO outcomes with brier and pnl math', () => {
    const yesCorrect = scorePaperBet(0.8, 'YES', 0.65, 100, 'YES');
    expect(yesCorrect.directionCorrect).toBe(true);
    expect(yesCorrect.brierScore).toBeCloseTo(0.04, 3);
    expect(yesCorrect.probError).toBeCloseTo(0.2, 3);
    expect(yesCorrect.pnl).toBeCloseTo(35, 2);

    const yesWrong = scorePaperBet(0.7, 'YES', 0.65, 100, 'NO');
    expect(yesWrong.directionCorrect).toBe(false);
    expect(yesWrong.brierScore).toBeCloseTo(0.49, 3);
    expect(yesWrong.pnl).toBeCloseTo(-65, 2);

    const noCorrect = scorePaperBet(0.3, 'NO', 0.35, 100, 'NO');
    expect(noCorrect.directionCorrect).toBe(true);
    expect(noCorrect.brierScore).toBeCloseTo(0.09, 3);
    expect(noCorrect.pnl).toBeCloseTo(35, 2);

    const noWrong = scorePaperBet(0.3, 'NO', 0.35, 100, 'YES');
    expect(noWrong.directionCorrect).toBe(false);
    expect(noWrong.pnl).toBeCloseTo(-65, 2);
  });

  it('handles cancelled markets and brier bounds', () => {
    const cancelled = scorePaperBet(0.6, 'YES', 0.5, 100, 'CANCELLED');
    expect(cancelled.directionCorrect).toBe(false);
    expect(cancelled.pnl).toBe(0);

    const perfect = scorePaperBet(1, 'YES', 0.5, 100, 'YES');
    expect(perfect.brierScore).toBe(0);

    const worst = scorePaperBet(1, 'YES', 0.5, 100, 'NO');
    expect(worst.brierScore).toBe(1);
  });

  it('keeps pnl conventions aligned for YES buys and NO sells', () => {
    const yesBuy = scorePaperBet(0.75, 'YES', 0.6, 100, 'YES');
    expect(yesBuy.pnl).toBeCloseTo(40, 2);

    const yesBuyNo = scorePaperBet(0.75, 'YES', 0.6, 100, 'NO');
    expect(yesBuyNo.pnl).toBeCloseTo(-60, 2);

    const noSell = scorePaperBet(0.25, 'NO', 0.4, 100, 'NO');
    expect(noSell.pnl).toBeCloseTo(40, 2);

    const noSellYes = scorePaperBet(0.25, 'NO', 0.4, 100, 'YES');
    expect(noSellYes.pnl).toBeCloseTo(-60, 2);
  });
});
