import { callLLMJson } from '@/lib/engine/llm-client';
import { db } from '@/lib/db';
import { DEFAULT_PROMPT_TEMPLATES } from '@/lib/constants';
import { getStageRouting, getModelForStage } from '@/lib/engine/service-routing';

export interface TriageOutput {
  status: 'RELEVANT' | 'IRRELEVANT' | 'AMBIGUOUS' | 'ANALYSIS_DEGRADED';
  reason: string;
  worthResearch: boolean;
  score: number;
}

export function isAnalysisDegradedReason(reason: string | null | undefined): boolean {
  return typeof reason === 'string' && reason.includes('ANALYSIS_DEGRADED');
}

export function buildTriageFailureOutput(errorMsg: string): TriageOutput {
  return {
    status: 'ANALYSIS_DEGRADED',
    reason: `ANALYSIS_DEGRADED: Triage LLM unavailable; NO_TRADE until triage recovers. ${errorMsg}`,
    worthResearch: false,
    score: 0,
  };
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
      score: data.score || 0,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Triage] Failed for ${marketId}:`, errorMsg);

    return buildTriageFailureOutput(errorMsg);
  }
}