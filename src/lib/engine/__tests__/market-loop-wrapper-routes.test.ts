import { beforeEach, describe, expect, it, mock } from 'bun:test';

const getWorkerStateMock = mock(() => ({
  status: 'RUNNING',
  jobsProcessed: 2,
  errors: 0,
  lastActivity: '2026-05-15T00:00:00.000Z',
  currentJobType: null,
  error: null,
}));

const startWorkerMock = mock((intervalMs: number) => ({ status: 'RUNNING', intervalMs }));
const stopWorkerMock = mock(() => ({ status: 'STOPPED' }));

const findUniqueMock = mock(async ({ where }: { where: { key: string } }) => {
  if (where.key === 'strategy_settings') {
    return { key: 'strategy_settings', value: JSON.stringify({ enabledVenues: ['POLYMARKET'] }) };
  }
  if (where.key === 'trading_mode') {
    return { key: 'trading_mode', value: 'PAPER' };
  }
  if (where.key === 'last_scan_time') {
    return { key: 'last_scan_time', value: '2026-05-15T00:02:00.000Z' };
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
}));

describe('market loop wrapper routes', () => {
  beforeEach(() => {
    getWorkerStateMock.mockClear();
    startWorkerMock.mockClear();
    stopWorkerMock.mockClear();
    findUniqueMock.mockClear();
  });

  it('returns status via dedicated status route', async () => {
    const { GET } = await import('../../../app/api/trading/market-loop/status/route');
    const res = await GET();
    const payload = await res.json();

    expect(payload.mode).toBe('PAPER');
    expect(payload.worker.status).toBe('RUNNING');
  });

  it('starts loop via dedicated start route', async () => {
    const { POST } = await import('../../../app/api/trading/market-loop/start/route');
    const res = await POST(new Request('http://localhost/api/trading/market-loop/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intervalMinutes: 2 }),
    }) as never);
    const payload = await res.json();

    expect(payload.intervalMs).toBe(120000);
    expect(startWorkerMock).toHaveBeenCalledTimes(1);
  });

  it('stops loop via dedicated stop route', async () => {
    const { POST } = await import('../../../app/api/trading/market-loop/stop/route');
    const res = await POST(new Request('http://localhost/api/trading/market-loop/stop', { method: 'POST' }) as never);
    const payload = await res.json();

    expect(payload.status).toBe('STOPPED');
    expect(stopWorkerMock).toHaveBeenCalledTimes(1);
  });
});
