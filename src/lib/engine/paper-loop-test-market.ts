export const PAPER_LOOP_TEST_MARKET_EXTERNAL_ID = 'PAPER_TEST_MARKET';
export const PAPER_LOOP_TEST_MARKET_TITLE = 'Test V2: Paper Orders should work in paper mode';

export function isPaperLoopTestMarket(params: {
  externalId?: string | null;
  title?: string | null;
  venue?: string | null;
  category?: string | null;
}): boolean {
  return params.externalId === PAPER_LOOP_TEST_MARKET_EXTERNAL_ID
    || params.title === PAPER_LOOP_TEST_MARKET_TITLE
    || (params.venue === 'PAPER' && params.category === 'test');
}

export function isPaperLoopTestMarketTitle(title?: string | null): boolean {
  return title === PAPER_LOOP_TEST_MARKET_TITLE;
}
