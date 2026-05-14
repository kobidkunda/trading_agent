import { callLLMJson } from '@/lib/engine/llm-client';
import { searchSearXNG, getCredentialForService } from '@/lib/engine/research/search';
import { extractContent } from '@/lib/engine/research/extract';
import { runDeerFlowViaAPI } from '@/lib/engine/research/deerflow-api';
import { db } from '@/lib/db';
import type { StageServiceMapping } from '@/lib/types';

export interface DeerFlowResult {
  summary: string;
  keyFindings: string[];
  contradictions: string[];
  confidenceAssessment: number;
  sourceQuality: number;
  iterations: number;
  totalSources: number;
  allSearchResults: Array<{ title: string; url: string; snippet: string }>;
  allExtractedContent: Array<{ title: string; content: string; url: string }>;
}

interface FollowUpQuestions {
  questions: string[];
  confidenceGap: string;
  reasoning: string;
}

interface ResearchSynthesis {
  summary: string;
  keyFindings: string[];
  contradictions: string[];
  confidenceAssessment: number;
  sourceQuality: number;
}

const DEERFLOW_SYSTEM_PROMPT = `You are a deep research agent for a prediction market trading system. You conduct iterative, multi-hop research to build a comprehensive understanding of a market topic.

Your process:
1. Analyze initial search results
2. Identify gaps in knowledge and formulate follow-up questions
3. Search for answers to those questions
4. Extract and synthesize content from sources
5. Repeat until confidence threshold is met or max iterations reached

Always respond with valid JSON.`;

const FOLLOW_UP_PROMPT = `Given the following research context about: "{{market_title}}"

Current Implied Probability: {{implied_probability}}

EXISTING RESEARCH:
{{research_context}}

Based on this research, identify the most important follow-up questions that would help resolve uncertainty about this market. Focus on:
1. What critical information is still missing?
2. What aspects have contradictory evidence?
3. What recent developments might change the probability?

Respond in JSON:
{
  "questions": ["question1", "question2", "question3"],
  "confidenceGap": "What we still don't know",
  "reasoning": "Why these questions matter for the probability estimate"
}`;

const SYNTHESIS_PROMPT = `Synthesize ALL the following research into a comprehensive analysis for: "{{market_title}}"

Current Implied Probability: {{implied_probability}}

RESEARCH CONTEXT (gathered over {{iterations}} iterations, {{total_sources}} sources):
{{full_context}}

Provide a final synthesis that:
1. Summarizes the key findings
2. Identifies contradictions in the evidence
3. Assesses overall confidence in the research
4. Rates the quality of sources

Respond in JSON:
{
  "summary": "Comprehensive summary of findings",
  "keyFindings": ["finding1", "finding2", ...],
  "contradictions": ["contradiction1", ...],
  "confidenceAssessment": 0.XX,
  "sourceQuality": 0.XX
}`;

async function getDeerFlowLLMConfig(routing?: StageServiceMapping): Promise<{ baseUrl: string; apiKey: string; model: string }> {
  const llmCred = await getCredentialForService('llm');
  if (llmCred && llmCred.baseUrl) {
    const model = routing?.deerflowModel || routing?.bullModel || 'paper_lite';
    return { baseUrl: llmCred.baseUrl, apiKey: llmCred.apiKey, model };
  }

  const model = routing?.deerflowModel || routing?.bullModel || 'paper_lite';
  return { baseUrl: '', apiKey: '', model };
}

