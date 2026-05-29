import { describe, expect, it } from 'bun:test';

import {
  TRADING_PAGES,
  getTradingPageBySlug,
  getTradingPageHref,
} from '@/lib/navigation/trading-pages';

describe('navigation live actions', () => {
  it("TRADING_PAGES contains id='liveActions' slug='live-actions'", () => {
    const page = TRADING_PAGES.find((entry) => entry.id === 'liveActions');

    expect(page).toBeDefined();
    expect(page?.slug).toBe('live-actions');
  });

  it("getTradingPageBySlug('live-actions').id === 'liveActions'", () => {
    expect(getTradingPageBySlug('live-actions')?.id).toBe('liveActions');
  });

  it("getTradingPageHref('liveActions') === '/live-actions'", () => {
    expect(getTradingPageHref('liveActions')).toBe('/live-actions');
  });
});
