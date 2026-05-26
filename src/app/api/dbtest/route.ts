import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { enforceRoutePermission } from '@/lib/engine/auth';

export async function GET(request: Request) {
  const denied = enforceRoutePermission(request, '/api/dbtest', 'GET');
  if (denied) return denied;

  if (process.env.ENABLE_DBTEST_API !== 'true') {
    return NextResponse.json(
      { error: 'DB test API is disabled. Set ENABLE_DBTEST_API=true for a controlled diagnostic window.' },
      { status: 403 },
    );
  }

  try {
    const allSettings = await db.settings.findMany();
    const marketCount = await db.market.count();
    return NextResponse.json({
      settingsCount: allSettings.length,
      settings: allSettings.map(s => ({key: s.key, val: s.value.substring(0,60)})),
      marketCount,
    });
  } catch (error) {
    console.error('[DBTest API] GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
