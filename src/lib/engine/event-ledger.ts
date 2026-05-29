import { createHash } from 'node:crypto';
import { db } from '@/lib/db';

export interface EventLedgerRecord {
  correlationId: string;
  eventType: string;
  stage?: string;
  actor?: string;
  payload: Record<string, unknown>;
}

export interface EventLedgerEntry extends EventLedgerRecord {
  id: string;
  seq: number;
  prevHash: string | null;
  hash: string;
  timestamp: string;
}

interface EventLedgerEnvelope {
  correlationId: string;
  eventType: string;
  stage?: string;
  payload: Record<string, unknown>;
  chain: {
    seq: number;
    prevHash: string | null;
    hash: string;
    timestamp: string;
  };
}

function computeHash(input: {
  correlationId: string;
  eventType: string;
  stage?: string;
  payload: Record<string, unknown>;
  seq: number;
  prevHash: string | null;
  timestamp: string;
}): string {
  return createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex');
}

function parseEnvelope(details: string | null): EventLedgerEnvelope | null {
  if (!details) return null;
  try {
    return JSON.parse(details) as EventLedgerEnvelope;
  } catch {
    return null;
  }
}

export async function appendEvent(record: EventLedgerRecord): Promise<EventLedgerEntry> {
  const latest = await db.auditLog.findFirst({
    where: {
      action: 'EVENT_LEDGER',
      entityId: record.correlationId,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, details: true, createdAt: true },
  });

  const latestEnvelope = parseEnvelope(latest?.details ?? null);
  const seq = (latestEnvelope?.chain.seq ?? 0) + 1;
  const prevHash = latestEnvelope?.chain.hash ?? null;
  const timestamp = new Date().toISOString();

  const hash = computeHash({
    correlationId: record.correlationId,
    eventType: record.eventType,
    stage: record.stage,
    payload: record.payload,
    seq,
    prevHash,
    timestamp,
  });

  const envelope: EventLedgerEnvelope = {
    correlationId: record.correlationId,
    eventType: record.eventType,
    stage: record.stage,
    payload: record.payload,
    chain: { seq, prevHash, hash, timestamp },
  };

  const created = await db.auditLog.create({
    data: {
      action: 'EVENT_LEDGER',
      actor: record.actor ?? 'system',
      entityType: 'Correlation',
      entityId: record.correlationId,
      details: JSON.stringify(envelope),
    },
  });

  return {
    id: created.id,
    correlationId: record.correlationId,
    eventType: record.eventType,
    stage: record.stage,
    actor: record.actor,
    payload: record.payload,
    seq,
    prevHash,
    hash,
    timestamp,
  };
}

export async function listEventsByCorrelationId(correlationId: string): Promise<EventLedgerEntry[]> {
  const rows = await db.auditLog.findMany({
    where: {
      action: 'EVENT_LEDGER',
      entityId: correlationId,
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true, details: true },
  });

  return rows
    .map((row) => {
      const envelope = parseEnvelope(row.details);
      if (!envelope) return null;
      return {
        id: row.id,
        correlationId: envelope.correlationId,
        eventType: envelope.eventType,
        stage: envelope.stage,
        actor: undefined,
        payload: envelope.payload,
        seq: envelope.chain.seq,
        prevHash: envelope.chain.prevHash,
        hash: envelope.chain.hash,
        timestamp: envelope.chain.timestamp,
      } as EventLedgerEntry;
    })
    .filter((entry): entry is EventLedgerEntry => Boolean(entry));
}

export async function computeReplayBundle(correlationId: string): Promise<{
  correlationId: string;
  count: number;
  terminalHash: string | null;
  events: EventLedgerEntry[];
}> {
  const events = await listEventsByCorrelationId(correlationId);
  return {
    correlationId,
    count: events.length,
    terminalHash: events.length > 0 ? events[events.length - 1].hash : null,
    events,
  };
}
