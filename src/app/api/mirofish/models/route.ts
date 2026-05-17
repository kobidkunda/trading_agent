import { NextResponse } from 'next/server';

const MIROFISH_BASE = process.env.MIROFISH_URL || '';

const PREFIX_MAP: [string, string, string, boolean][] = [
  ['free_', 'free', 'mirofish', true],
  ['paid_', 'paid', 'mirofish', false],
  ['paper_', 'paper', 'mirofish', true],
  ['claude', 'premium', 'anthropic', false],
  ['gpt', 'premium', 'openai', false],
  ['gemini', 'premium', 'google', false],
  ['openai', 'premium', 'openai', false],
  ['minimax', 'paid', 'minimax', false],
  ['nvidia', 'paid', 'nvidia', false],
  ['deepseek', 'paid', 'deepseek', false],
  ['kimi', 'paid', 'moonshot', false],
  ['qwen', 'paid', 'alibaba', false],
  ['ds_', 'paid', 'deepseek', false],
  ['z-ai', 'paid', 'z-ai', false],
  ['z_ai', 'paid', 'z-ai', false],
  ['bytedance', 'paid', 'bytedance', false],
  ['stepfun', 'paid', 'stepfun', false],
  ['webapi', 'paid', 'webapi', false],
  ['nousresearch', 'paid', 'nousresearch', false],
  ['arcee', 'paid', 'arcee', false],
  ['inclusionai', 'paid', 'inclusionai', false],
  ['inclusion', 'paid', 'inclusionai', false],
  ['tencent', 'paid', 'tencent', false],
];

function classify(id: string): { tier: string; provider: string; isFree: boolean } {
  const lower = id.toLowerCase();
  for (const [prefix, tier, provider, isFree] of PREFIX_MAP) {
    if (lower.startsWith(prefix)) return { tier, provider, isFree };
  }
  return { tier: 'unknown', provider: 'unknown', isFree: false };
}

export async function GET() {
  try {
    const res = await fetch(`${MIROFISH_BASE}/api/llm/models`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      throw new Error(`Upstream returned ${res.status}`);
    }

    const body = await res.json() as { models?: string[]; success?: boolean };
    const models = (body.models || []).map((id: string) => {
      const { tier, provider, isFree } = classify(id);
      return { id, tier, provider, isFree };
    });

    return NextResponse.json({ models, success: true });
  } catch (err) {
    return NextResponse.json({
      models: [],
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 502 });
  }
}
