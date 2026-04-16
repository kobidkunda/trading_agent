import { callLLMJson } from '@/lib/engine/llm-client';
import { db } from '@/lib/db';
import { DEFAULT_PROMPT_TEMPLATES } from '@/lib/constants';
import type { BullOutput } from './bull';
import type { BearOutput } from './bear';

export interface ContradictionOutput {
  contradictions: string[];
  overlookedRisks: string[];
  alternativeInterpretations: string[];
  reliabilityAssessment: number;
}

export async function runContradictionAgent(
  marketId: string,
  marketTitle: string,
  bullOutput: BullOutput,
  bearOutput: BearOutput,
): Promise<ContradictionOutput> {
  const promptSetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  const strategy = promptSetting ? JSON.parse(promptSetting.value) : {};
  const promptVersion = strategy.promptVersion?.contradiction ?? 1;

  let promptBody = DEFAULT_PROMPT_TEMPLATES.contradiction;
  const template = await db.promptTemplate.findFirst({
    where: { name: 'contradiction', version: promptVersion, state: 'PUBLISHED' },
  });
  if (template) promptBody = template.body;

  const prompt = promptBody
    .replace('{{market_title}}', marketTitle)
    .replace('{{bull_thesis}}', bullOutput.thesis)
    .replace('{{bear_thesis}}', bearOutput.thesis);

  const { data } = await callLLMJson<ContradictionOutput>(prompt, undefined, strategy.researchModel);

  return {
    contradictions: data.contradictions || [],
    overlookedRisks: data.overlookedRisks || [],
    alternativeInterpretations: data.alternativeInterpretations || [],
    reliabilityAssessment: typeof data.reliabilityAssessment === 'number' ? data.reliabilityAssessment : 0.5,
  };
}