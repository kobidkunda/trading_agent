// ── Seed Script ──────────────────────────────────────────────────────────────
// Populates the database with required credentials and the target market.
// Run with: npx tsx scripts/seed-db.ts
// ─────────────────────────────────────────────────────────────────────────────

import { db } from '@/lib/db';
import { encrypt } from '@/lib/engine/crypto';

async function main() {
  console.log('[Seed] Starting database seed...');

  // ── 1. Create credentials for each service ──────────────────────────────────
  const services = [
    {
      service: 'searxng',
      label: 'SearXNG',
      serviceUrl: process.env.SEARXNG_URL || 'http://localhost:8888',
      encryptedData: encrypt(JSON.stringify({ apiKey: '' })),
    },
    {
      service: 'tradingagents',
      label: 'TradingAgents',
      serviceUrl: process.env.TRADINGAGENTS_URL || 'http://127.0.0.1:6503',
      encryptedData: encrypt(JSON.stringify({ apiKey: '' })),
    },
{
       service: 'agent_reach',
       label: 'Agent-Reach',
       serviceUrl: process.env.AGENT_REACH_URL || 'http://192.168.88.96:7234',
       encryptedData: encrypt(JSON.stringify({ apiKey: process.env.AGENT_REACH_API_KEY || '' })),
     },
    {
      service: 'deerflow',
      label: 'DeerFlow',
      serviceUrl: process.env.DEERFLOW_URL || 'http://192.168.88.97:2026',
      encryptedData: encrypt(JSON.stringify({ apiKey: '' })),
    },
    {
      service: 'qdrant',
      label: 'Qdrant',
      serviceUrl: process.env.QDRANT_URL || 'http://localhost:6333',
      encryptedData: encrypt(JSON.stringify({ apiKey: process.env.QDRANT_API_KEY || 'change-this-qdrant-key' })),
    },
    {
      service: 'openai',
      label: 'OpenAI LLM',
      serviceUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      encryptedData: encrypt(JSON.stringify({ apiKey: process.env.OPENAI_API_KEY || '' })),
    },
    {
      service: 'firecrawl',
      label: 'Firecrawl',
      serviceUrl: '',
      encryptedData: encrypt(JSON.stringify({ apiKey: process.env.FIRECRAWL_API_KEY || '' })),
    },
    {
      service: 'ollama',
      label: 'Ollama',
      serviceUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
      encryptedData: encrypt(JSON.stringify({ apiKey: '' })),
    },
  ];

  for (const svc of services) {
const existing = await db.credential.findFirst({
       where: { service: svc.service },
     });
    if (existing) {
      console.log(`[Seed] Credential "${svc.label}" already exists (id: ${existing.id})`);
      continue;
    }
    const cred = await db.credential.create({ data: svc });
    console.log(`[Seed] Created credential: ${svc.label} (id: ${cred.id})`);
  }

  // ── 2. Create target market if not exists ──────────────────────────────────
  const targetExternalId = 'cmp4f4i35007e4tgk58yw4ywf';
  const existingMarket = await db.market.findFirst({
    where: { externalId: targetExternalId },
  });

  if (existingMarket) {
    console.log(`[Seed] Market "${targetExternalId}" already exists (id: ${existingMarket.id})`);
  } else {
    const market = await db.market.create({
      data: {
        externalId: targetExternalId,
        venue: 'POLYMARKET',
        title: 'Will Bitcoin reach $100,000 by end of 2026?',
        description: 'Resolves YES if BTC/USD reaches or exceeds $100,000 at any point before January 1, 2027.',
        category: 'crypto',
        status: 'ACTIVE',
      },
    });
    console.log(`[Seed] Created market: ${market.title} (id: ${market.id})`);

    // Add initial snapshot
    await db.marketSnapshot.create({
      data: {
        marketId: market.id,
        impliedProb: 0.45,
        liquidity: 500000,
        spread: 0.02,
        volume24h: 100000,
        bestBid: 0.44,
        bestAsk: 0.46,
      },
    });
  }

  // ── 3. Ensure default strategy settings ────────────────────────────────────
  const existingSettings = await db.settings.findUnique({
    where: { key: 'strategy_settings' },
  });

  if (!existingSettings) {
    await db.settings.create({
      data: {
        key: 'strategy_settings',
        value: JSON.stringify({
          enabledVenues: ['POLYMARKET', 'KALSHI'],
          enabledCategories: ['politics', 'sports', 'crypto', 'science', 'entertainment'],
          minLiquidity: 1000,
          targetEdge: 0.05,
          maxSpread: 0.05,
          maxExposurePerMarket: 5000,
          maxDailyExposure: 50000,
          maxCategoryExposure: 10000,
          researchEscalationThreshold: 0.08,
          dryRun: true,
          promptVersion: { triage: 1, bull: 1, bear: 1, contradiction: 1, judge: 1, postmortem: 1 },
          defaultModel: 'paper_lite',
          triageModel: 'paper_prokimi',
          researchModel: 'paper_lite',
          judgeModel: 'paper_proglm',
          stageRouting: {
            searchMaxResults: 50,
            deerflowSearchIterations: 3,
            deerflowQuestionsPerIteration: 5,
            deerflowMaxDepth: 3,
            researchDepth: 'FULL',
            agentReachEnabled: true,
            agentReachServiceUrl: process.env.AGENT_REACH_URL || 'http://192.168.88.96:7234',
            agentReachToolName: 'web_read',
            searchService: undefined,
            researchFallbackProvider: 'firecrawl',
          },
        }),
      },
    });
    console.log('[Seed] Created default strategy settings');
  }

  console.log('[Seed] Database seed complete!');
}

main().catch(console.error);