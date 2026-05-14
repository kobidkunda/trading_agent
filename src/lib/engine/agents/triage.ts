import { callLLMJson } from '@/lib/engine/llm-client';
import { db } from '@/lib/db';
import { DEFAULT_PROMPT_TEMPLATES } from '@/lib/constants';
import { getStageRouting, getModelForStage } from '@/lib/engine/service-routing';

export interface TriageOutput {
  status: 'RELEVANT' | 'IRRELEVANT' | 'AMBIGUOUS';
  reason: string;
  worthResearch: boolean;
}

export async function runTriageAgent(
  marketId: string,
  marketTitle: string,
  marketDescription: string,
  category: string,
  impliedProbability: number,
  liquidity: number,
): Promise<TriageOutput> {
  try {
    const promptSetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
    const strategy = promptSetting ? JSON.parse(promptSetting.value) : {};
    const promptVersion = strategy.promptVersion?.triage ?? 1;

    let promptBody = DEFAULT_PROMPT_TEMPLATES.triage;
    const template = await db.promptTemplate.findFirst({
      where: { name: 'triage', version: promptVersion, state: 'PUBLISHED' },
    });
    if (template) promptBody = template.body;

    const prompt = promptBody
      .replace('{{market_title}}', marketTitle)
      .replace('{{market_description}}', marketDescription || '')
      .replace('{{category}}', category)
      .replace('{{liquidity}}', String(liquidity))
      .replace('{{implied_probability}}', String(impliedProbability));

    const routing = await getStageRouting();
    const model = getModelForStage('triage', routing, strategy.triageModel || strategy.defaultModel);
    const { data } = await callLLMJson<TriageOutput>(prompt, undefined, model);

    return {
      status: data.status || 'AMBIGUOUS',
      reason: data.reason || 'No reason provided',
      worthResearch: data.worthResearch ?? data.status === 'RELEVANT',
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Triage] Failed for ${marketId}:`, errorMsg);

    // Return AMBIGUOUS on error so pipeline can continue gracefully
    return {
      status: 'AMBIGUOUS',
      reason: `Triage failed: ${errorMsg}`,
      worthResearch: false,
    };
  }
}