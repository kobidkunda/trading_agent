import { NextRequest, NextResponse } from 'next/server';
import { runScanner } from '@/lib/engine/scanner';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));

    const venues = body.venues as string[] | undefined;
    const categories = body.categories as string[] | undefined;

    const result = await runScanner(venues, categories);

    return NextResponse.json({ success: true, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Scanner execution failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
