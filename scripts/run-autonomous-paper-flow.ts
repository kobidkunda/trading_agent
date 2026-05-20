import { db } from '@/lib/db';
import { runAutonomousPaperFlowUntilOrder } from '@/lib/engine/autonomous-paper-flow';

function numberArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  if (!arg) return fallback;
  const parsed = Number(arg.slice(prefix.length));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function main() {
  const maxCandidates = numberArg('max-candidates', 8);

  const result = await runAutonomousPaperFlowUntilOrder({
    maxCandidates,
    researchDepth: 'STANDARD',
    fillAfterOrder: true,
    onEvent: (event) => {
      const type = event.type ? `${event.type}:` : '';
      const market = event.marketId ? ` market=${event.marketId}` : '';
      const provider = event.serviceName ? ` service=${event.serviceName}` : '';
      console.log(`[${event.stage}]${market}${provider} ${type}${event.message}`);
    },
  });

  console.log('AUTONOMOUS_PAPER_FLOW_PROOF');
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error('AUTONOMOUS_PAPER_FLOW_FAILED');
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
