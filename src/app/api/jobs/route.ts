import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    const where: Prisma.JobWhereInput = {};
    if (type) where.type = type;
    if (status) where.status = status;

    const jobs = await db.job.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });

    const total = await db.job.count({ where });

    return NextResponse.json({ jobs, total, limit, offset });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch jobs' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.type) {
      return NextResponse.json({ error: 'type is required' }, { status: 400 });
    }

    const validTypes = ['SCAN', 'TRIAGE', 'RESEARCH', 'JUDGE', 'RISK', 'EXECUTE', 'SETTLE'];
    if (!validTypes.includes(body.type)) {
      return NextResponse.json(
        { error: `type must be one of: ${validTypes.join(', ')}` },
        { status: 400 },
      );
    }

    const job = await db.job.create({
      data: {
        type: body.type,
        status: body.status || 'PENDING',
        priority: body.priority ?? 5,
        payload: body.payload ? JSON.stringify(body.payload) : null,
        maxRetries: body.maxRetries ?? 3,
      },
    });

    await db.auditLog.create({
      data: {
        action: 'CREATE_JOB',
        entityType: 'Job',
        entityId: job.id,
        details: `Job created: type=${body.type}, priority=${job.priority}`,
      },
    });

    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    if (!body.status) {
      return NextResponse.json({ error: 'status is required' }, { status: 400 });
    }

    const validStatuses = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING'];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of: ${validStatuses.join(', ')}` },
        { status: 400 },
      );
    }

    const existingJob = await db.job.findUnique({ where: { id: body.id } });
    if (!existingJob) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    const updateData: Prisma.JobUpdateInput = { status: body.status };

    // Auto-set timestamps based on status transitions
    if (body.status === 'RUNNING' && !existingJob.startedAt) {
      updateData.startedAt = new Date();
    }
    if (body.status === 'COMPLETED') {
      updateData.completedAt = new Date();
    }
    if (body.status === 'RETRYING') {
      updateData.retryCount = { increment: 1 };
      updateData.startedAt = new Date();
    }
    if (body.status === 'FAILED') {
      updateData.completedAt = new Date();
      updateData.error = body.error || existingJob.error || 'Job failed';
    }
    if (body.result !== undefined) {
      updateData.result = JSON.stringify(body.result);
    }
    if (body.priority !== undefined) {
      updateData.priority = body.priority;
    }

    const job = await db.job.update({
      where: { id: body.id },
      data: updateData,
    });

    await db.auditLog.create({
      data: {
        action: 'UPDATE_JOB_STATUS',
        entityType: 'Job',
        entityId: job.id,
        details: `Job ${job.id} status changed from ${existingJob.status} to ${job.status}`,
      },
    });

    return NextResponse.json(job);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}
