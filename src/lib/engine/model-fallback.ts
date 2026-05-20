import { getStageRouting } from './service-routing';
import { buildFallbackChain, fetchAvailableModels } from './model-discovery';

/**
 * Get model with fallback chain for a specific agent/stage
 * AUTO-FETCHES from LiteLLM API - no hardcoding!
 */
export async function getModelWithFallbacks(
  stage: 'triage' | 'bull' | 'bear' | 'contradiction' | 'judge' | 'deerflow' | 'deerflow' |
         'news' | 'sentiment' | 'technical' | 'deepThink' | 'quickThink'
): Promise<string[]> {
  const routing = await getStageRouting();
  
  // Map stages to their model config fields
  const modelMap: Record<string, { primary?: string; fallbacks?: string[]; fallbackField?: string }> = {
    triage: { 
      primary: routing.triageModel, 
      fallbacks: routing.triageFallbackModels,
      fallbackField: 'triageFallbackModels'
    },
    bull: { 
      primary: routing.bullModel, 
      fallbacks: routing.bullFallbackModels,
      fallbackField: 'bullFallbackModels'
    },
    bear: { 
      primary: routing.bearModel, 
      fallbacks: routing.bearFallbackModels,
      fallbackField: 'bearFallbackModels'
    },
    contradiction: { 
      primary: routing.contradictionModel, 
      fallbacks: routing.contradictionFallbackModels,
      fallbackField: 'contradictionFallbackModels'
    },
    judge: { 
      primary: routing.judgeModel, 
      fallbacks: routing.judgeFallbackModels,
      fallbackField: 'judgeFallbackModels'
    },
    news: { 
      primary: routing.newsAnalystModel, 
      fallbacks: routing.newsAnalystFallbackModels,
      fallbackField: 'newsAnalystFallbackModels'
    },
    sentiment: { 
      primary: routing.sentimentAnalystModel, 
      fallbacks: routing.sentimentAnalystFallbackModels,
      fallbackField: 'sentimentAnalystFallbackModels'
    },
    technical: { 
      primary: routing.technicalAnalystModel, 
      fallbacks: routing.technicalAnalystFallbackModels,
      fallbackField: 'technicalAnalystFallbackModels'
    },
    deepThink: { 
      primary: routing.analystDeepThinkLlm, 
      fallbacks: routing.analystDeepThinkFallbackModels,
      fallbackField: 'analystDeepThinkFallbackModels'
    },
    quickThink: { 
      primary: routing.analystQuickThinkLlm, 
      fallbacks: routing.analystQuickThinkFallbackModels,
      fallbackField: 'analystQuickThinkFallbackModels'
    },
  };
  
  const config = modelMap[stage];
  if (!config?.primary) {
    // Fallback to auto-discovery if no config
    console.log(`[Fallback] ${stage}: No config, auto-discovering...`);
    const available = await fetchAvailableModels();
    return available.slice(0, 4);
  }
  
  // If fallbacks are configured, use them
  if (config.fallbacks && config.fallbacks.length > 0) {
    const chain = [config.primary, ...config.fallbacks.filter(f => f !== config.primary)];
    console.log(`[Fallback] ${stage}: Using configured chain [${chain.join(' → ')}]`);
    return chain;
  }
  
  // Otherwise, build dynamic fallback chain from API
  console.log(`[Fallback] ${stage}: Building dynamic chain for ${config.primary}...`);
  return await buildFallbackChain(config.primary);
}

/**
 * Try calling an LLM function with fallback models
 * Automatically retries with fallback models if primary fails
 */
export async function callWithFallback<T>(
  stage: 'triage' | 'bull' | 'bear' | 'contradiction' | 'judge' | 'deerflow' | 
         'news' | 'sentiment' | 'technical' | 'deepThink' | 'quickThink',
  callFn: (model: string) => Promise<T>,
  timeoutMs: number = 60000
): Promise<{ result: T; modelUsed: string } | null> {
  const models = await getModelWithFallbacks(stage);
  let lastError = 'unknown';
  
  console.log(`[Fallback] ${stage}: Will try models [${models.join(' → ')}]`);
  
  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    console.log(`[Fallback] ${stage}: Attempt ${i + 1}/${models.length} with ${model}`);
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      
      const result = await Promise.race([
        callFn(model),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error(`Timeout after ${timeoutMs}ms`));
          });
        })
      ]);
      
      clearTimeout(timeoutId);
      
      console.log(`[Fallback] ${stage}: ✅ Success with ${model}`);
      return { result, modelUsed: model };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      lastError = `${model}: ${errorMsg}`;
      console.log(`[Fallback] ${stage}: ❌ ${lastError}`);
      
      // Continue to next fallback
      continue;
    }
  }
  
  console.error(`[Fallback] ${stage}: All models failed. Last error: ${lastError}`);
  return null;
}
