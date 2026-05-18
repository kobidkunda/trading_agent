export type PageView =
  | 'strategy'
  | 'credentials'
  | 'triage'
  | 'research'
  | 'prompts'
  | 'simulation'
  | 'live'
  | 'health'
  | 'vectorDb'
  | 'pipelineSettings'
  | 'map'
  | 'researchProvider'
  | 'candidates'
  | 'aPlusSignals'
  | 'calibration'
  | 'risk'
  | 'paperOrders'
  | 'outcomes'
  | 'researchQueue'
  | 'wallets'
  | 'relatedMarkets'
  | 'orderbook'
  | 'paperBets'
  | 'backtests'
  | 'optimizer'
  | 'settings'
  | 'logs';

export interface TradingPageDefinition {
  id: PageView;
  label: string;
  slug: string;
}

export const TRADING_PAGES: TradingPageDefinition[] = [
  { id: 'simulation', label: 'Simulation Lab', slug: 'simulation-lab' },
  { id: 'strategy', label: 'Strategy Hub', slug: 'strategy-hub' },
  { id: 'credentials', label: 'Credentials', slug: 'credentials' },
  { id: 'triage', label: 'Market Triage', slug: 'market-triage' },
  { id: 'candidates', label: 'Candidates', slug: 'candidates' },
  { id: 'aPlusSignals', label: 'A+ Signals', slug: 'a-plus-signals' },
  { id: 'research', label: 'Research Ledger', slug: 'research-ledger' },
  { id: 'researchQueue', label: 'Research Queue', slug: 'research-queue' },
  { id: 'prompts', label: 'Prompt Studio', slug: 'prompt-studio' },
  { id: 'wallets', label: 'Wallets', slug: 'wallets' },
  { id: 'relatedMarkets', label: 'Related Markets', slug: 'related-markets' },
  { id: 'orderbook', label: 'Orderbook', slug: 'orderbook' },
  { id: 'risk', label: 'Risk', slug: 'risk' },
  { id: 'paperOrders', label: 'Paper Orders', slug: 'paper-orders' },
  { id: 'paperBets', label: 'Paper Bets', slug: 'paper-bets' },
  { id: 'outcomes', label: 'Outcomes', slug: 'outcomes' },
  { id: 'calibration', label: 'Calibration', slug: 'calibration' },
  { id: 'backtests', label: 'Backtests', slug: 'backtests' },
  { id: 'optimizer', label: 'Optimizer', slug: 'optimizer' },
  { id: 'live', label: 'Live Status', slug: 'live-status' },
  { id: 'health', label: 'System Health', slug: 'system-health' },
  { id: 'settings', label: 'Settings', slug: 'settings' },
  { id: 'vectorDb', label: 'Vector DB', slug: 'vector-db' },
  { id: 'pipelineSettings', label: 'Pipeline', slug: 'pipeline' },
  { id: 'map', label: 'System Map', slug: 'system-map' },
  { id: 'researchProvider', label: 'Research Provider', slug: 'research-provider' },
  { id: 'logs', label: 'Logs', slug: 'logs' },
];

const PAGE_BY_ID = new Map(TRADING_PAGES.map((page) => [page.id, page] as const));
const PAGE_BY_SLUG = new Map(TRADING_PAGES.map((page) => [page.slug, page] as const));

export function getTradingPageById(pageId: PageView): TradingPageDefinition {
  return PAGE_BY_ID.get(pageId) ?? PAGE_BY_ID.get('simulation')!;
}

export function getTradingPageBySlug(slug: string): TradingPageDefinition | null {
  return PAGE_BY_SLUG.get(slug) ?? null;
}

export function getTradingPageHref(pageId: PageView): string {
  return `/${getTradingPageById(pageId).slug}`;
}
