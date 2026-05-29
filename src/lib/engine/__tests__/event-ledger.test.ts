import { beforeEach, describe, expect, it, mock } from 'bun:test';

const auditRows: Array<{ id: string; details: string | null; createdAt: Date }> = [];

const findFirstMock = mock(async ({ where }: { where: { entityId: string } }) => {
  const rows = auditRows
    .filter((r) => {
      const parsed = r.details ? JSON.parse(r.details) : null;
      return parsed?.correlationId === where.entityId;
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return rows[0] ?? null;
});

const createMock = mock(async ({ data }: { data: Record<string, unknown> }) => {
  const row = {
    id: `audit-${auditRows.length + 1}`,
    details: String(data.details ?? null),
    createdAt: new Date(),
  };
  auditRows.push(row);
  return row;
});

const findManyMock = mock(async ({ where }: { where: { entityId: string } }) => {
  return auditRows
    .filter((r) => {
      const parsed = r.details ? JSON.parse(r.details) : null;
      return parsed?.correlationId === where.entityId;
    })
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
});

mock.module('@/lib/db', () => ({
  db: {
    auditLog: {
      findFirst: findFirstMock,
      create: createMock,
      findMany: findManyMock,
    },
  },
}));

describe('event ledger', () => {
  beforeEach(() => {
    auditRows.length = 0;
    findFirstMock.mockClear();
    createMock.mockClear();
    findManyMock.mockClear();
  });

  it('appends chained events and computes replay bundle', async () => {
    const { appendEvent, computeReplayBundle } = await import('../event-ledger');

    const a = await appendEvent({
      correlationId: 'corr-1',
      eventType: 'TRIAGE_COMPLETED',
      stage: 'TRIAGE',
      payload: { marketId: 'm1' },
    });

    const b = await appendEvent({
      correlationId: 'corr-1',
      eventType: 'RISK_COMPLETED',
      stage: 'RISK',
      payload: { decision: 'WATCH' },
    });

    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(b.prevHash).toBe(a.hash);

    const bundle = await computeReplayBundle('corr-1');
    expect(bundle.count).toBe(2);
    expect(bundle.terminalHash).toBe(b.hash);
    expect(bundle.events[0]?.eventType).toBe('TRIAGE_COMPLETED');
    expect(bundle.events[1]?.eventType).toBe('RISK_COMPLETED');
  });
});
