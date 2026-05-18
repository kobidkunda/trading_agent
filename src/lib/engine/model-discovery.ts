import { db } from '@/lib/db';
import { getCredentialForService } from '@/lib/engine/research/search';

// Model performance tiers (will be auto-populated from API)
export interface ModelTier {
  id: string;
  tier: 'premium' | 'standard' | 'fast' | 'lite';
  family: string;
  estimatedQuality: number; // 0-1
  estimatedSpeed: number; // 0-1
}

// Default tier mappings for known models (fallback if API fails)
const DEFAULT_MODEL_TIERS: Record<string, ModelTier> = {
  // Premium tier - highest quality
  'paper_prokimi': { id: 'paper_prokimi', tier: 'premium', family: 'kimi', estimatedQuality: 0.95, estimatedSpeed: 0.7 },
  'paper_proglm': { id: 'paper_proglm', tier: 'premium', family: 'glm', estimatedQuality: 0.92, estimatedSpeed: 0.75 },
  'paper_progpt': { id: 'paper_progpt', tier: 'premium', family: 'gpt', estimatedQuality: 0.93, estimatedSpeed: 0.8 },
  'gpt-5': { id: 'gpt-5', tier: 'premium', family: 'gpt', estimatedQuality: 0.94, estimatedSpeed: 0.75 },
  'claude-opus-4-6-thinking': { id: 'claude-opus-4-6-thinking', tier: 'premium', family: 'claude', estimatedQuality: 0.96, estimatedSpeed: 0.6 },
  
  // Standard tier - balanced
  'paper_progem': { id: 'paper_progem', tier: 'standard', family: 'gemini', estimatedQuality: 0.85, estimatedSpeed: 0.85 },
  'paper_proqwen': { id: 'paper_proqwen', tier: 'standard', family: 'qwen', estimatedQuality: 0.83, estimatedSpeed: 0.8 },
  'gemini-2-5-pro': { id: 'gemini-2-5-pro', tier: 'standard', family: 'gemini', estimatedQuality: 0.84, estimatedSpeed: 0.85 },
  'kimi-k2-5': { id: 'kimi-k2-5', tier: 'standard', family: 'kimi', estimatedQuality: 0.82, estimatedSpeed: 0.8 },
  
  // Fast tier - quick responses
  'paper_flashmimi': { id: 'paper_flashmimi', tier: 'fast', family: 'flash', estimatedQuality: 0.75, estimatedSpeed: 0.95 },
  'paper_flashgem': { id: 'paper_flashgem', tier: 'fast', family: 'flash', estimatedQuality: 0.73, estimatedSpeed: 0.95 },
  'gemini-2-5-flash': { id: 'gemini-2-5-flash', tier: 'fast', family: 'gemini', estimatedQuality: 0.76, estimatedSpeed: 0.92 },
  'kimi-k2p5-turbo': { id: 'kimi-k2p5-turbo', tier: 'fast', family: 'kimi', estimatedQuality: 0.78, estimatedSpeed: 0.9 },
  'flash_free_only': { id: 'flash_free_only', tier: 'fast', family: 'free', estimatedQuality: 0.7, estimatedSpeed: 0.96 },
  
  // Lite tier - fastest, lowest quality
  'paper_lite': { id: 'paper_lite', tier: 'lite', family: 'lite', estimatedQuality: 0.65, estimatedSpeed: 0.98 },
  'paper_mimo': { id: 'paper_mimo', tier: 'lite', family: 'mimo', estimatedQuality: 0.6, estimatedSpeed: 0.98 },
  'lite': { id: 'lite', tier: 'lite', family: 'lite', estimatedQuality: 0.55, estimatedSpeed: 0.99 },
  'gpt-4o-mini-tts': { id: 'gpt-4o-mini-tts', tier: 'lite', family: 'gpt', estimatedQuality: 0.7, estimatedSpeed: 0.95 },
};

// Tier priority for fallback chains (highest quality first)
const TIER_PRIORITY = ['premium', 'standard', 'fast', 'lite'];

/**
 * Fetch available models from LiteLLM API
 */
export async function fetchAvailableModels(): Promise<string[]> {
  try {
    const cred = await getCredentialForService('llm');
    const baseUrl = cred?.baseUrl || process.env.OPENAI_BASE_URL || '';
    const apiKey = cred?.apiKey || process.env.OPENAI_API_KEY || '';
    
    console.log('[ModelDiscovery] Fetching available models from LiteLLM...');
    
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });
    
    if (!response.ok) {
      console.warn(`[ModelDiscovery] Failed to fetch models: HTTP ${response.status}`);
      return Object.keys(DEFAULT_MODEL_TIERS);
    }
    
    const data = await response.json();
    const models = data.data?.map((m: { id: string }) => m.id) || [];
    
    console.log(`[ModelDiscovery] Found ${models.length} models from LiteLLM`);
    
    // Filter to paper_* models and known good models
    const preferredModels = models.filter((id: string) => {
      // Prioritize paper_* models (our naming convention)
      if (id.startsWith('paper_')) return true;
      // Include other known good models
      if (['gpt-5', 'claude-opus-4-6-thinking', 'gemini-2-5-pro', 'kimi-k2-5', 'kimi-k2p5-turbo'].includes(id)) return true;
      return false;
    });
    
    console.log(`[ModelDiscovery] ${preferredModels.length} preferred models identified`);
    
    return preferredModels.length > 0 ? preferredModels : models;
  } catch (error) {
    console.error('[ModelDiscovery] Error fetching models:', error);
    return Object.keys(DEFAULT_MODEL_TIERS);
  }
}

/**
 * Categorize model into tier based on name patterns
 */
