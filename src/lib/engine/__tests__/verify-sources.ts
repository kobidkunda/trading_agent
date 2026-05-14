/**
 * End-to-End Source Verification Test
 * Verifies 500-600 sources are being aggregated from all providers
 */

import { runFullResearch } from '@/lib/engine/research/full-research';
import { searchSearXNG, searchSearXNGReddit, searchSearXNGX } from '@/lib/engine/research/search';
import { runAgentReachResearch } from '@/lib/engine/research/agent-reach';
import { runDeerFlowResearch } from '@/lib/engine/research/deerflow';
import { getStageRouting } from '@/lib/engine/service-routing';

interface SocialMediaResponse {
  platform: 'reddit' | 'twitter' | 'agent_reach';
  title: string;
  content: string;
  url: string;
  engagement?: number;
  sentiment?: 'positive' | 'negative' | 'neutral';
}

interface SourceVerificationResult {
  provider: string;
  status: 'passed' | 'failed' | 'partial';
  sourcesRequested: number;
  sourcesReturned: number;
  errors: string[];
  duration: number;
  sampleResponses?: SocialMediaResponse[];
  sourceBreakdown?: {
    web: number;
    reddit: number;
    twitter: number;
    other: number;
  };
}

interface AggregateResult {
  totalSources: number;
  targetSources: number;
  providers: SourceVerificationResult[];
  passed: boolean;
}

const TEST_QUERY = 'Will Bitcoin exceed $100,000 by end of 2026?';
const TARGET_SOURCES = 500;

