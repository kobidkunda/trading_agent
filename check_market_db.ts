import { db } from './src/lib/db';

async function check() {
  const marketId = 'cmo5kad5g00004tlm72fw92tk';
  
  console.log('Checking market in database...');
  
  const market = await db.market.findUnique({
    where: { id: marketId },
    include: {
      tradeCandidates: true,
      snapshots: { orderBy: { timestamp: 'desc' }, take: 1 },
      researchRuns: { include: { sources: true, agentOutputs: true } },
      decisions: { orderBy: { createdAt: 'desc' }, take: 1 }
    }
  });
  
  if (!market) {
    console.log('Market not found');
    return;
  }
  
  console.log('Market:', {
    title: market.title,
    status: market.status,
    candidateStage: market.tradeCandidates[0]?.stage,
    candidateTriage: market.tradeCandidates[0]?.triageStatus,
    snapshotsCount: market.snapshots.length,
    researchRunsCount: market.researchRuns.length,
    decisionsCount: market.decisions.length
  });
  
  for (const run of market.researchRuns) {
    console.log('Research Run:', {
      id: run.id,
      status: run.status,
      depth: run.depth,
      sourceCount: run.sources.length,
      agentOutputCount: run.agentOutputs.length
    });
  }
  
  await db.$disconnect();
}

check();
