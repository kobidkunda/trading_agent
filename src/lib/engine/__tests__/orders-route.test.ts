import { beforeEach, describe, expect, it, mock } from 'bun:test';

const defaultOrders = [
  {
    id: 'order-1',
    status: 'FILLED',
    lifecycleStatus: 'FILLED',
    executionMode: 'SIMULATED',
    dataSource: 'REAL',
    market: {
      id: 'market-1',
      title: 'Will Bitcoin exceed $100,000 by end of 2026?',
      venue: 'POLYMARKET',
      category: 'crypto',
      externalId: 'poly-1',
    },
  },
];

const filterOrders = (orders: typeof defaultOrders, where?: any) => {
  return orders.filter((order) => {
    if (where?.lifecycleStatus?.in && !where.lifecycleStatus.in.includes(order.lifecycleStatus)) {
      return false;
    }
    if (where?.NOT?.some?.((rule: any) => rule.status && rule.status === order.status)) {
      return false;
    }
    if (where?.NOT?.some?.((rule: any) => rule.lifecycleStatus && rule.lifecycleStatus === order.lifecycleStatus)) {
      return false;
    }
    const marketOr = where?.market?.NOT?.OR ?? where?.market?.AND?.[1]?.NOT?.OR ?? [];
    if (marketOr.some((rule: any) =>
      (rule.externalId && rule.externalId === order.market.externalId) ||
      (rule.title && rule.title === order.market.title) ||
      (rule.venue && rule.category && rule.venue === order.market.venue && rule.category === order.market.category)
    )) {
      return false;
    }
    return true;
  });
};

const findManyMock = mock(async ({ where }: { where?: any }) => filterOrders(defaultOrders, where));
const countMock = mock(async () => 1);

mock.module('@/lib/db', () => ({
  db: {
    order: {
      findMany: findManyMock,
      count: countMock,
    },
  },
}));

describe('orders route', () => {
  beforeEach(() => {
    findManyMock.mockClear();
    countMock.mockClear();
  });

  it('returns orders with lifecycle metadata', async () => {
    const { GET } = await import('../../../app/api/orders/route');

    const res = await GET(new Request('http://localhost/api/orders?limit=10') as never);
    const payload = await res.json();

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].lifecycleStatus).toBe('FILLED');
    expect(payload.data[0].executionMode).toBe('SIMULATED');
    expect(payload.data[0].dataSource).toBe('REAL');
  });

  it('excludes legacy WATCH rows from open order results', async () => {
    const openOrders = [
      {
        id: 'watch-order',
        status: 'WATCH',
        lifecycleStatus: 'PLANNED',
        executionMode: 'SIMULATED',
        dataSource: 'REAL',
        market: {
          id: 'market-2',
          title: 'Legacy watch row',
          venue: 'POLYMARKET',
          category: 'crypto',
          externalId: 'watch-1',
        },
      },
      {
        id: 'submitted-order',
        status: 'SUBMITTED',
        lifecycleStatus: 'SUBMITTED',
        executionMode: 'SIMULATED',
        dataSource: 'REAL',
        market: {
          id: 'market-3',
          title: 'Real open order',
          venue: 'KALSHI',
          category: 'sports',
          externalId: 'kalshi-1',
        },
      },
    ];
    findManyMock.mockImplementationOnce(async ({ where }: { where?: any }) => filterOrders(openOrders as any, where));
    countMock.mockImplementationOnce(async () => 1);

    const { GET } = await import('../../../app/api/orders/route');
    const res = await GET(new Request('http://localhost/api/orders?status=open&limit=10') as never);
    const payload = await res.json();

    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].id).toBe('submitted-order');
  });

  it('excludes paper-loop test market orders', async () => {
    const testOrders = [
      {
        id: 'paper-test-order',
        status: 'FILLED',
        lifecycleStatus: 'FILLED',
        executionMode: 'SIMULATED',
        dataSource: 'MOCK',
        market: {
          id: 'paper-test-market',
          title: 'Test V2: Paper Orders should work in paper mode',
          venue: 'PAPER',
          category: 'test',
          externalId: 'PAPER_TEST_MARKET',
        },
      },
    ];
    findManyMock.mockImplementationOnce(async ({ where }: { where?: any }) => filterOrders(testOrders as any, where));
    countMock.mockImplementationOnce(async () => 0);

    const { GET } = await import('../../../app/api/orders/route');
    const res = await GET(new Request('http://localhost/api/orders?limit=10') as never);
    const payload = await res.json();

    expect(payload.data).toHaveLength(0);
  });
});
