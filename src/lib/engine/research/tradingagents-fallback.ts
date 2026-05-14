import { db } from '@/lib/db';
import type { TradingAgentsSimpleResult } from './tradingagents-api';

// Fallback model chain for TradingAgents
const FALLBACK_MODELS = [
  'paper_prokimi',  // Primary (Kimi - working)
  'paper_proglm',   // Fallback 1 (GLM - usually working)
  'paper_flashmimi', // Fallback 2 (Flash Mini)
  'paper_lite',     // Fallback 3 (Lite - fastest)
];

interface RetryConfig {
  maxRetries: number;
  timeoutMs: number;
  fallbackModels: string[];
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  timeoutMs: 60000,
  fallbackModels: FALLBACK_MODELS,
};

/**
 * Run TradingAgents with automatic fallback models
 * Tries primary model first, then falls back to working models
 */
export async function runTradingAgentsWithFallback(
  query: string,
  date?: string,
  config: Partial<RetryConfig> = {}
): Promise<TradingAgentsSimpleResult | null> {
  const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const routing = await getTradingAgentsRouting();
  
  // Start with configured model, then try fallbacks
  const modelsToTry = [
    routing.analystDeepThinkLlm,
    ...retryConfig.fallbackModels.filter(m => m !== routing.analystDeepThinkLlm)
  ];
  
  console.log(`[TradingAgents Fallback] Will try models: ${modelsToTry.join(' → ')}`);
  
  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    console.log(`[TradingAgents Fallback] Attempt ${i + 1}/${modelsToTry.length} with model: ${model}`);
    
    try {
      const result = await runTradingAgentsWithTimeout(
        query,
        date,
        model,
        routing.analystQuickThinkLlm,
        routing.analystLlmProvider,
        retryConfig.timeoutMs
      );
      
      if (result && result.status === 'completed') {
        console.log(`[TradingAgents Fallback] ✅ Success with model: ${model}`);
        return result;
      }
      
      console.log(`[TradingAgents Fallback] ⚠️ Model ${model} returned incomplete result`);
    } catch (error) {
      console.error(`[TradingAgents Fallback] ❌ Model ${model} failed:`, error);
    }
  }
  
  console.error('[TradingAgents Fallback] ❌ All models failed');
  return null;
}

/**
 * Run TradingAgents with specific timeout
 */
async function runTradingAgentsWithTimeout(
  query: string,
  date: string | undefined,
  deepThinkLlm: string,
  quickThinkLlm: string,
  llmProvider: string,
  timeoutMs: number
): Promise<TradingAgentsSimpleResult | null> {
  const cred = await getCredentialForService('tradingagents');
  const baseUrl = cred?.baseUrl || process.env.TRADINGAGENTS_URL || 'http://localhost:8100';
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/analyze/all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cred?.apiKey ? { Authorization: `Bearer ${cred.apiKey}` } : {}),
      },
      body: JSON.stringify({
        query,
        date: date || new Date().toISOString().split('T')[0],
        deep_think_llm: deepThinkLlm,
        quick_think_llm: quickThinkLlm,
        llm_provider: llmProvider,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Get TradingAgents routing config from strategy
 */
async function getTradingAgentsRouting() {
  const strategySetting = await db.settings.findUnique({
    where: { key: 'strategy_settings' }
  });
  
  const strategy = strategySetting ? JSON.parse(strategySetting.value) : {};
  
  return {
    analystDeepThinkLlm: strategy.stageRouting?.analystDeepThinkLlm || 'paper_prokimi',
    analystQuickThinkLlm: strategy.stageRouting?.analystQuickThinkLlm || 'paper_prokimi',
    analystLlmProvider: strategy.stageRouting?.analystLlmProvider || 'openai',
  };
}

/**
 * Get credential for a service
 */
async function getCredentialForService(service: string) {
  const cred = await db.credential.findFirst({
    where: { 
      service: { in: [service, 'tradingagents', 'TradingAgents'] },
      isActive: true 
    },
    orderBy: { createdAt: 'desc' },
  });
  
  if (!cred) return null;
  
  // Parse encrypted data
  let parsedData: { baseUrl?: string; apiKey?: string } = {};
  try {
    if (cred.encryptedData) {
      const { decrypt } = await import('@/lib/engine/crypto');
      const raw = decrypt(cred.encryptedData);
      parsedData = JSON.parse(raw);
    }
  } catch {
    // If decryption fails, use serviceUrl
  }
  
  return {
    baseUrl: parsedData.baseUrl || cred.serviceUrl,
    apiKey: parsedData.apiKey,
  };
}
