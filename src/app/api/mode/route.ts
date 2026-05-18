import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { normalizeTradingMode } from '@/lib/engine/mode';

const TRADING_MODE_KEY = 'trading_mode';

export async function GET() {
  try {
    const setting = await db.settings.findUnique({
      where: { key: TRADING_MODE_KEY },
    });

    const mode = setting ? normalizeTradingMode(setting.value) : 'PAPER';

    return NextResponse.json({ mode });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch trading mode' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const rawMode = body.mode as string | undefined;

    if (!rawMode) {
      return NextResponse.json({ error: 'mode is required' }, { status: 400 });
    }

    const mode = normalizeTradingMode(rawMode);

    await db.settings.upsert({
      where: { key: TRADING_MODE_KEY },
      update: { value: mode, updatedAt: new Date() },
      create: { key: TRADING_MODE_KEY, value: mode, description: 'Current trading mode' },
    });

    await db.auditLog.create({
      data: {
        action: 'SET_TRADING_MODE',
        entityType: 'Settings',
        entityId: TRADING_MODE_KEY,
        details: `Trading mode set to ${mode}`,
      },
    });

    return NextResponse.json({ mode });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update trading mode' }, { status: 500 });
  }
}
