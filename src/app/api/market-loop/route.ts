import { NextRequest, NextResponse } from 'next/server';
import { runScanner } from '@/lib/engine/scanner';
import { runMarketLoopOnce } from '@/lib/engine/market-loop';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const venues = body.venues as string[] | undefined;
    const categories = body.categories as string[] | undefined;

    const scanResult = await runScanner(venues, categories);
    const loopResult = await runMarketLoopOnce();

    return NextResponse.json({ success: true, scanResult, loopResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scanner execution failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
