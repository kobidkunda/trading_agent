import { NextResponse } from 'next/server';
import { exportLineage } from '@/lib/engine/lineage-export';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(1000, Number(searchParams.get('limit') ?? 200)));
    const records = await exportLineage(limit);
    return NextResponse.json({ records, total: records.length });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Failed to export lineage', detail: message }, { status: 500 });
  }
}