export async function verifyAllSources(): Promise<AggregateResult> {
  console.log('=== END-TO-END SOURCE VERIFICATION ===');
  console.log(`Target: ${TARGET_SOURCES} sources`);
  console.log(`Query: "${TEST_QUERY}"`);
  console.log('');

  const routing = await getStageRouting();
  const providers: SourceVerificationResult[] = [];
  let totalSources = 0;

  // Test 1: SearXNG General Search
  console.log('[Test 1/6] SearXNG General Search...');
  try {
    const start = Date.now();
    const searxngResults = await searchSearXNG(TEST_QUERY, 50);
    const duration = Date.now() - start;
    const result: SourceVerificationResult = {
      provider: 'SearXNG General',
      status: searxngResults.length >= 40 ? 'passed' : searxngResults.length > 0 ? 'partial' : 'failed',
      sourcesRequested: 50,
      sourcesReturned: searxngResults.length,
      errors: searxngResults.length < 40 ? [`Only ${searxngResults.length}/50 sources returned`] : [],
      duration,
    };
    providers.push(result);
    totalSources += searxngResults.length;
    console.log(`  ✓ ${searxngResults.length} sources (${duration}ms)`);
  } catch (error) {
    console.log(`  ✗ Failed: ${error}`);
    providers.push({
      provider: 'SearXNG General',
      status: 'failed',
      sourcesRequested: 50,
      sourcesReturned: 0,
      errors: [String(error)],
      duration: 0,
    });
  }

  // Test 2: SearXNG Reddit
  console.log('[Test 2/6] SearXNG Reddit...');
  try {
    const start = Date.now();
    const redditResults = await searchSearXNGReddit(TEST_QUERY, 50);
    const duration = Date.now() - start;
    
    // Capture sample Reddit responses
    const redditResponses: SocialMediaResponse[] = redditResults.slice(0, 5).map(r => ({
      platform: 'reddit',
      title: r.title.slice(0, 100),
      content: r.snippet.slice(0, 200),
      url: r.url,
    }));
    
    const result: SourceVerificationResult = {
      provider: 'SearXNG Reddit',
      status: redditResults.length >= 40 ? 'passed' : redditResults.length > 0 ? 'partial' : 'failed',
      sourcesRequested: 50,
      sourcesReturned: redditResults.length,
      errors: redditResults.length < 40 ? [`Only ${redditResults.length}/50 sources returned`] : [],
      duration,
      sampleResponses: redditResponses,
      sourceBreakdown: {
        web: 0,
        reddit: redditResults.length,
        twitter: 0,
        other: 0,
      },
    };
    providers.push(result);
    totalSources += redditResults.length;
    console.log(`  ✓ ${redditResults.length} sources (${duration}ms)`);
    if (redditResponses.length > 0) {
      console.log(`    Sample: ${redditResponses[0].title.slice(0, 60)}...`);
    }
  } catch (error) {
    console.log(`  ✗ Failed: ${error}`);
    providers.push({
      provider: 'SearXNG Reddit',
      status: 'failed',
      sourcesRequested: 50,
      sourcesReturned: 0,
      errors: [String(error)],
      duration: 0,
    });
  }

  // Test 3: SearXNG X/Twitter
  console.log('[Test 3/6] SearXNG X/Twitter...');
  try {
    const start = Date.now();
    const xResults = await searchSearXNGX(TEST_QUERY, 50);
    const duration = Date.now() - start;
    
    // Capture sample Twitter/X responses
    const twitterResponses: SocialMediaResponse[] = xResults.slice(0, 5).map(r => ({
      platform: 'twitter',
      title: r.title.slice(0, 100),
      content: r.snippet.slice(0, 200),
      url: r.url,
    }));
    
    const result: SourceVerificationResult = {
      provider: 'SearXNG X/Twitter',
      status: xResults.length >= 40 ? 'passed' : xResults.length > 0 ? 'partial' : 'failed',
      sourcesRequested: 50,
      sourcesReturned: xResults.length,
      errors: xResults.length < 40 ? [`Only ${xResults.length}/50 sources returned`] : [],
      duration,
      sampleResponses: twitterResponses,
      sourceBreakdown: {
        web: 0,
        reddit: 0,
        twitter: xResults.length,
        other: 0,
      },
    };
    providers.push(result);
    totalSources += xResults.length;
    console.log(`  ✓ ${xResults.length} sources (${duration}ms)`);
    if (twitterResponses.length > 0) {
      console.log(`    Sample: ${twitterResponses[0].content.slice(0, 60)}...`);
    }
  } catch (error) {
    console.log(`  ✗ Failed: ${error}`);
    providers.push({
      provider: 'SearXNG X/Twitter',
      status: 'failed',
      sourcesRequested: 50,
      sourcesReturned: 0,
      errors: [String(error)],
      duration: 0,
    });
  }

  // Test 4: Agent-Reach
  console.log('[Test 4/6] Agent-Reach MCP...');
  try {
    const start = Date.now();
    const agentReachResult = await runAgentReachResearch(TEST_QUERY, { routing });
    const duration = Date.now() - start;
    const sourceCount = agentReachResult?.sources?.length || 0;
    
    // Capture sample Agent-Reach social media responses
    const agentReachResponses: SocialMediaResponse[] = agentReachResult?.sources?.slice(0, 5).map(s => ({
      platform: 'agent_reach',
      title: s.title.slice(0, 100),
      content: s.snippet.slice(0, 200),
      url: s.url,
    })) || [];
    
    const result: SourceVerificationResult = {
      provider: 'Agent-Reach MCP',
      status: agentReachResult?.status === 'completed' && sourceCount >= 100 ? 'passed' : 
              agentReachResult?.status === 'completed' ? 'partial' : 'failed',
      sourcesRequested: 500,
      sourcesReturned: sourceCount,
      errors: agentReachResult?.error ? [agentReachResult.error] : 
              sourceCount < 100 && agentReachResult?.status === 'completed' ? 
              [`Only ${sourceCount} sources (expected 100+)`] : [],
      duration,
      sampleResponses: agentReachResponses,
      sourceBreakdown: {
        web: 0,
        reddit: 0,
        twitter: 0,
        other: sourceCount, // Agent-Reach provides aggregated sources
      },
    };
    providers.push(result);
    totalSources += sourceCount;
    console.log(`  ${agentReachResult?.status === 'completed' ? '✓' : '✗'} ${sourceCount} sources (${duration}ms)`);
    if (agentReachResult?.error) {
      console.log(`    Error: ${agentReachResult.error}`);
    }
    if (agentReachResponses.length > 0) {
      console.log(`    Sample: ${agentReachResponses[0].title.slice(0, 60)}...`);
    }
  } catch (error) {
    console.log(`  ✗ Failed: ${error}`);
    providers.push({
      provider: 'Agent-Reach MCP',
      status: 'failed',
      sourcesRequested: 500,
      sourcesReturned: 0,
      errors: [String(error)],
      duration: 0,
    });
  }

  // Test 5: DeerFlow
  console.log('[Test 5/6] DeerFlow...');
  try {
    const start = Date.now();
    const deerflowResult = await runDeerFlowResearch(TEST_QUERY, '', 0.5, routing);
    const duration = Date.now() - start;
    const sourceCount = deerflowResult?.allSearchResults?.length || 0;
    const result: SourceVerificationResult = {
      provider: 'DeerFlow',
      status: deerflowResult ? sourceCount >= 20 ? 'passed' : 'partial' : 'failed',
      sourcesRequested: 50,
      sourcesReturned: sourceCount,
      errors: deerflowResult && sourceCount < 20 ? [`Only ${sourceCount} sources returned`] : 
              !deerflowResult ? ['No result returned'] : [],
      duration,
    };
    providers.push(result);
    totalSources += sourceCount;
    console.log(`  ${deerflowResult ? '✓' : '✗'} ${sourceCount} sources (${duration}ms)`);
  } catch (error) {
    console.log(`  ✗ Failed: ${error}`);
    providers.push({
      provider: 'DeerFlow',
      status: 'failed',
      sourcesRequested: 50,
      sourcesReturned: 0,
      errors: [String(error)],
      duration: 0,
    });
  }

  // Test 6: Full Research Integration
  console.log('[Test 6/6] Full Research Integration...');
  try {
    const start = Date.now();
    const fullResult = await runFullResearch({
      marketId: 'test-market-001',
      marketTitle: TEST_QUERY,
      marketDescription: 'Test market for source verification',
      impliedProbability: 0.5,
      routing,
    });
    const duration = Date.now() - start;

    const deerflowSources = fullResult.deerflow?.allSearchResults?.length || 0;
    const agentReachSources = fullResult.agentReach?.sources?.length || 0;
    const tradingagentsStatus = fullResult.tradingagents?.status || 'failed';
    
    const integratedTotal = deerflowSources + agentReachSources;
    
    const result: SourceVerificationResult = {
      provider: 'Full Research Integration',
      status: fullResult.status === 'completed' ? 'passed' : 
              fullResult.status === 'degraded' ? 'partial' : 'failed',
      sourcesRequested: TARGET_SOURCES,
      sourcesReturned: integratedTotal,
      errors: fullResult.status === 'failed' ? ['All providers failed'] :
              integratedTotal < 100 ? [`Only ${integratedTotal} total sources`] : [],
      duration,
    };
    providers.push(result);
    console.log(`  ${fullResult.status === 'completed' ? '✓' : fullResult.status === 'degraded' ? '⚠' : '✗'} Status: ${fullResult.status}, Sources: ${integratedTotal} (${duration}ms)`);
    console.log(`    - DeerFlow: ${deerflowSources} sources`);
    console.log(`    - Agent-Reach: ${agentReachSources} sources`);
    console.log(`    - TradingAgents: ${tradingagentsStatus}`);
  } catch (error) {
    console.log(`  ✗ Failed: ${error}`);
    providers.push({
      provider: 'Full Research Integration',
      status: 'failed',
      sourcesRequested: TARGET_SOURCES,
      sourcesReturned: 0,
      errors: [String(error)],
      duration: 0,
    });
  }

  // Summary
  console.log('');
  console.log('=== VERIFICATION SUMMARY ===');
  console.log(`Total Sources: ${totalSources}/${TARGET_SOURCES}`);
  console.log(`Gap: ${Math.max(0, TARGET_SOURCES - totalSources)} sources needed`);
  
  const passed = providers.filter(p => p.status === 'passed').length;
  const partial = providers.filter(p => p.status === 'partial').length;
  const failed = providers.filter(p => p.status === 'failed').length;
  
  console.log(`Providers: ${passed} passed, ${partial} partial, ${failed} failed`);
  
  // Social Media Summary
  const redditTotal = providers.reduce((a, p) => a + (p.sourceBreakdown?.reddit || 0), 0);
  const twitterTotal = providers.reduce((a, p) => a + (p.sourceBreakdown?.twitter || 0), 0);
  const webTotal = providers.reduce((a, p) => a + (p.sourceBreakdown?.web || 0), 0);
  const otherTotal = providers.reduce((a, p) => a + (p.sourceBreakdown?.other || 0), 0);
  
  console.log('');
  console.log('SOCIAL MEDIA SOURCES:');
  console.log(`  Reddit: ${redditTotal} posts`);
  console.log(`  X/Twitter: ${twitterTotal} posts`);
  console.log(`  Web: ${webTotal} sources`);
  console.log(`  Other/Agent-Reach: ${otherTotal} sources`);
  console.log('');

  // Show sample social media responses
  console.log('SAMPLE SOCIAL MEDIA RESPONSES:');
  providers.forEach(p => {
    if (p.sampleResponses && p.sampleResponses.length > 0) {
      console.log(`  [${p.provider}]`);
      p.sampleResponses.slice(0, 2).forEach((r, i) => {
        console.log(`    ${i + 1}. [${r.platform}] ${r.content.slice(0, 80)}...`);
      });
    }
  });
  console.log('');

  // List all errors
  const allErrors = providers.flatMap(p => p.errors.map(e => `[${p.provider}] ${e}`));
  if (allErrors.length > 0) {
    console.log('ERRORS FOUND:');
    allErrors.forEach(e => console.log(`  - ${e}`));
  }

  const passed500 = totalSources >= 500;
  console.log(passed500 ? '\n✅ TARGET ACHIEVED: 500+ sources' : '\n❌ TARGET NOT MET: Need 500+ sources');

  return {
    totalSources,
    targetSources: TARGET_SOURCES,
    providers,
    passed: passed500,
  };
}

// Auto-run if called directly
if (require.main === module) {
  verifyAllSources()
    .then(result => {
      process.exit(result.passed ? 0 : 1);
    })
    .catch(err => {
      console.error('Verification failed:', err);
      process.exit(1);
    });
}