function categorizeModel(modelId: string): ModelTier {
  // Check if we have predefined tier
  if (DEFAULT_MODEL_TIERS[modelId]) {
    return DEFAULT_MODEL_TIERS[modelId];
  }
  
  // Auto-categorize based on name patterns
  const id = modelId.toLowerCase();
  
  // Premium indicators
  if (id.includes('pro') && (id.includes('kimi') || id.includes('glm') || id.includes('gpt'))) {
    return { id: modelId, tier: 'premium', family: 'auto-pro', estimatedQuality: 0.9, estimatedSpeed: 0.75 };
  }
  
  // Fast indicators
  if (id.includes('flash') || id.includes('turbo') || id.includes('fast')) {
    return { id: modelId, tier: 'fast', family: 'auto-fast', estimatedQuality: 0.75, estimatedSpeed: 0.92 };
  }
  
  // Lite indicators
  if (id.includes('lite') || id.includes('mini') || id.includes('mimo')) {
    return { id: modelId, tier: 'lite', family: 'auto-lite', estimatedQuality: 0.65, estimatedSpeed: 0.95 };
  }
  
  // Default to standard
  return { id: modelId, tier: 'standard', family: 'auto', estimatedQuality: 0.8, estimatedSpeed: 0.8 };
}

/**
 * Build intelligent fallback chain for a primary model
 * Uses tier-based priority and diversity (different families)
 */
export async function buildFallbackChain(primaryModel: string): Promise<string[]> {
  const availableModels = await fetchAvailableModels();
  
  // Remove primary from available list
  const otherModels = availableModels.filter(m => m !== primaryModel);
  
  if (otherModels.length === 0) {
    return [primaryModel];
  }
  
  // Categorize all models
  const primaryTier = categorizeModel(primaryModel);
  const modelTiers = otherModels.map(categorizeModel);
  
  // Build chain: same tier first, then progressively lower tiers
  const chain: string[] = [primaryModel];
  
  // Find primary tier index
  const primaryTierIndex = TIER_PRIORITY.indexOf(primaryTier.tier);
  
  // Add models from same tier (different families preferred)
  const sameTier = modelTiers
    .filter(m => m.tier === primaryTier.tier && m.id !== primaryModel)
    .sort((a, b) => {
      // Prefer different family
      if (a.family === primaryTier.family && b.family !== primaryTier.family) return 1;
      if (a.family !== primaryTier.family && b.family === primaryTier.family) return -1;
      // Then by quality
      return b.estimatedQuality - a.estimatedQuality;
    });
  
  for (const model of sameTier.slice(0, 2)) {
    if (!chain.includes(model.id)) chain.push(model.id);
  }
  
  // Add models from lower tiers
  for (let i = primaryTierIndex + 1; i < TIER_PRIORITY.length; i++) {
    const tier = TIER_PRIORITY[i];
    const tierModels = modelTiers
      .filter(m => m.tier === tier)
      .sort((a, b) => b.estimatedQuality - a.estimatedQuality);
    
    for (const model of tierModels.slice(0, 2)) {
      if (!chain.includes(model.id)) chain.push(model.id);
    }
  }
  
  // Ensure we have at least 3 fallbacks
  if (chain.length < 4) {
    const remaining = modelTiers
      .filter(m => !chain.includes(m.id))
      .sort((a, b) => b.estimatedQuality - a.estimatedQuality);
    
    for (const model of remaining.slice(0, 4 - chain.length)) {
      chain.push(model.id);
    }
  }
  
  console.log(`[ModelDiscovery] Fallback chain for ${primaryModel}:`, chain.join(' → '));
  
  return chain;
}

/**
 * Auto-update all strategy settings with dynamic fallback chains
 */
export async function autoUpdateFallbackModels(): Promise<void> {
  console.log('[ModelDiscovery] Auto-updating fallback models from LiteLLM API...');
  
  const setting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
  if (!setting) {
    console.warn('[ModelDiscovery] No strategy settings found');
    return;
  }
  
  const strategy = JSON.parse(setting.value);
  strategy.stageRouting = strategy.stageRouting || {};
  
  const modelFields = [
    { model: 'triageModel', fallback: 'triageFallbackModels' },
    { model: 'bullModel', fallback: 'bullFallbackModels' },
    { model: 'bearModel', fallback: 'bearFallbackModels' },
    { model: 'contradictionModel', fallback: 'contradictionFallbackModels' },
    { model: 'judgeModel', fallback: 'judgeFallbackModels' },
    { model: 'deerflowModel', fallback: 'deerflowFallbackModels' },
    { model: 'newsAnalystModel', fallback: 'newsAnalystFallbackModels' },
    { model: 'sentimentAnalystModel', fallback: 'sentimentAnalystFallbackModels' },
    { model: 'technicalAnalystModel', fallback: 'technicalAnalystFallbackModels' },
    { model: 'analystDeepThinkLlm', fallback: 'analystDeepThinkFallbackModels' },
    { model: 'analystQuickThinkLlm', fallback: 'analystQuickThinkFallbackModels' },
  ];
  
  for (const { model, fallback } of modelFields) {
    const primaryModel = strategy.stageRouting[model] || 'paper_prokimi';
    
    // Build dynamic fallback chain
    const fallbackChain = await buildFallbackChain(primaryModel);
    
    // Remove primary from chain (it's already the primary)
    strategy.stageRouting[fallback] = fallbackChain.filter(m => m !== primaryModel);
    
    console.log(`[ModelDiscovery] ${fallback}: ${strategy.stageRouting[fallback].join(', ')}`);
  }
  
  // Save to database
  await db.settings.update({
    where: { key: 'strategy_settings' },
    data: { value: JSON.stringify(strategy), updatedAt: new Date() }
  });
  
  console.log('[ModelDiscovery] ✅ Auto-update complete');
}
