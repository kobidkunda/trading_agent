import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { parsePaginationParams, buildPaginatedResponse } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pagination = parsePaginationParams(searchParams);
    const name = searchParams.get('name');
    const state = searchParams.get('state');

    const where: Prisma.PromptTemplateWhereInput = {};
    if (name) where.name = name;
    if (state) where.state = state;
    if (pagination.search) {
      where.OR = [
        { name: { contains: pagination.search } },
        { body: { contains: pagination.search } },
      ];
    }

    const orderBy: Prisma.PromptTemplateOrderByWithRelationInput[] = pagination.sortBy
      ? [{ [pagination.sortBy]: pagination.sortOrder || 'desc' }]
      : [{ name: 'asc' }, { version: 'desc' }];

    const [data, total] = await Promise.all([
      db.promptTemplate.findMany({
        where,
        orderBy,
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      db.promptTemplate.count({ where }),
    ]);

    return NextResponse.json(buildPaginatedResponse(data, total, pagination));
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch prompt templates' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.name || !body.body) {
      return NextResponse.json({ error: 'name and body are required' }, { status: 400 });
    }

    // Get the latest version for this prompt name
    const latestPrompt = await db.promptTemplate.findFirst({
      where: { name: body.name },
      orderBy: { version: 'desc' },
    });

    const nextVersion = (latestPrompt?.version ?? 0) + 1;

    const prompt = await db.promptTemplate.create({
      data: {
        name: body.name,
        version: nextVersion,
        state: body.state || 'DRAFT',
        body: body.body,
        description: body.description || null,
        changelog: body.changelog || null,
        publishedAt: body.state === 'PUBLISHED' ? new Date() : null,
      },
    });

    await db.auditLog.create({
      data: {
        action: 'CREATE_PROMPT_VERSION',
        entityType: 'PromptTemplate',
        entityId: prompt.id,
        details: `Prompt template "${body.name}" version ${nextVersion} created`,
      },
    });

    return NextResponse.json(prompt, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create prompt template' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const updateData: Prisma.PromptTemplateUpdateInput = {};
    if (body.body !== undefined) updateData.body = body.body;
    if (body.state !== undefined) {
      updateData.state = body.state;
      if (body.state === 'PUBLISHED') {
        updateData.publishedAt = new Date();
      }
    }
    if (body.description !== undefined) updateData.description = body.description;
    if (body.changelog !== undefined) updateData.changelog = body.changelog;

    const prompt = await db.promptTemplate.update({
      where: { id: body.id },
      data: updateData,
    });

    await db.auditLog.create({
      data: {
        action: 'UPDATE_PROMPT_TEMPLATE',
        entityType: 'PromptTemplate',
        entityId: prompt.id,
        details: `Prompt template "${prompt.name}" v${prompt.version} updated`,
      },
    });

    return NextResponse.json(prompt);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update prompt template' }, { status: 500 });
  }
}
