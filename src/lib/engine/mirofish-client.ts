const MIROFISH_BASE = 'http://192.168.88.96:5401';
const DEFAULT_TIMEOUT = 15000;

export type MiroFishModelTier = 'free' | 'paid' | 'paper' | 'premium' | 'unknown';

export interface MiroFishModel {
  id: string;
  tier: MiroFishModelTier;
  isFree: boolean;
  provider: string;
}

export interface MiroFishResponse {
  content: string;
  model: string;
  success: boolean;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

const PREFIX_MAP: [string, MiroFishModelTier, string, boolean][] = [
  ['free_',    'free',    'mirofish',   true],
  ['paid_',    'paid',    'mirofish',   false],
  ['paper_',   'paper',   'mirofish',   true],

  ['claude',   'premium', 'anthropic',  false],
  ['gpt',      'premium', 'openai',     false],
  ['gemini',   'premium', 'google',     false],
  ['openai',   'premium', 'openai',     false],
  ['minimax',  'paid',    'minimax',    false],
  ['nvidia',   'paid',    'nvidia',     false],
  ['deepseek', 'paid',    'deepseek',   false],
  ['kimi',     'paid',    'moonshot',   false],
  ['qwen',     'paid',    'alibaba',    false],
  ['ds_',      'paid',    'deepseek',   false],
  ['z-ai',     'paid',    'z-ai',       false],
  ['z_ai',     'paid',    'z-ai',       false],

  ['bytedance',      'paid', 'bytedance',     false],
  ['stepfun',        'paid', 'stepfun',       false],
  ['webapi',         'paid', 'webapi',        false],
  ['nousresearch',   'paid', 'nousresearch',  false],
  ['arcee',          'paid', 'arcee',         false],
  ['inclusionai',    'paid', 'inclusionai',   false],
  ['inclusion',      'paid', 'inclusionai',   false],
  ['tencent',        'paid', 'tencent',       false],
];

export function classifyModelTier(modelId: string): MiroFishModelTier {
  const lower = modelId.toLowerCase();
  for (const [prefix, tier] of PREFIX_MAP) {
    if (lower.startsWith(prefix)) return tier;
  }
  return 'unknown';
}

function classifyProvider(modelId: string): { provider: string; isFree: boolean } {
  const lower = modelId.toLowerCase();
  for (const [prefix, , provider, isFree] of PREFIX_MAP) {
    if (lower.startsWith(prefix)) return { provider, isFree };
  }
  return { provider: 'unknown', isFree: false };
}

export async function fetchMiroFishModels(): Promise<MiroFishModel[]> {
  try {
    const res = await fetch(`${MIROFISH_BASE}/api/llm/models`, {
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
    });

    if (!res.ok) {
      console.error(`[MiroFish] models endpoint returned ${res.status}`);
      return [];
    }

    const body = await res.json() as { models?: string[]; success?: boolean };
    if (!body.models || !Array.isArray(body.models)) {
      console.error('[MiroFish] unexpected body shape for /models', body);
      return [];
    }

    return classifyModels(body.models);
  } catch (err) {
    console.error('[MiroFish] fetchModels failed:', err);
    return [];
  }
}

/**
 * The /api/llm/test endpoint is a GET with no request body, so the prompt is
 * encoded as a query parameter. If the endpoint does not accept query params,
 * it will still return a default test response.
 */
export async function callMiroFish(
  prompt: string,
  model: string,
): Promise<MiroFishResponse> {
  const params = new URLSearchParams({ prompt });
  const url = `${MIROFISH_BASE}/api/llm/test/${encodeURIComponent(model)}?${params.toString()}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT * 2),
    });

    if (!res.ok) {
      console.error(`[MiroFish] test/${model} returned ${res.status}`);
      return { content: '', model, success: false };
    }

    const body = await res.json() as {
      model?: string;
      response?: string;
      success?: boolean;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };

    return {
      content: body.response ?? '',
      model: body.model ?? model,
      success: body.success ?? true,
      usage: body.usage
        ? {
            prompt_tokens: body.usage.prompt_tokens ?? 0,
            completion_tokens: body.usage.completion_tokens ?? 0,
            total_tokens: body.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  } catch (err) {
    console.error(`[MiroFish] callMiroFish(${model}) failed:`, err);
    return { content: '', model, success: false };
  }
}

export function classifyModels(models: string[]): MiroFishModel[] {
  return models.map((id) => {
    const tier = classifyModelTier(id);
    const { provider, isFree } = classifyProvider(id);
    return { id, tier, isFree, provider };
  });
}
