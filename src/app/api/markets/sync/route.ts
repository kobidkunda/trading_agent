import { NextResponse } from 'next/server';
import { runScanner } from '@/lib/engine/scanner';

export async function POST() {
  try {
    const result = await runScanner();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}