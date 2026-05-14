import { NextRequest, NextResponse } from 'next/server';
import { autoUpdateFallbackModels, fetchAvailableModels, buildFallbackChain } from '@/lib/engine/model-discovery';
import { db } from '@/lib/db';

/**
 * GET /api/models
 * Returns available models from LiteLLM and current fallback configuration
 */
export async function GET() {
  try {
    // Fetch available models from LiteLLM
    const availableModels = await fetchAvailableModels();
    
    // Get current strategy with fallback config
    const setting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
    const strategy = setting ? JSON.parse(setting.value) : {};
    
    // Extract fallback configuration
    const fallbackConfig: Record<string, string[]> = {};
    const fields = [
      'triageFallbackModels',
      'bullFallbackModels', 
      'bearFallbackModels',
      'contradictionFallbackModels',
      'judgeFallbackModels',
      'deerflowFallbackModels',
      'newsAnalystFallbackModels',
      'sentimentAnalystFallbackModels',
      'technicalAnalystFallbackModels',
      'analystDeepThinkFallbackModels',
      'analystQuickThinkFallbackModels',
    ];
    
    for (const field of fields) {
      if (strategy.stageRouting?.[field]) {
        fallbackConfig[field] = strategy.stageRouting[field];
      }
    }
    
    return NextResponse.json({
      availableModels,
      totalModels: availableModels.length,
      fallbackConfig,
      lastUpdated: setting?.updatedAt || new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Models API] Error:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch models',
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

/**
 * POST /api/models
 * Triggers auto-discovery and update of fallback models
 * Body: { "stage": "judge" } to test specific stage, or empty to update all
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { stage, testModel, action } = body;
    
    if (action === 'test' && testModel) {
      // Test building a fallback chain for a specific model
      const chain = await buildFallbackChain(testModel);
      return NextResponse.json({
        action: 'test',
        primaryModel: testModel,
        fallbackChain: chain,
        totalModels: chain.length,
      });
    }
    
    if (stage) {
      // Update fallback for specific stage only
      const setting = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
      if (!setting) {
        return NextResponse.json({ error: 'No strategy settings found' }, { status: 404 });
      }
      
      const strategy = JSON.parse(setting.value);
      strategy.stageRouting = strategy.stageRouting || {};
      
      const modelField = `${stage}Model`;
      const fallbackField = `${stage}FallbackModels`;
      const primaryModel = strategy.stageRouting[modelField] || 'paper_prokimi';
      
      const chain = await buildFallbackChain(primaryModel);
      strategy.stageRouting[fallbackField] = chain.filter(m => m !== primaryModel);
      
      await db.settings.update({
        where: { key: 'strategy_settings' },
        data: { value: JSON.stringify(strategy), updatedAt: new Date() }
      });
      
      return NextResponse.json({
        action: 'update_stage',
        stage,
        primaryModel,
        fallbackModels: strategy.stageRouting[fallbackField],
        success: true,
      });
    }
    
    // Update all fallback models
    await autoUpdateFallbackModels();
    
    // Get updated config
    const updated = await db.settings.findUnique({ where: { key: 'strategy_settings' } });
    const updatedStrategy = updated ? JSON.parse(updated.value) : {};
    
    return NextResponse.json({
      action: 'update_all',
      success: true,
      message: 'All fallback models updated from LiteLLM API',
      updatedAt: updated?.updatedAt,
      config: {
        triage: updatedStrategy.stageRouting?.triageFallbackModels,
        judge: updatedStrategy.stageRouting?.judgeFallbackModels,
        deepThink: updatedStrategy.stageRouting?.analystDeepThinkFallbackModels,
      }
    });
  } catch (error) {
    console.error('[Models API] Error:', error);
    return NextResponse.json({ 
      error: 'Failed to update models',
      message: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
