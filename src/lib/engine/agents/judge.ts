import { callLLMJson } from '@/lib/engine/llm-client';
import { db } from '@/lib/db';
import { DEFAULT_PROMPT_TEMPLATES } from '@/lib/constants';
import type { BullOutput } from './bull';
import type { BearOutput } from './bear';
import type { ContradictionOutput } from './contradiction';
import type { JudgeOutput } from '@/lib/types';

export async function runJudgeAgent(
  marketId: string,
  marketTitle: string,
  impliedProbability: number,
  bullOutput: BullOutput,
  bearOutput: BearOutput,
  contradictionOutput: ContradictionOutput,
): Promise<JudgeOutput> {
  const promptSetting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  const strategy = promptSetting ? JSON.parse(promptSetting.value) : {};
  const promptVersion = strategy.promptVersion?.judge ?? 1;

  let promptBody = DEFAULT_PROMPT_TEMPLATES.judge;
  const template = await db.promptTemplate.findFirst({
    where: { name: 'judge', version: promptVersion, state: 'PUBLISHED' },
  });
  if (template) promptBody = template.body;

  const prompt = promptBody
    .replace('{{market_title}}', marketTitle)
    .replace('{{implied_probability}}', String(impliedProbability))
    .replace('{{bull_output}}', JSON.stringify(bullOutput))
    .replace('{{bear_output}}', JSON.stringify(bearOutput))
    .replace('{{contradiction_output}}', JSON.stringify(contradictionOutput));

  const { data } = await callLLMJson<JudgeOutput>(prompt, undefined, strategy.judgeModel);

  return {
    trueProbability: typeof data.trueProbability === 'number' ? data.trueProbability : impliedProbability,
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
    uncertainty: typeof data.uncertainty === 'number' ? data.uncertainty : 0.3,
    uncertaintyPenalty: typeof data.uncertaintyPenalty === 'number' ? data.uncertaintyPenalty : 0.15,
    proEvidence: data.proEvidence || bullOutput.keyArguments.slice(0, 2),
    antiEvidence: data.antiEvidence || bearOutput.keyArguments.slice(0, 2),
    sourceQuality: typeof data.sourceQuality === 'number' ? data.sourceQuality : 0.6,
    freshness: typeof data.freshness === 'number' ? data.freshness : 0.7,
    catalystTiming: data.catalystTiming || 'NONE',
    skipReason: data.skipReason,
  };
}