import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

const SETTINGS_DESCRIPTION = 'Application setting';

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

    const settings = await db.settings.findMany();
    const entries = settings.map((s) => ({ key: s.key, value: s.value }));
    const values = Object.fromEntries(entries.map((s) => {
      try {
        return [s.key, JSON.parse(s.value)];
      } catch {
        return [s.key, s.value];
      }
    }));

    return NextResponse.json({
      ...values,
      settings: entries,
    });
  } catch (error) {
    console.error('[Settings API] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, value } = body as { key?: string; value?: string };

    if (key) {
      if (value === undefined) {
        return NextResponse.json({ error: 'value is required' }, { status: 400 });
      }

      await db.settings.upsert({
        where: { key },
        update: { value, updatedAt: new Date() },
        create: { key, value, description: `Qdrant collection links for ${key}` },
      });

      return NextResponse.json({ success: true });
    }

    const entries = Object.entries(body as Record<string, unknown>).filter(([, entryValue]) => (
      entryValue !== undefined && ['string', 'number', 'boolean'].includes(typeof entryValue)
    ));

    if (entries.length === 0) {
      return NextResponse.json({ error: 'key and value are required' }, { status: 400 });
    }

    await Promise.all(entries.map(([entryKey, entryValue]) => db.settings.upsert({
      where: { key: entryKey },
      update: { value: JSON.stringify(entryValue), updatedAt: new Date() },
      create: { key: entryKey, value: JSON.stringify(entryValue), description: SETTINGS_DESCRIPTION },
    })));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Settings API] PUT error:', error);
    return NextResponse.json({ error: 'Failed to save setting' }, { status: 500 });
  }
}
