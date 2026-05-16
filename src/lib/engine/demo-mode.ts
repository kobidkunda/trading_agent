import type { Venue } from '@/lib/types';

export interface DemoMarketTemplate {
  title: string;
  description: string;
  category: string;
  venue: Venue;
  impliedProbRange: [number, number];
  liquidityRange: [number, number];
  spreadRange: [number, number];
}

export const DEMO_MARKET_TEMPLATES: DemoMarketTemplate[] = [
  { title: 'Will Bitcoin exceed $100,000 by end of 2026?', description: 'Resolves YES if BTC/USD reaches or exceeds $100,000 at any point before January 1, 2027, based on CoinGecko spot price.', category: 'crypto', venue: 'POLYMARKET', impliedProbRange: [0.35, 0.65], liquidityRange: [50000, 500000], spreadRange: [0.01, 0.03] },
  { title: 'Will the Federal Reserve cut rates at the June 2026 meeting?', description: 'Resolves YES if the Federal Open Market Committee lowers the federal funds rate at its June 2026 meeting.', category: 'economics', venue: 'KALSHI', impliedProbRange: [0.2, 0.55], liquidityRange: [30000, 200000], spreadRange: [0.015, 0.04] },
  { title: 'Will an AI model achieve human-level performance on the BAR exam by Q4 2026?', description: 'Resolves YES if any publicly available AI system scores above 90th percentile on a standard administration of the Multistate Bar Examination.', category: 'technology', venue: 'POLYMARKET', impliedProbRange: [0.4, 0.75], liquidityRange: [20000, 150000], spreadRange: [0.02, 0.05] },
  { title: 'Will the Lakers make the NBA playoffs in 2026?', description: 'Resolves YES if the Los Angeles Lakers qualify for the 2026 NBA Playoffs as a top-10 seed in the Western Conference.', category: 'sports', venue: 'KALSHI', impliedProbRange: [0.3, 0.6], liquidityRange: [40000, 300000], spreadRange: [0.01, 0.03] },
  { title: 'Will a Category 5 hurricane make landfall in the US in 2026?', description: 'Resolves YES if the National Hurricane Center confirms a Category 5 hurricane made landfall on the continental United States in 2026.', category: 'weather', venue: 'POLYMARKET', impliedProbRange: [0.1, 0.35], liquidityRange: [10000, 80000], spreadRange: [0.02, 0.06] },
  { title: 'Will the FDA approve a new weight-loss drug class in 2026?', description: 'Resolves YES if the FDA grants approval to any drug in a novel pharmacological class for weight loss indication.', category: 'health', venue: 'POLYMARKET', impliedProbRange: [0.25, 0.55], liquidityRange: [15000, 120000], spreadRange: [0.015, 0.04] },
  { title: 'Will Tesla stock close above $400 by December 2026?', description: 'Resolves YES if TSLA closes at or above $400.00 on any trading day on the NASDAQ before January 1, 2027.', category: 'economics', venue: 'KALSHI', impliedProbRange: [0.15, 0.5], liquidityRange: [60000, 400000], spreadRange: [0.01, 0.025] },
  { title: 'Will a major social media platform launch a decentralized protocol by 2026?', description: 'Resolves YES if a platform with 100M+ monthly active users publicly launches a decentralized social protocol (e.g., ActivityPub, Bluesky AT Protocol).', category: 'technology', venue: 'POLYMARKET', impliedProbRange: [0.2, 0.45], liquidityRange: [8000, 60000], spreadRange: [0.02, 0.05] },
  { title: 'Will there be a new COVID variant designated a Variant of Concern by WHO in 2026?', description: 'Resolves YES if the WHO designates any new SARS-CoV-2 variant as a Variant of Concern (VOC) in 2026.', category: 'health', venue: 'POLYMARKET', impliedProbRange: [0.15, 0.4], liquidityRange: [25000, 180000], spreadRange: [0.01, 0.035] },
  { title: 'Will Ethereum complete the Pectra upgrade successfully by Q2 2026?', description: 'Resolves YES if the Ethereum network successfully completes the Pectra network upgrade without a critical consensus failure.', category: 'crypto', venue: 'POLYMARKET', impliedProbRange: [0.6, 0.85], liquidityRange: [35000, 250000], spreadRange: [0.01, 0.03] },
  { title: 'Will the US GDP growth exceed 3% in Q2 2026?', description: 'Resolves YES if the Bureau of Economic Analysis reports annualized real GDP growth above 3.0% for Q2 2026 in the advance estimate.', category: 'economics', venue: 'KALSHI', impliedProbRange: [0.2, 0.5], liquidityRange: [45000, 350000], spreadRange: [0.01, 0.025] },
  { title: 'Will a team score 100+ points in a single NBA game during the 2026 playoffs?', description: 'Resolves YES if any NBA team scores 100 or more points in a single game during the 2026 NBA Playoffs.', category: 'sports', venue: 'POLYMARKET', impliedProbRange: [0.5, 0.8], liquidityRange: [5000, 40000], spreadRange: [0.03, 0.07] },
  { title: 'Will SpaceX complete a successful Mars cargo mission by 2028?', description: 'Resolves YES if SpaceX successfully lands an uncrewed Starship on Mars and confirms operational status by December 31, 2028.', category: 'science', venue: 'POLYMARKET', impliedProbRange: [0.05, 0.2], liquidityRange: [10000, 90000], spreadRange: [0.02, 0.06] },
  { title: 'Will an Oscar-winning film in 2026 be primarily AI-generated?', description: 'Resolves YES if any film that wins an Academy Award in any category at the 2027 ceremony credits AI as the primary creative tool.', category: 'entertainment', venue: 'POLYMARKET', impliedProbRange: [0.02, 0.15], liquidityRange: [5000, 50000], spreadRange: [0.03, 0.08] },
  { title: 'Will Apple release a foldable iPhone by end of 2026?', description: 'Resolves YES if Apple officially announces and releases a foldable iPhone model for sale to consumers before January 1, 2027.', category: 'technology', venue: 'KALSHI', impliedProbRange: [0.1, 0.3], liquidityRange: [70000, 500000], spreadRange: [0.008, 0.02] },
  { title: 'Will Solana surpass $500 by September 2026?', description: 'Resolves YES if SOL/USD reaches or exceeds $500.00 on any major exchange before October 1, 2026.', category: 'crypto', venue: 'POLYMARKET', impliedProbRange: [0.15, 0.4], liquidityRange: [20000, 180000], spreadRange: [0.015, 0.04] },
  { title: 'Will global temperatures set a new record high in 2026?', description: 'Resolves YES if NASA GISS reports that the annual global mean surface temperature for 2026 is the highest on record.', category: 'science', venue: 'POLYMARKET', impliedProbRange: [0.35, 0.65], liquidityRange: [12000, 80000], spreadRange: [0.02, 0.05] },
  { title: 'Will a sitting US Senator switch parties in 2026?', description: 'Resolves YES if any currently serving US Senator changes their party affiliation during 2026.', category: 'politics', venue: 'KALSHI', impliedProbRange: [0.05, 0.2], liquidityRange: [15000, 100000], spreadRange: [0.02, 0.05] },
  { title: 'Will ChatGPT reach 1 billion monthly active users by 2026?', description: 'Resolves YES if OpenAI announces or a credible third-party reports ChatGPT reaching 1 billion monthly active users.', category: 'technology', venue: 'POLYMARKET', impliedProbRange: [0.25, 0.55], liquidityRange: [30000, 200000], spreadRange: [0.015, 0.035] },
  { title: 'Will the US unemployment rate exceed 5% in 2026?', description: 'Resolves YES if the Bureau of Labor Statistics reports a seasonally adjusted unemployment rate above 5.0% for any month in 2026.', category: 'economics', venue: 'KALSHI', impliedProbRange: [0.15, 0.4], liquidityRange: [40000, 300000], spreadRange: [0.01, 0.025] },
];

export function pickDemoTemplates(venues: Venue[], categories: string[], count: number): DemoMarketTemplate[] {
  let pool = DEMO_MARKET_TEMPLATES.filter(
    (t) => (venues.length === 0 || venues.includes(t.venue)) && (categories.length === 0 || categories.includes(t.category)),
  );

  if (pool.length === 0) {
    pool = DEMO_MARKET_TEMPLATES;
  }

  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}
