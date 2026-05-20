import { beforeEach, describe, expect, it, mock } from 'bun:test';

const getWorkerStateMock = mock(() => ({
  status: 'RUNNING',
  jobsProcessed: 4,
  errors: 0,
  lastActivity: '2026-05-15T00:00:00.000Z',
  currentJobType: 'SCAN_VENUE',
  error: null,
}));

const startWorkerMock = mock((intervalMs: number) => ({
  status: 'RUNNING',
  intervalMs,
}));

const stopWorkerMock = mock(() => ({
  status: 'STOPPED',
}));

const runWorkerFlowUntilIdleMock = mock(async () => ({
  marketLoop: { scanned: 3, candidatesCreated: 1, candidatesSkipped: 0, jobsCreated: 1 },
  processedJobs: [{ jobId: 'job-1', jobType: 'TRIAGE_MARKET', marketId: 'market-1', status: 'COMPLETED', error: null }],
  jobsProcessed: 1,
  completed: true,
}));

const findUniqueMock = mock(async ({ where }: { where: { key: string } }) => {
  if (where.key === 'strategy_settings') {
    return { key: 'strategy_settings', value: JSON.stringify({ enabledVenues: ['POLYMARKET'] }) };
  }
  if (where.key === 'trading_mode') {
    return { key: 'trading_mode', value: 'PAPER' };
  }
  if (where.key === 'last_scan_time') {
    return { key: 'last_scan_time', value: '2026-05-15T00:01:00.000Z' };
  }
  return null;
});

mock.module('@/lib/db', () => ({
  db: {
    settings: {
      findUnique: findUniqueMock,
    },
  },
}));

mock.module('@/lib/engine/worker', () => ({
  getWorkerState: getWorkerStateMock,
  startWorker: startWorkerMock,
  stopWorker: stopWorkerMock,
  processNextQueuedJobOnce: mock(async () => null),
  runWorkerFlowUntilIdle: runWorkerFlowUntilIdleMock,
}));

describe('market loop route', () => {
  beforeEach(() => {
    getWorkerStateMock.mockClear();
    startWorkerMock.mockClear();
    stopWorkerMock.mockClear();
    runWorkerFlowUntilIdleMock.mockClear();
    findUniqueMock.mockClear();
  });

  it('returns worker state with mode metadata', async () => {
    const { GET } = await import('../../../app/api/trading/market-loop/route');
    const res = await GET();
    const payload = await res.json();

    expect(payload.worker.status).toBe('RUNNING');
    expect(payload.mode).toBe('PAPER');
    expect(payload.lastScanAt).toBe('2026-05-15T00:01:00.000Z');
  });

  it('starts worker using minute interval conversion', async () => {
    const { POST } = await import('../../../app/api/trading/market-loop/route');
    const res = await POST(
      new Request('http://localhost/api/trading/market-loop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', intervalMinutes: 3 }),
      }) as never,
    );
    const payload = await res.json();

    expect(payload.intervalMs).toBe(180000);
    expect(startWorkerMock).toHaveBeenCalledTimes(1);
  });

  it('can run synchronously until the flow completes', async () => {
    const { POST } = await import('../../../app/api/trading/market-loop/route');
    const res = await POST(
      new Request('http://localhost/api/trading/market-loop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', waitUntilComplete: true, maxJobs: 12 }),
      }) as never,
    );
    const payload = await res.json();

    expect(payload.action).toBe('completed');
    expect(payload.completed).toBe(true);
    expect(payload.jobsProcessed).toBe(1);
    expect(runWorkerFlowUntilIdleMock).toHaveBeenCalledWith({
      maxJobs: 12,
      failOnNoWork: true,
    });
  });
});
