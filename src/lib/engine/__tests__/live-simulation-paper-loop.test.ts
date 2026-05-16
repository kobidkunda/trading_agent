import { beforeEach, describe, expect, it, mock } from 'bun:test';

const findUniqueMock = mock(async ({ where }: { where: { key: string } }) => {
  if (where.key === 'trading_mode') {
    return { key: 'trading_mode', value: 'PAPER' };
  }

  return null;
});

const marketLoopMock = mock(async () => ({
  scanned: 3,
  candidatesCreated: 1,
  candidatesSkipped: 0,
  jobsCreated: 1,
  mode: 'PAPER',
}));

const processNextQueuedJobOnceMock = mock(async () => ({
  jobId: 'job-1',
  jobType: 'TRIAGE_MARKET',
  marketId: 'market-1',
  status: 'COMPLETED' as const,
  error: null,
}));

const resolutionCycleMock = mock(async () => ({
  checked: 0,
  resolved: 0,
  scored: 0,
  results: [],
}));

const scannerMock = mock(async () => ({
  totalScanned: 99,
  totalNew: 50,
}));

const countMock = mock(async () => 0);
const findManyOrdersMock = mock(async () => []);
const findUniqueMarketMock = mock(async () => ({ title: 'Test market' }));

mock.module('@/lib/db', () => ({
  db: {
    settings: {
      findUnique: findUniqueMock,
    },
    market: {
      findUnique: findUniqueMarketMock,
    },
    order: {
      findMany: findManyOrdersMock,
    },
    paperBet: {
      count: countMock,
    },
  },
}));

mock.module('@/lib/engine/market-loop', () => ({
  runMarketLoopOnce: marketLoopMock,
}));

mock.module('@/lib/engine/worker', () => ({
  processNextQueuedJobOnce: processNextQueuedJobOnceMock,
}));

mock.module('@/lib/engine/resolution-poller', () => ({
  runResolutionCycle: resolutionCycleMock,
}));

mock.module('@/lib/engine/scanner', () => ({
  runScanner: scannerMock,
}));

describe('live simulation paper loop', () => {
  beforeEach(() => {
    findUniqueMock.mockClear();
    marketLoopMock.mockClear();
    processNextQueuedJobOnceMock.mockClear();
    resolutionCycleMock.mockClear();
    scannerMock.mockClear();
    countMock.mockClear();
    findManyOrdersMock.mockClear();
    findUniqueMarketMock.mockClear();
    processNextQueuedJobOnceMock.mockResolvedValueOnce({
      jobId: 'job-1',
      jobType: 'TRIAGE_MARKET',
      marketId: 'market-1',
      status: 'COMPLETED',
      error: null,
    });
    processNextQueuedJobOnceMock.mockResolvedValueOnce(null as any);
  });

  it('uses the market loop and queued-job processing in paper mode', async () => {
    const liveSimulation = await import(new URL('../live-simulation.ts?paper-loop-test', import.meta.url).href);

    await liveSimulation.startSimulation({ scanIntervalSec: 999999, marketsPerScan: 1 });
    await new Promise((resolve) => setTimeout(resolve, 2100));

    expect(marketLoopMock).toHaveBeenCalled();
    expect(processNextQueuedJobOnceMock).toHaveBeenCalled();
    expect(scannerMock).not.toHaveBeenCalled();
    expect(liveSimulation.getSimState().marketsScanned).toBe(3);

    liveSimulation.stopSimulation();
  });
});
