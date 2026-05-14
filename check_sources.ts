import { db } from './src/lib/db';

async function check() {
  const marketId = 'cmo5kad5g00004tlm72fw92tk';
  
  // Find research runs for this market
  const runs = await db.researchRun.findMany({
    where: { marketId },
    include: { sources: true }
  });
  
  console.log(`Found ${runs.length} research runs`);
  for (const run of runs) {
    console.log(`  Run ${run.id}: ${run.sources.length} sources, status: ${run.status}`);
    if (run.sources.length > 0) {
      console.log(`    Sample source: ${run.sources[0].title?.substring(0, 50)}`);
    }
  }
  
  await db.$disconnect();
}

check();
