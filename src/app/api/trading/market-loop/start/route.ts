import { NextRequest } from 'next/server';
import { POST as marketLoopPost } from '../route';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));

  return marketLoopPost(
    new Request(request.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start', intervalMinutes: body.intervalMinutes }),
    }) as never,
  );
}
