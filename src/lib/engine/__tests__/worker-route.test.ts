import { beforeEach, describe, expect, it, mock } from 'bun:test';

const findFirstMock = mock(async () => null);
const createMock = mock(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'job-1', ...data }));
const startWorkerMock = mock((intervalMs: number) => ({ status: 'RUNNING', intervalMs }));
const stopWorkerMock = mock(() => ({ status: 'STOPPED' }));

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
}));

mock.module('@/lib/engine/mode', () => ({
  normalizeTradingMode: (mode: string) => mode,
  setTradingMode: () => undefined,
}));

describe('worker control route', () => {
  beforeEach(() => {
    findFirstMock.mockClear();
    createMock.mockClear();
    startWorkerMock.mockClear();
    stopWorkerMock.mockClear();
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
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0]?.[0]?.data?.type).toBe('SCAN_VENUE');
  });
});
