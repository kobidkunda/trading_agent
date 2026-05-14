import { NextRequest, NextResponse } from 'next/server';

const MIROFISH_BASE = 'http://192.168.88.96:5401';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { prompt?: string; model?: string };
    if (!body.prompt) {
      return NextResponse.json({
        content: '',
        success: false,
        error: 'Missing required field: prompt',
      }, { status: 400 });
    }

    const model = body.model || 'free_ling';
    const params = new URLSearchParams({ prompt: body.prompt });
    const url = `${MIROFISH_BASE}/api/llm/test/${encodeURIComponent(model)}?${params.toString()}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });

    if (!res.ok) {
      return NextResponse.json({
        content: '',
        model,
        success: false,
        error: `Upstream returned ${res.status}`,
      }, { status: 502 });
    }

    const data = await res.json() as {
      model?: string;
      response?: string;
      success?: boolean;
      usage?: Record<string, unknown>;
    };

    return NextResponse.json({
      content: data.response || '',
      model: data.model || model,
      usage: data.usage,
      success: true,
    });
  } catch (err) {
    return NextResponse.json({
      content: '',
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
