import { NextResponse } from 'next/server';
import { runScanner } from '@/lib/engine/scanner';
import { runMarketLoopOnce } from '@/lib/engine/market-loop';

export async function POST() {
  try {
    const scanResult = await runScanner();
    const loopResult = await runMarketLoopOnce();
    return NextResponse.json({ scanResult, loopResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
