import { beforeEach, describe, expect, it, mock } from 'bun:test';

const findManyMock = mock(async () => ([
  {
    id: 'order-1',
    lifecycleStatus: 'SUBMITTED',
    status: 'SUBMITTED',
    executionMode: 'SIMULATED',
    dataSource: 'REAL',
    market: { id: 'market-1', title: 'Sample market', venue: 'POLYMARKET', category: 'crypto' },
  },
]));

const findUniqueMock = mock(async ({ where }: { where: { id: string } }) =>
  where.id === 'order-1'
    ? { id: 'order-1', lifecycleStatus: 'SUBMITTED', status: 'SUBMITTED' }
    : null,
);

const updateMock = mock(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
  id: where.id,
  ...data,
}));

const auditCreateMock = mock(async () => ({ id: 'audit-1' }));

mock.module('@/lib/db', () => ({
  db: {
    order: {
      findMany: findManyMock,
      findUnique: findUniqueMock,
      update: updateMock,
    },
    auditLog: {
      create: auditCreateMock,
    },
  },
}));

describe('trading order routes', () => {
  beforeEach(() => {
    findManyMock.mockClear();
    findUniqueMock.mockClear();
    updateMock.mockClear();
    auditCreateMock.mockClear();
  });

  it('returns open trading orders', async () => {
    const { GET } = await import('../../../app/api/trading/orders/open/route');
    const res = await GET();
    const payload = await res.json();

    expect(payload.orders).toHaveLength(1);
    expect(payload.orders[0].lifecycleStatus).toBe('SUBMITTED');
  });

  it('filters out watch and filled rows from open trading orders', async () => {
    findManyMock.mockImplementationOnce(async () => ([
      {
        id: 'watch-order',
        lifecycleStatus: 'PLANNED',
        status: 'WATCH',
        executionMode: 'SIMULATED',
        dataSource: 'REAL',
        market: { id: 'market-1', title: 'Watch row', venue: 'POLYMARKET', category: 'crypto' },
      },
      {
        id: 'filled-order',
        lifecycleStatus: 'PLANNED',
        status: 'FILLED',
        executionMode: 'SIMULATED',
        dataSource: 'REAL',
        market: { id: 'market-2', title: 'Filled row', venue: 'KALSHI', category: 'sports' },
      },
      {
        id: 'submitted-order',
        lifecycleStatus: 'SUBMITTED',
        status: 'SUBMITTED',
        executionMode: 'SIMULATED',
        dataSource: 'REAL',
        market: { id: 'market-3', title: 'Submitted row', venue: 'KALSHI', category: 'sports' },
      },
    ]));

    const { GET } = await import('../../../app/api/trading/orders/open/route');
    const res = await GET();
    const payload = await res.json();

    expect(payload.orders).toHaveLength(1);
    expect(payload.orders[0].id).toBe('submitted-order');
  });

  it('cancels an existing trading order', async () => {
    const { POST } = await import('../../../app/api/trading/orders/[id]/cancel/route');
    const res = await POST(
      new Request('http://localhost/api/trading/orders/order-1/cancel', { method: 'POST' }) as never,
      { params: Promise.resolve({ id: 'order-1' }) } as never,
    );
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.order.lifecycleStatus).toBe('CANCELLED');
    expect(updateMock).toHaveBeenCalledTimes(1);
  });
});
