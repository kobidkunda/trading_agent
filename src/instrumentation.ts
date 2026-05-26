export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.AUTO_START_PIPELINE_WORKER === 'true') {
      const { startWorker } = await import('@/lib/engine/worker');
      const intervalMs = Math.max(1_000, Number(process.env.PIPELINE_WORKER_INTERVAL_MS ?? 5_000));
      console.log(`[Instrumentation] Auto-starting pipeline worker every ${intervalMs}ms`);
      await startWorker(intervalMs).catch((err) => {
        console.error('[Instrumentation] Pipeline worker auto-start failed:', err);
      });
    } else {
      console.log('[Instrumentation] Pipeline worker auto-start disabled');
    }

    if (process.env.AUTO_START_PAPER_ORDER_LOOP === 'true') {
      const { ensurePaperLoopRunning } = await import('@/lib/engine/paper-order-loop');
      console.log('[Instrumentation] Checking for paper loop auto-start...');
      await ensurePaperLoopRunning().catch((err) => {
        console.error('[Instrumentation] Paper loop auto-start failed:', err);
      });
    } else {
      console.log('[Instrumentation] Paper loop auto-start disabled');
    }
  }
}
