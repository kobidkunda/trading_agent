import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

const findFirstMock = mock(async () => null);
const createMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'job-1', ...data }));
const startWorkerMock = mock((intervalMs: number) => ({ status: 'RUNNING', intervalMs }));
const stopWorkerMock = mock(() => ({ status: 'STOPPED' }));
const setTradingModeMock = mock(() => undefined);

mock.module('@/lib/db', () => ({
  db: {
    job: {
      findFirst: findFirstMock,
      create: createMock,
    },
  },
}));

mock.module('@/lib/engine/worker', () => ({
  getWorkerState: () => ({ status: 'STOPPED' }),
  startWorker: startWorkerMock,
  stopWorker: stopWorkerMock,
  processNextQueuedJobOnce: mock(async () => null),
  runWorkerFlowUntilIdle: mock(async () => ({ marketLoop: null, processedJobs: [], jobsProcessed: 0, completed: true })),
}));

mock.module('@/lib/engine/mode', () => ({
  normalizeTradingMode: (mode: string) => mode,
  setTradingMode: setTradingModeMock,
}));

describe('worker control route', () => {
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalBypass = process.env.LOCAL_DEV_AUTH_BYPASS;

  beforeEach(() => {
    env.NODE_ENV = 'production';
    env.LOCAL_DEV_AUTH_BYPASS = 'true';
    findFirstMock.mockClear();
    createMock.mockClear();
    startWorkerMock.mockClear();
    stopWorkerMock.mockClear();
    setTradingModeMock.mockClear();
  });

  it('seeds SCAN_VENUE jobs on start when queue is empty', async () => {
    const { POST } = await import('../../../app/api/jobs/worker/route');
    const res = await POST(
      new Request('http://localhost/api/jobs/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', mode: 'PAPER', intervalMs: 5000 }),
      }) as never,
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.status).toBe('RUNNING');
    expect(setTradingModeMock).toHaveBeenCalledWith('PAPER');
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]?.[0]?.data?.type).toBe('SCAN_VENUE');
  });

  it('requires authentication before controlling the worker', async () => {
    env.LOCAL_DEV_AUTH_BYPASS = 'false';
    const { POST } = await import('../../../app/api/jobs/worker/route');
    const res = await POST(
      new Request('http://localhost/api/jobs/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', mode: 'PAPER', intervalMs: 5000 }),
      }) as never,
    );

    expect(res.status).toBe(401);
    expect(startWorkerMock).toHaveBeenCalledTimes(0);
    expect(createMock).toHaveBeenCalledTimes(0);
  });

  it('rejects legacy dryRun=false live worker starts', async () => {
    const { POST } = await import('../../../app/api/jobs/worker/route');
    const res = await POST(
      new Request('http://localhost/api/jobs/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-role': 'Admin' },
        body: JSON.stringify({ action: 'start', dryRun: false }),
      }) as never,
    );
    const payload = await res.json();

    expect(res.status).toBe(403);
    expect(payload.error).toContain('LIVE worker execution is disabled');
    expect(setTradingModeMock).toHaveBeenCalledTimes(0);
    expect(startWorkerMock).toHaveBeenCalledTimes(0);
    expect(createMock).toHaveBeenCalledTimes(0);
  });

  it('rejects explicit LIVE worker starts', async () => {
    const { POST } = await import('../../../app/api/jobs/worker/route');
    const res = await POST(
      new Request('http://localhost/api/jobs/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-role': 'Admin' },
        body: JSON.stringify({ action: 'start', mode: 'LIVE' }),
      }) as never,
    );

    expect(res.status).toBe(403);
    expect(setTradingModeMock).toHaveBeenCalledTimes(0);
    expect(startWorkerMock).toHaveBeenCalledTimes(0);
    expect(createMock).toHaveBeenCalledTimes(0);
  });

  afterEach(() => {
    env.NODE_ENV = originalNodeEnv;
    env.LOCAL_DEV_AUTH_BYPASS = originalBypass;
  });
});
