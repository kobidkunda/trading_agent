import { beforeEach, describe, expect, it, mock } from 'bun:test';

const jobFindManyMock = mock(async () => ([
  {
    id: 'job-1',
    type: 'PAPER_EXECUTE',
    status: 'COMPLETED',
    payload: JSON.stringify({ trigger: 'triage_chain', marketId: 'm1' }),
    createdAt: new Date('2026-05-29T00:00:00.000Z'),
  },
]));

mock.module('@/lib/db', () => ({
  db: {
    job: { findMany: jobFindManyMock },
  },
}));

describe('lineage export', () => {
  beforeEach(() => {
    jobFindManyMock.mockClear();
  });

  it('exports trigger-action-outcome records', async () => {
    const { exportLineage } = await import('../lineage-export');
    const rows = await exportLineage(10);
    expect(rows).toHaveLength(1);
    expect(rows[0].trigger).toBe('triage_chain');
    expect(rows[0].action).toBe('PAPER_EXECUTE');
    expect(rows[0].outcome).toBe('COMPLETED');
  });
});
