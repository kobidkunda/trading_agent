import { scorePaperBet, type PaperBetScore } from './paper-bets';

const passed: string[] = [];
const failed: string[] = [];

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    passed.push(name);
  } else {
    failed.push(`${name}${detail ? `: ${detail}` : ''}`);
  }
}

function testScorePaperBet() {
  // Test 1: Correct YES prediction, market resolves YES
  const yesCorrect = scorePaperBet(0.8, 'YES', 0.65, 100, 'YES');
  assert(yesCorrect.directionCorrect === true, 'YES prediction correct direction');
  assert(Math.abs(yesCorrect.brierScore - 0.04) < 0.001, 'YES correct Brier score', `got ${yesCorrect.brierScore}`);
  assert(Math.abs(yesCorrect.probError - 0.2) < 0.001, 'YES correct prob error');
  assert(Math.abs(yesCorrect.pnl - 35) < 0.01, 'YES correct PnL', `got ${yesCorrect.pnl}`); // (1-0.65)*100

  // Test 2: Wrong YES prediction, market resolves NO
  const yesWrong = scorePaperBet(0.7, 'YES', 0.65, 100, 'NO');
  assert(yesWrong.directionCorrect === false, 'YES prediction wrong direction');
  assert(Math.abs(yesWrong.brierScore - 0.49) < 0.001, 'YES wrong Brier score', `got ${yesWrong.brierScore}`); // (0.7-0)^2 = 0.49
  assert(Math.abs(yesWrong.pnl - (-65)) < 0.01, 'YES wrong PnL', `got ${yesWrong.pnl}`); // -0.65*100

  // Test 3: Correct NO prediction, market resolves NO
  const noCorrect = scorePaperBet(0.3, 'NO', 0.35, 100, 'NO');
  assert(noCorrect.directionCorrect === true, 'NO prediction correct direction');
  assert(Math.abs(noCorrect.brierScore - 0.09) < 0.001, 'NO correct Brier score', `got ${noCorrect.brierScore}`); // (0.3-0)^2 = 0.09
  assert(Math.abs(noCorrect.pnl - 35) < 0.01, 'NO correct PnL', `got ${noCorrect.pnl}`); // 0.35*100 (entry price is 1-0.65=0.35, no side: entryPrice*stake)

  // Test 4: Wrong NO prediction, market resolves YES
  const noWrong = scorePaperBet(0.3, 'NO', 0.35, 100, 'YES');
  assert(noWrong.directionCorrect === false, 'NO prediction wrong direction');
  assert(Math.abs(noWrong.pnl - (-65)) < 0.01, 'NO wrong PnL', `got ${noWrong.pnl}`); // -(1-entryPrice)*stake = -0.65*100

  // Test 5: Cancelled market
  const cancelled = scorePaperBet(0.6, 'YES', 0.5, 100, 'CANCELLED');
  assert(cancelled.directionCorrect === false, 'Cancelled is not correct');
  assert(cancelled.pnl === 0, 'Cancelled PnL is 0');

  // Test 6: High confidence correct prediction
  const highConf = scorePaperBet(0.95, 'YES', 0.80, 200, 'YES');
  assert(highConf.directionCorrect === true, 'High confidence correct');
  assert(Math.abs(highConf.brierScore - 0.0025) < 0.001, 'High confidence Brier', `got ${highConf.brierScore}`); // (0.95-1)^2 = 0.0025
  assert(Math.abs(highConf.pnl - 40) < 0.01, 'High confidence PnL', `got ${highConf.pnl}`); // (1-0.80)*200

  // Test 7: Low confidence prediction still correct direction
  const lowConf = scorePaperBet(0.52, 'YES', 0.50, 100, 'YES');
  assert(lowConf.directionCorrect === true, 'Low conf correct direction');
  assert(lowConf.brierScore > 0.2, 'Low conf high Brier', `got ${lowConf.brierScore}`); // (0.52-1)^2 = 0.2304

  // Test 8: Probability calibration — 0.5 prediction is worst Brier
  const half = scorePaperBet(0.5, 'YES', 0.5, 100, 'YES');
  assert(Math.abs(half.brierScore - 0.25) < 0.001, '0.5 Brier score', `got ${half.brierScore}`); // (0.5-1)^2 = 0.25
}

function testBrierScoreBounds() {
  // Brier score for perfect prediction
  const perfect = scorePaperBet(1.0, 'YES', 0.5, 100, 'YES');
  assert(perfect.brierScore === 0, 'Perfect prediction Brier = 0');

  // Brier score for worst prediction
  const worst = scorePaperBet(1.0, 'YES', 0.5, 100, 'NO');
  assert(worst.brierScore === 1, 'Worst prediction Brier = 1');
}

function testPnLCalculation() {
  // YES side: buy at 0.60, market resolves YES → profit = (1-0.60)*stake = 0.40*100 = 40
  const yesBuy = scorePaperBet(0.75, 'YES', 0.60, 100, 'YES');
  assert(Math.abs(yesBuy.pnl - 40) < 0.01, 'YES buy PnL', `got ${yesBuy.pnl}`);

  // YES side: buy at 0.60, market resolves NO → loss = -0.60*stake = -60
  const yesBuyNo = scorePaperBet(0.75, 'YES', 0.60, 100, 'NO');
  assert(Math.abs(yesBuyNo.pnl - (-60)) < 0.01, 'YES buy NO resolve PnL', `got ${yesBuyNo.pnl}`);

  // NO side: sell at 0.40 (entry price = 1-0.60), market resolves NO → profit = 0.40*100 = 40
  const noSell = scorePaperBet(0.25, 'NO', 0.40, 100, 'NO');
  assert(Math.abs(noSell.pnl - 40) < 0.01, 'NO sell PnL', `got ${noSell.pnl}`);

  // NO side: sell at 0.40, market resolves YES → loss = -(1-0.40)*100 = -60
  const noSellYes = scorePaperBet(0.25, 'NO', 0.40, 100, 'YES');
  assert(Math.abs(noSellYes.pnl - (-60)) < 0.01, 'NO sell YES resolve PnL', `got ${noSellYes.pnl}`);
}

// Run all tests
testScorePaperBet();
testBrierScoreBounds();
testPnLCalculation();

console.log('\n=== Paper Bet Scoring Tests ===');
console.log(`Passed: ${passed.length}`);
console.log(`Failed: ${failed.length}`);

if (failed.length > 0) {
  console.log('\nFailed tests:');
  failed.forEach((f) => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('\nAll tests passed!');
  process.exit(0);
}