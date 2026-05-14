import { callLLMJson } from '@/lib/engine/llm-client';
import { db } from '@/lib/db';
import { DEFAULT_PROMPT_TEMPLATES } from '@/lib/constants';
import { getStageRouting, getModelForStage } from '@/lib/engine/service-routing';

export interface BullOutput {
  thesis: string;
  keyArguments: string[];
  supportingEvidence: string[];
  estimatedProbability: number;
  confidence: number;
}

export async function runBullAgent(
  marketId: string,
  marketTitle: string,
  impliedProbability: number,
  researchContext: string,
): Promise<BullOutput> {
  try {
    const promptSetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
    const strategy = promptSetting ? JSON.parse(promptSetting.value) : {};
    const promptVersion = strategy.promptVersion?.bull ?? 1;

    let promptBody = DEFAULT_PROMPT_TEMPLATES.bull;
    const template = await db.promptTemplate.findFirst({
      where: { name: 'bull', version: promptVersion, state: 'PUBLISHED' },
    });
    if (template) promptBody = template.body;

    const prompt = promptBody
      .replace('{{market_title}}', marketTitle)
      .replace('{{implied_probability}}', String(impliedProbability))
      .replace('{{research_context}}', researchContext || 'No additional research available');

    const routing = await getStageRouting();
    const model = getModelForStage('bull', routing, strategy.researchModel || strategy.defaultModel);
    const { data } = await callLLMJson<BullOutput>(prompt, undefined, model);

    return {
      thesis: data.thesis || 'Bull thesis unavailable',
      keyArguments: data.keyArguments || [],
      supportingEvidence: data.supportingEvidence || [],
      estimatedProbability: typeof data.estimatedProbability === 'number' ? data.estimatedProbability : impliedProbability + 0.05,
      confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Bull] Failed for ${marketId}:`, errorMsg);

    return {
      thesis: `Bull case: ${marketTitle} - LLM error occurred, using implied probability`,
      keyArguments: ['Market pricing reflects positive sentiment', 'Research unavailable due to technical error'],
      supportingEvidence: ['Implied probability from market pricing'],
      estimatedProbability: impliedProbability + 0.05,
      confidence: 0.3,
    };
  }
}