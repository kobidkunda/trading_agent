import { callLLMJson } from '@/lib/engine/llm-client';
import { db } from '@/lib/db';
import { DEFAULT_PROMPT_TEMPLATES } from '@/lib/constants';
import { getStageRouting, getModelForStage } from '@/lib/engine/service-routing';

export interface BearOutput {
  thesis: string;
  keyArguments: string[];
  supportingEvidence: string[];
  estimatedProbability: number;
  confidence: number;
}

export async function runBearAgent(
  marketId: string,
  marketTitle: string,
  impliedProbability: number,
  researchContext: string,
): Promise<BearOutput> {
  try {
    const promptSetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
    const strategy = promptSetting ? JSON.parse(promptSetting.value) : {};
    const promptVersion = strategy.promptVersion?.bear ?? 1;

    let promptBody = DEFAULT_PROMPT_TEMPLATES.bear;
    const template = await db.promptTemplate.findFirst({
      where: { name: 'bear', version: promptVersion, state: 'PUBLISHED' },
    });
    if (template) promptBody = template.body;

    const prompt = promptBody
      .replace('{{market_title}}', marketTitle)
      .replace('{{implied_probability}}', String(impliedProbability))
      .replace('{{research_context}}', researchContext || 'No additional research available');

    const routing = await getStageRouting();
    const model = getModelForStage('bear', routing, strategy.researchModel || strategy.defaultModel);
    const { data } = await callLLMJson<BearOutput>(prompt, undefined, model);

    return {
      thesis: data.thesis || 'Bear thesis unavailable',
      keyArguments: data.keyArguments || [],
      supportingEvidence: data.supportingEvidence || [],
      estimatedProbability: typeof data.estimatedProbability === 'number' ? data.estimatedProbability : impliedProbability - 0.05,
      confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Bear] Failed for ${marketId}:`, errorMsg);

    return {
      thesis: `Bear case: ${marketTitle} - LLM error occurred, using implied probability`,
      keyArguments: ['Market pricing may be optimistic', 'Research unavailable due to technical error'],
      supportingEvidence: ['Implied probability from market pricing'],
      estimatedProbability: impliedProbability - 0.05,
      confidence: 0.3,
    };
  }
}