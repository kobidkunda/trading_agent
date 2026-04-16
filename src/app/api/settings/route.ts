import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      const setting = await db.settings.findUnique({ where: { key } });
      if (!setting) {
        return NextResponse.json({ error: 'Setting not found' }, { status: 404 });
      }
      return NextResponse.json({ key: setting.key, value: setting.value });
    }

    const settings = await db.settings.findMany({
      where: { key: { startsWith: 'qdrant_collections_' } },
    });
    return NextResponse.json({
      settings: settings.map((s) => ({ key: s.key, value: s.value })),
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, value } = body as { key: string; value: string };

    if (!key || value === undefined) {
      return NextResponse.json({ error: 'key and value are required' }, { status: 400 });
    }

    await db.settings.upsert({
      where: { key },
      update: { value, updatedAt: new Date() },
      create: { key, value, description: `Qdrant collection links for ${key}` },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save setting' }, { status: 500 });
  }
}