async function deerflowLLMCall<T>(
  prompt: string,
  systemPrompt: string,
  routing?: StageServiceMapping,
): Promise<{ data: T; meta: { model: string; tokenCount: number; latencyMs: number } }> {
  const config = await getDeerFlowLLMConfig(routing);
  const model = config.model || undefined;

  if (config.baseUrl) {
    try {
      const startTime = Date.now();
      const messages: Array<{ role: string; content: string }> = [];
      if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
      messages.push({ role: 'user', content: prompt });

      const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: model || 'paper_lite',
          messages,
          temperature: 0.3,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(60000),
      });

      if (!response.ok) {
        throw new Error(`DeerFlow LLM error ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const tokenCount = data.usage?.total_tokens || 0;
      const latencyMs = Date.now() - startTime;

      let parsedJson: T = {} as T;
      try { parsedJson = JSON.parse(content); } catch {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) try { parsedJson = JSON.parse(jsonMatch[0]); } catch {}
      }

      return { data: parsedJson, meta: { model: model || 'deerflow', tokenCount, latencyMs } };
    } catch (e) {
      console.error('[DeerFlow] LLM call with deerflow credential failed, falling back to default:', e);
    }
  }

  return callLLMJson<T>(prompt, systemPrompt, model);
}

export async function runDeerFlowResearch(
  marketTitle: string,
  marketDescription: string,
  impliedProbability: number,
  routing?: StageServiceMapping,
): Promise<DeerFlowResult> {
  const apiResult = await runDeerFlowViaAPI(
    marketTitle,
    impliedProbability,
    routing?.deerflowApiModel,
  );
  if (apiResult && apiResult.research.length > 100) {
    console.log('[DeerFlow] Used DeerFlow API instance successfully');
    const lines = apiResult.research.split('\n').filter((l) => l.trim());
    const keyFindings = lines.slice(0, 10).filter((l) => l.length > 20).slice(0, 5);
    return {
      summary: apiResult.research.slice(0, 500),
      keyFindings,
      contradictions: [],
      confidenceAssessment: 0.6,
      sourceQuality: 0.5,
      iterations: 1,
      totalSources: apiResult.sources.length,
      allSearchResults: apiResult.sources,
      allExtractedContent: [],
    };
  }

  console.log('[DeerFlow] DeerFlow API not available or returned insufficient results, falling back to local iterative research');
  return runDeerFlowLocal(marketTitle, marketDescription, impliedProbability, routing);
}

async function runDeerFlowLocal(
  marketTitle: string,
  marketDescription: string,
  impliedProbability: number,
  routing?: StageServiceMapping,
): Promise<DeerFlowResult> {
const maxIterations = routing?.deerflowSearchIterations ?? 5;
   const questionsPerIteration = routing?.deerflowQuestionsPerIteration ?? 5;
   const maxDepth = routing?.deerflowMaxDepth ?? 5;

  const allSearchResults: Array<{ title: string; url: string; snippet: string }> = [];
  const allExtractedContent: Array<{ title: string; content: string; url: string }> = [];

  let currentContext = '';
  let iteration = 0;
  let pendingQuestions: string[] = [marketTitle];

  for (let depth = 0; depth < Math.min(maxDepth, maxIterations); depth++) {
    iteration++;

    const searchQueries = pendingQuestions.slice(0, questionsPerIteration);
    const iterationResults: string[] = [];

    for (const query of searchQueries) {
      const maxResults = routing?.searchMaxResults ?? 50;
      const results = await searchSearXNG(query, maxResults);

      for (const r of results) {
        allSearchResults.push({ title: r.title, url: r.url, snippet: r.snippet });
        iterationResults.push(`${r.title}: ${r.snippet}`);

        const extracted = await extractContent(r.url);
        if (extracted && extracted.content.length > 50) {
          allExtractedContent.push({
            title: extracted.title,
            content: extracted.content.slice(0, 2000),
            url: r.url,
          });
          iterationResults.push(`[SOURCE: ${r.url}]\n${extracted.content.slice(0, 1500)}`);
        }
      }
    }

    currentContext = iterationResults.join('\n\n');

    if (depth < Math.min(maxDepth, maxIterations) - 1) {
      try {
        const followUpPrompt = FOLLOW_UP_PROMPT
          .replace('{{market_title}}', marketTitle)
          .replace('{{implied_probability}}', String(impliedProbability))
          .replace('{{research_context}}', currentContext.slice(0, 6000));

        const { data } = await deerflowLLMCall<FollowUpQuestions>(followUpPrompt, DEERFLOW_SYSTEM_PROMPT, routing);

        if (data.questions && Array.isArray(data.questions) && data.questions.length > 0) {
          pendingQuestions = data.questions;
        } else {
          break;
        }
      } catch (e) {
        console.error('[DeerFlow] Follow-up question generation failed:', e);
        break;
      }
    }
  }

  try {
    const synthesisPrompt = SYNTHESIS_PROMPT
      .replace('{{market_title}}', marketTitle)
      .replace('{{implied_probability}}', String(impliedProbability))
      .replace('{{iterations}}', String(iteration))
      .replace('{{total_sources}}', String(allSearchResults.length + allExtractedContent.length))
      .replace('{{full_context}}', currentContext.slice(0, 12000));

    const { data } = await deerflowLLMCall<ResearchSynthesis>(synthesisPrompt, DEERFLOW_SYSTEM_PROMPT, routing);

    return {
      summary: data.summary || 'DeerFlow research completed',
      keyFindings: data.keyFindings || [],
      contradictions: data.contradictions || [],
      confidenceAssessment: typeof data.confidenceAssessment === 'number' ? data.confidenceAssessment : 0.5,
      sourceQuality: typeof data.sourceQuality === 'number' ? data.sourceQuality : 0.5,
      iterations: iteration,
      totalSources: allSearchResults.length + allExtractedContent.length,
      allSearchResults,
      allExtractedContent,
    };
  } catch (e) {
    console.error('[DeerFlow] Synthesis failed:', e);
    return {
      summary: currentContext.slice(0, 3000) || 'Research completed but synthesis failed',
      keyFindings: [],
      contradictions: [],
      confidenceAssessment: 0.4,
      sourceQuality: 0.3,
      iterations: iteration,
      totalSources: allSearchResults.length + allExtractedContent.length,
      allSearchResults,
      allExtractedContent,
    };
  }
}