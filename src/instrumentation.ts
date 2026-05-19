export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.AUTO_START_PAPER_ORDER_LOOP !== 'true') {
      console.log('[Instrumentation] Paper loop auto-start disabled');
      return;
    }

    const { ensurePaperLoopRunning } = await import('@/lib/engine/paper-order-loop');
    console.log('[Instrumentation] Checking for paper loop auto-start...');
    await ensurePaperLoopRunning().catch((err) => {
      console.error('[Instrumentation] Paper loop auto-start failed:', err);
    });
  }
}
