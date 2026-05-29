import { describe, expect, it, mock } from 'bun:test';

const findManyJobMock = mock(async () => ([
  {
    id: 'job-live',
    type: 'SCAN',
    status: 'COMPLETED',
    error: null,
    payload: {},
    createdAt: new Date('2026-05-29T10:00:00.000Z'),
  },
  {
    id: 'job-nonlive',
    type: 'HEARTBEAT',
    status: 'COMPLETED',
    error: null,
    payload: {},
    createdAt: new Date('2026-05-29T09:59:00.000Z'),
  },
  {
    id: 'job-live-2',
    type: 'PAPER_EXECUTE',
    status: 'COMPLETED',
    error: null,
    payload: {},
    createdAt: new Date('2026-05-29T09:58:00.000Z'),
  },
]));

const findManyAuditMock = mock(async () => ([
  {
    id: 'audit-job',
    action: 'JOB_UPDATED',
    actor: 'system',
    entityType: 'Job',
    entityId: 'job-live',
    details: 'Job updated',
    createdAt: new Date('2026-05-29T09:57:00.000Z'),
  },
  {
    id: 'audit-nonjob',
    action: 'AGENT_UPDATED',
    actor: 'system',
    entityType: 'AgentOutput',
    entityId: 'agent-live',
    details: 'Agent updated',
    createdAt: new Date('2026-05-29T09:56:00.000Z'),
  },
]));

const findManyAgentMock = mock(async () => ([
  {
    id: 'agent-live',
    role: 'analyst',
    stage: 'summary',
    provider: 'openai',
    modelUsed: 'gpt',
    summary: 'Live output',
    failureReason: null,
    createdAt: new Date('2026-05-29T09:55:00.000Z'),
  },
  {
    id: 'agent-failed',
    role: 'analyst',
    stage: 'summary',
    provider: 'openai',
    modelUsed: 'gpt',
    summary: null,
    failureReason: 'tool failed',
    createdAt: new Date('2026-05-29T09:54:00.000Z'),
  },
]));

const countJobMock = mock(async () => 3);
const countAuditMock = mock(async () => 2);
const countAgentMock = mock(async () => 2);

mock.module('@/lib/db', () => ({
  db: {
    job: {
      findMany: findManyJobMock,
      count: countJobMock,
    },
    auditLog: {
      findMany: findManyAuditMock,
      count: countAuditMock,
    },
    agentOutput: {
      findMany: findManyAgentMock,
      count: countAgentMock,
    },
  },
}));

describe('logs route live-actions filter', () => {
  it('filters non-live entries for live-actions view', async () => {
    const { GET } = await import('../../../app/api/logs/route');

    const response = await GET(
      new Request('http://localhost/api/logs?view=live-actions') as never,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(payload.entries)).toBe(true);

    const ids = payload.entries.map((entry: { id: string }) => entry.id);
    expect(ids).toContain('job-live');
    expect(ids).toContain('job-live-2');
    expect(ids).toContain('audit-job');
    expect(ids).toContain('agent-live');

    expect(ids).not.toContain('job-nonlive');
    expect(ids).not.toContain('audit-nonjob');
    expect(ids).not.toContain('agent-failed');

    const timestamps = payload.entries.map((entry: { timestamp: string }) => new Date(entry.timestamp).getTime());
    for (let i = 0; i < timestamps.length - 1; i += 1) {
      expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i + 1]);
    }
  });
});
