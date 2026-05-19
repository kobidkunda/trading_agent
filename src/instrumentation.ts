export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { ensurePaperLoopRunning } = await import('@/lib/engine/paper-order-loop');
    console.log('[Instrumentation] Checking for paper loop auto-start...');
    await ensurePaperLoopRunning().catch((err) => {
      console.error('[Instrumentation] Paper loop auto-start failed:', err);
    });
  }
}
