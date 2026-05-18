import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const typeFilter = searchParams.get('type') || 'All';
    const statusFilter = searchParams.get('status') || 'All';
    const search = searchParams.get('search') || '';
    const sort = searchParams.get('sort') || 'desc';
    const page = Math.max(parseInt(searchParams.get('page') || '1'), 1);
    const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 100);
    const skip = (page - 1) * limit;

    const includeJobs = typeFilter === 'All' || typeFilter === 'Jobs';
    const includeAudit = typeFilter === 'All' || typeFilter === 'Audit';
    const includeAgent = typeFilter === 'All' || typeFilter === 'AgentOutput';

    interface LogEntry {
      id: string;
      type: 'Job' | 'Audit' | 'AgentOutput';
      action: string;
      message: string;
      status: string;
      entityType?: string;
      entityId?: string;
      timestamp: string;
    }

    let rawJobEntries: any[] = [];
    let rawAuditEntries: any[] = [];
    let rawAgentEntries: any[] = [];

    // Fetch Jobs
    if (includeJobs) {
      const jobWhere: any = {};
      if (statusFilter === 'Completed') jobWhere.status = 'COMPLETED';
      else if (statusFilter === 'Failed') jobWhere.status = 'FAILED';
      else if (statusFilter === 'Running') jobWhere.status = { in: ['RUNNING', 'RETRYING'] };
      if (search) {
        jobWhere.OR = [
          { type: { contains: search } },
          { error: { contains: search } },
        ];
      }
      const jobs = await db.job.findMany({
        where: jobWhere,
        orderBy: { createdAt: sort as 'asc' | 'desc' },
        select: { id: true, type: true, status: true, error: true, payload: true, createdAt: true },
      });
      rawJobEntries = jobs;
    }

    // Fetch AuditLogs
    if (includeAudit) {
      const auditWhere: any = {};
      if (search) {
        auditWhere.OR = [
          { action: { contains: search } },
          { details: { contains: search } },
          { actor: { contains: search } },
        ];
      }
      const audits = await db.auditLog.findMany({
        where: auditWhere,
        orderBy: { createdAt: sort as 'asc' | 'desc' },
        select: { id: true, action: true, actor: true, entityType: true, entityId: true, details: true, createdAt: true },
      });
      rawAuditEntries = audits;
    }

    // Fetch AgentOutputs
    if (includeAgent) {
      const agentWhere: any = {};
      if (search) {
        agentWhere.OR = [
          { summary: { contains: search } },
          { failureReason: { contains: search } },
          { role: { contains: search } },
        ];
      }
      const agents = await db.agentOutput.findMany({
        where: agentWhere,
        orderBy: { createdAt: sort as 'asc' | 'desc' },
        select: { id: true, role: true, stage: true, provider: true, modelUsed: true, summary: true, failureReason: true, createdAt: true },
      });
      rawAgentEntries = agents;
    }

    // Map to unified entries
    const entries: LogEntry[] = [
      ...rawJobEntries.map((j: any) => ({
        id: j.id,
        type: 'Job' as const,
        action: j.type || 'UNKNOWN',
        message: j.error
          ? `Failed: ${j.error.substring(0, 120)}`
          : j.status === 'COMPLETED' ? 'Job completed' : j.status,
        status: j.status || 'UNKNOWN',
        entityType: 'Job',
        entityId: j.id,
        timestamp: j.createdAt.toISOString(),
      })),
      ...rawAuditEntries.map((a: any) => ({
        id: a.id,
        type: 'Audit' as const,
        action: a.action || 'UNKNOWN',
        message: a.details || a.action || 'Audit event',
        status: 'COMPLETED',
        entityType: a.entityType || undefined,
        entityId: a.entityId || undefined,
        timestamp: a.createdAt.toISOString(),
      })),
      ...rawAgentEntries.map((a: any) => ({
        id: a.id,
        type: 'AgentOutput' as const,
        action: a.role || a.stage || 'UNKNOWN',
        message: a.failureReason
          ? `Failed: ${a.failureReason.substring(0, 120)}`
          : a.summary
            ? a.summary.substring(0, 200)
            : `${a.provider || 'Agent'} via ${a.modelUsed || 'unknown'}`,
        status: a.failureReason ? 'FAILED' : 'COMPLETED',
        entityType: 'AgentOutput',
        entityId: a.id,
        timestamp: a.createdAt.toISOString(),
      })),
    ];

    // Sort by timestamp
    entries.sort((a, b) => {
      const cmp = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
      return sort === 'asc' ? cmp : -cmp;
    });

    const paginated = entries.slice(skip, skip + limit);

    // Stats
    const jobCount = includeJobs ? await db.job.count() : 0;
    const failedCount = includeJobs ? await db.job.count({ where: { status: 'FAILED' } }) : 0;
    const auditCount = includeAudit ? await db.auditLog.count() : 0;
    const agentCount = includeAgent ? await db.agentOutput.count() : 0;

    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentJobs = includeJobs
      ? await db.job.count({ where: { createdAt: { gte: fiveMinAgo } } })
      : 0;

    return NextResponse.json({
      entries: paginated,
      page,
      limit,
      stats: {
        totalLogs: jobCount + auditCount + agentCount,
        failedCount,
        recentActivity: recentJobs,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to fetch logs', detail: message }, { status: 500 });
  }
}
