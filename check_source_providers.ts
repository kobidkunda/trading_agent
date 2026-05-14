import { db } from './src/lib/db';

async function check() {
  const marketId = 'cmo5kad5g00004tlm72fw92tk';
  
  const runs = await db.researchRun.findMany({
    where: { marketId },
    include: { sources: true }
  });
  
  console.log(`Found ${runs.length} research runs`);
  for (const run of runs) {
    console.log(`\nRun ${run.id}:`);
    console.log(`  Total sources: ${run.sources.length}`);
    
    // Group by provider and sourceType
    const byProvider: Record<string, number> = {};
    const bySourceType: Record<string, number> = {};
    
    for (const source of run.sources) {
      byProvider[source.provider || 'null'] = (byProvider[source.provider || 'null'] || 0) + 1;
      bySourceType[source.sourceType || 'null'] = (bySourceType[source.sourceType || 'null'] || 0) + 1;
    }
    
    console.log('  By provider:', byProvider);
    console.log('  By sourceType:', bySourceType);
    
    // Show sample sources
    if (run.sources.length > 0) {
      console.log('  Sample sources:');
      for (const source of run.sources.slice(0, 3)) {
        console.log(`    - ${source.title?.substring(0, 40)} (provider: ${source.provider}, type: ${source.sourceType})`);
      }
    }
  }
  
  await db.$disconnect();
}

check();
