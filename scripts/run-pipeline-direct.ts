// Direct pipeline invocation script for target market
// Bypasses HTTP auth issues by importing pipeline function directly

const path = require('path');

// Set up module resolution
const tsconfigPaths = require('tsconfig-paths');
const tsconfig = require(path.join(process.cwd(), 'tsconfig.json'));

// Register tsconfig paths
if (tsconfig.compilerOptions && tsconfig.compilerOptions.paths) {
  tsconfigPaths.register({
    baseUrl: tsconfig.compilerOptions.baseUrl || './',
    paths: tsconfig.compilerOptions.paths,
  });
}

// Set up environment
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set in .env');
}
process.env.SEARXNG_URL ||= 'http://localhost:8888';
process.env.DEERFLOW_URL ||= 'http://localhost:2026';
process.env.TRADINGAGENTS_URL ||= 'http://localhost:6503';
process.env.AGENT_REACH_URL ||= 'http://localhost:6504';
process.env.OPENAI_BASE_URL ||= 'http://localhost:4444/v1';
process.env.NEXT_PUBLIC_API_URL ||= 'http://localhost:5555';
process.env.DEFAULT_MODEL ||= 'paper_lite';

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY must be set in the environment before running the direct pipeline script');
}

// Transpile TypeScript on the fly
require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'commonjs',
    moduleResolution: 'bundler',
    esModuleInterop: true,
    target: 'ES2022',
    resolveJsonModule: true,
    isolatedModules: true,
  },
});

async function main() {
  const { runPipelineForMarket } = require('./src/lib/engine/pipeline');
  const { db } = require('./src/lib/db');

  console.log('=== Direct Pipeline Invocation ===');

  // Check if market exists
  const market = await db.market.findUnique({
    where: { id: 'cmp4f4i35007e4tgk58yw4ywf' },
    include: {
      snapshots: { orderBy: { timestamp: 'desc' }, take: 1 },
      researchRuns: { orderBy: { startedAt: 'desc' }, take: 1 },
    },
  });

  if (!market) {
    console.error('Market not found!');
    process.exit(1);
  }

  console.log(`Market: ${market.title}`);
  console.log(`Venue: ${market.venue}`);
  console.log(`Category: ${market.category}`);
  console.log(`Existing research runs: ${market.researchRuns.length}`);
  console.log(`Existing snapshots: ${market.snapshots.length}`);

  // Count existing sources
  const totalSources = await db.researchSource.count({
    where: { researchRun: { marketId: 'cmp4f4i35007e4tgk58yw4ywf' } }
  });
  console.log(`Existing research sources for this market: ${totalSources}`);

  // Run pipeline
  console.log('\n=== Starting Pipeline ===');
  const start = Date.now();

  try {
    const result = await runPipelineForMarket('cmp4f4i35007e4tgk58yw4ywf', {
      onStage: (event) => {
        console.log(`[${event.stage}] ${event.message}`, event.provider ? `(${event.provider})` : '');
      }
    });

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n=== Pipeline completed in ${elapsed}s ===`);
    console.log('Stages:', result.stages.join(' → '));
    console.log('Triage:', result.triageStatus);
    console.log('Error:', result.error || 'none');
    console.log('Risk Action:', result.riskAction || 'pending');

    // Count sources after pipeline
    const newTotalSources = await db.researchSource.count({
      where: { researchRun: { marketId: 'cmp4f4i35007e4tgk58yw4ywf' } }
    });
    console.log(`\nTotal research sources after pipeline: ${newTotalSources}`);
    console.log(`New sources added: ${newTotalSources - totalSources}`);

    // Get detailed source breakdown
    const sources = await db.researchSource.findMany({
      where: { researchRun: { marketId: 'cmp4f4i35007e4tgk58yw4ywf' } },
      select: { id: true, sourceType: true, provider: true, url: true }
    });

    const byType = {};
    const byProvider = {};
    for (const s of sources) {
      byType[s.sourceType] = (byType[s.sourceType] || 0) + 1;
      byProvider[s.provider || 'unknown'] = (byProvider[s.provider || 'unknown'] || 0) + 1;
    }
    console.log('\nSources by type:', JSON.stringify(byType, null, 2));
    console.log('Sources by provider:', JSON.stringify(byProvider, null, 2));

  } catch (e) {
    console.error('Pipeline failed:', e);
    process.exit(1);
  }

  await db.$disconnect();
  console.log('\nDone.');
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
