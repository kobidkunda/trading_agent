import { describe, expect, it, mock } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

mock.module('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => '/live-actions',
}));

describe('shell live actions page', () => {
  it('renders live actions heading when initialPage is liveActions', async () => {
    const { TradingCommandCenterShell } = await import('@/components/trading-shell/TradingCommandCenterShell');
    const html = renderToStaticMarkup(<TradingCommandCenterShell initialPage="liveActions" />);
    expect(html).toContain('Live Actions');
  });
});
