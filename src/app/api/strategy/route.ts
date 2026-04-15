import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { DEFAULT_STRATEGY } from '@/lib/engine/risk';
import { StrategySettings } from '@/lib/types';

export async function GET() {
  try {
    const setting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
    const strategy = setting ? JSON.parse(setting.value) as StrategySettings : DEFAULT_STRATEGY;
    return NextResponse.json(strategy);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch strategy settings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    await db.settings.upsert({
      where: { key: 'strategy_settings' },
      update: { value: JSON.stringify(body), updatedAt: new Date() },
      create: { key: 'strategy_settings', value: JSON.stringify(body), description: 'Global strategy settings' },
    });
    await db.auditLog.create({
      data: { action: 'UPDATE_STRATEGY', entityType: 'Settings', entityId: 'strategy_settings', details: 'Strategy settings updated' },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to save strategy settings' }, { status: 500 });
  }
}
