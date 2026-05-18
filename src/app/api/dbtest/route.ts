import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {
    const allSettings = await db.settings.findMany();
    const marketCount = await db.market.count();
    return NextResponse.json({
      settingsCount: allSettings.length,
      settings: allSettings.map(s => ({key: s.key, val: s.value.substring(0,60)})),
      marketCount,
    });
  } catch(e: any) {
    return NextResponse.json({error: e.message}, {status:500});
  }
}
