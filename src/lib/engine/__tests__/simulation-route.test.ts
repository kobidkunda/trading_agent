import { beforeEach, describe, expect, it, mock } from 'bun:test';

const findUniqueMock = mock(async ({ where }: { where: { key: string } }) => {
  if (where.key === 'trading_mode') {
    return { key: 'trading_mode', value: 'PAPER' };
  }

  if (where.key === 'strategy_settings') {
    return { key: 'strategy_settings', value: JSON.stringify({ enabledVenues: ['POLYMARKET'], enabledCategories: ['crypto'] }) };
  }

  return null;
});

const startSimulationMock = mock((config?: unknown) => ({ status: 'RUNNING', config }));
const stopSimulationMock = mock(() => ({ status: 'STOPPED' }));
const updateConfigMock = mock((config?: unknown) => ({ status: 'STOPPED', config }));
const runSimulationMock = mock(async () => ({ id: 'demo-run' }));

mock.module('@/lib/db', () => ({
  db: {
    settings: {
      findUnique: findUniqueMock,
    },
  },
}));

mock.module('@/lib/engine/live-simulation', () => ({
  getSimState: () => ({ status: 'STOPPED' }),
  startSimulation: startSimulationMock,
  stopSimulation: stopSimulationMock,
  updateConfig: updateConfigMock,
}));

mock.module('@/lib/engine/simulation', () => ({
  runSimulation: runSimulationMock,
}));

describe('simulation route mode gating', () => {
  beforeEach(() => {
    findUniqueMock.mockClear();
    startSimulationMock.mockClear();
    stopSimulationMock.mockClear();
    updateConfigMock.mockClear();
    runSimulationMock.mockClear();
  });

  it('allows simulation start in paper mode', async () => {
    const { POST } = await import('../../../app/api/simulation/route');

    const response = await POST(
      new Request('http://localhost/api/simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(startSimulationMock).toHaveBeenCalled();
  });

  it('allows simulation start in demo mode', async () => {
    findUniqueMock.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === 'trading_mode') {
        return { key: 'trading_mode', value: 'DEMO' };
      }

      if (where.key === 'strategy_settings') {
        return { key: 'strategy_settings', value: JSON.stringify({ enabledVenues: ['POLYMARKET'], enabledCategories: ['crypto'] }) };
      }

      return null;
    });

    const { POST } = await import('../../../app/api/simulation/route');

    const response = await POST(
      new Request('http://localhost/api/simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', config: { scanIntervalSec: 60 } }),
      }) as never,
    );

    expect(response.status).toBe(200);
    expect(startSimulationMock).toHaveBeenCalledWith({ scanIntervalSec: 60 });
  });
});
