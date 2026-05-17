import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { runResolutionCycle } from '@/lib/engine/resolution-poller';
import { getAccuracyMetrics } from '@/lib/engine/paper-bets';

/**
 * Comprehensive verification endpoint
 * Tests:
 * 1. Source aggregation (500-600 target)
 * 2. Outcome pulling in dry-run mode
 * 3. Paper bet resolution
 * 4. All provider connections
 */

export async function GET() {
  const results: Record<string, any> = {};
  const errors: string[] = [];

  try {
    // Test 1: Check outcome pulling for dry-run markets
    console.log('[Verify] Testing outcome pulling...');
    
    const dryRunMarkets = await db.market.findMany({
      where: {
        decisions: { some: { dryRun: true } },
        status: { in: ['ACTIVE', 'CLOSED'] },
        dataSource: 'REAL',
      },
      include: { outcomes: true, decisions: true },
      take: 10,
    });

    const unresolvedDryRun = dryRunMarkets.filter(m => m.outcomes.length === 0);
    
    results.outcomePulling = {
      dryRunMarketsTotal: dryRunMarkets.length,
      unresolvedCount: unresolvedDryRun.length,
      canPoll: unresolvedDryRun.length > 0,
      venues: dryRunMarkets.map(m => m.venue),
    };

    // Actually run resolution cycle to test it
    const resolutionResult = await runResolutionCycle();
    results.resolutionCycle = resolutionResult;

    // Test 2: Check paper bets
    console.log('[Verify] Testing paper bets...');
    
    const paperBets = await db.paperBet.findMany({
      where: {
        market: { dataSource: 'REAL' },
        decision: { mode: 'PAPER' },
      },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });

    const resolved = paperBets.filter(b => b.actualOutcome !== null);
    const pending = paperBets.filter(b => b.actualOutcome === null);

    results.paperBets = {
      total: paperBets.length,
      resolved: resolved.length,
      pending: pending.length,
      resolutionRate: paperBets.length > 0 ? Math.round((resolved.length / paperBets.length) * 100) : 0,
    };

    // Get accuracy metrics
    const accuracy = await getAccuracyMetrics(100);
    results.accuracy = accuracy;

    // Test 3: Check provider configurations
    console.log('[Verify] Testing provider configs...');
    
    const configs = {
      deerflow: {
        url: process.env.DEERFLOW_URL,
        configured: Boolean(process.env.DEERFLOW_URL),
      },
      agentReach: {
        url: process.env.AGENT_REACH_URL,
        configured: Boolean(process.env.AGENT_REACH_URL),
      },
      tradingagents: {
        url: process.env.TRADINGAGENTS_URL,
        configured: Boolean(process.env.TRADINGAGENTS_URL),
      },
      searxng: {
        url: process.env.SEARXNG_URL || process.env.TA_SEARXNG_URL,
        configured: Boolean(process.env.SEARXNG_URL || process.env.TA_SEARXNG_URL),
      },
    };

    results.providerConfigs = configs;

    // Check if all critical providers are configured
    const missingProviders = Object.entries(configs)
      .filter(([, v]) => !(v as { configured: boolean }).configured)
      .map(([k]) => k);

    if (missingProviders.length > 0) {
      errors.push(`Missing provider configs: ${missingProviders.join(', ')}`);
    }

    // Test 4: Check research runs and source counts
    console.log('[Verify] Testing research aggregation...');
    
    const recentResearch = await db.researchRun.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        sources: true,
        agentOutputs: true,
      },
    });

    const researchStats = recentResearch.map(r => ({
      id: r.id,
      createdAt: r.createdAt,
      sourceCount: r.sources.length,
      agentOutputCount: r.agentOutputs.length,
      totalSources: r.sources.length + r.agentOutputs.length,
    }));

    results.researchRuns = {
      recent: researchStats,
      averageSources: researchStats.length > 0 
        ? Math.round(researchStats.reduce((a, r) => a + r.totalSources, 0) / researchStats.length)
        : 0,
    };

    // Check if we're hitting 500+ sources
    const avgSources = results.researchRuns.averageSources as number;
    if (avgSources < 100) {
      errors.push(`Low source count: averaging ${avgSources} sources per research (target: 500+)`);
    } else if (avgSources < 400) {
      errors.push(`Below target: averaging ${avgSources} sources per research (target: 500+)`);
    }

    // Final verdict
    const passed = errors.length === 0 && avgSources >= 400;

    return NextResponse.json({
      status: passed ? 'passed' : 'failed',
      timestamp: new Date().toISOString(),
      results,
      errors: errors.length > 0 ? errors : undefined,
      recommendations: errors.length > 0 ? [
        '1. Check provider URLs in .env file',
        '2. Ensure all services are running (docker compose ps)',
        '3. Verify network connectivity to providers',
        '4. Check provider logs for errors',
        '5. Run source verification: npm run verify-sources',
      ] : undefined,
    }, { status: passed ? 200 : 500 });

  } catch (error) {
    console.error('[Verify] Error:', error);
    return NextResponse.json({
      status: 'error',
      error: String(error),
      timestamp: new Date().toISOString(),
    }, { status: 500 });
  }
}

// Allow manual resolution trigger for testing
export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    if (body.action === 'trigger_resolution') {
      console.log('[Verify] Manually triggering resolution cycle...');
      const result = await runResolutionCycle();
      
      return NextResponse.json({
        status: 'success',
        action: 'resolution_triggered',
        result,
        timestamp: new Date().toISOString(),
      });
    }

    if (body.action === 'test_outcome_pull') {
      console.log('[Verify] Testing outcome pull for specific market...');
      
      const { marketId } = body;
      if (!marketId) {
        return NextResponse.json({
          status: 'error',
          error: 'marketId required',
        }, { status: 400 });
      }

      const market = await db.market.findUnique({
        where: { id: marketId },
        include: { outcomes: true, decisions: true },
      });

      if (!market) {
        return NextResponse.json({
          status: 'error',
          error: 'Market not found',
        }, { status: 404 });
      }

      // Check if market has dry-run decisions
      const hasDryRun = market.decisions.some(d => d.dryRun);
      
      return NextResponse.json({
        status: 'success',
        market: {
          id: market.id,
          venue: market.venue,
          externalId: market.externalId,
          status: market.status,
          hasDryRunDecisions: hasDryRun,
          outcomeCount: market.outcomes.length,
          outcomes: market.outcomes,
        },
        canPollForResolution: market.status === 'ACTIVE' || market.status === 'CLOSED',
        resolutionPollingEnabled: hasDryRun && market.outcomes.length === 0,
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      status: 'error',
      error: 'Unknown action. Use: trigger_resolution, test_outcome_pull',
    }, { status: 400 });

  } catch (error) {
    console.error('[Verify POST] Error:', error);
    return NextResponse.json({
      status: 'error',
      error: String(error),
    }, { status: 500 });
  }
}
