import { db } from './src/lib/db';

async function check() {
  // Find recent research runs with sources
  const runs = await db.researchRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 3,
    include: { 
      sources: true,
      market: { select: { title: true } }
    }
  });
  
  for (const run of runs) {
    const redditSources = run.sources.filter(s => 
      s.sourceType === 'REDDIT' || s.provider === 'REDDIT'
    );
    console.log(`\n${run.market?.title}:`);
    console.log(`  Total sources: ${run.sources.length}`);
    console.log(`  Reddit sources: ${redditSources.length}`);
    if (redditSources.length > 0) {
      console.log(`  Sample: ${redditSources[0].title?.substring(0, 50)}`);
    }
    
    // Check source types
    const types: Record<string, number> = {};
    for (const s of run.sources) {
      types[s.sourceType || 'null'] = (types[s.sourceType || 'null'] || 0) + 1;
    }
    console.log(`  Types: ${JSON.stringify(types)}`);
  }
  
  await db.$disconnect();
}

check();
