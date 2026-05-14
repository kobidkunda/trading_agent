'use client';

/**
 * COMPREHENSIVE MARKET DETAIL PAGE - SINGLE VIEW
 * All information visible at once, no tabs
 * Example: "Will Ethereum complete the Pectra upgrade successfully by Q2 2026"
 * Shows EVERYTHING: market info, live status, all 500-600 sources, pipeline, synthesis, debate, risk, decision
 */

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { 
  ArrowLeft, 
  ExternalLink, 
  Clock, 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Copy,
  Download,
  Database,
  Brain,
  Globe,
  MessageSquare,
  Twitter,
  Activity,
  Scale,
  TrendingUp,
  Target,
  FileText,
  Server,
  Cpu,
  Loader2,
  Radio,
  RefreshCw,
  Zap,
  Filter,
  ScanSearch,
  ShieldAlert,
  Flame,
  BarChart3,
  Sparkles,
  ChevronDown,
  ChevronRight,
  AlertTriangle
} from 'lucide-react';

// Types
interface MarketDetailData {
  market: {
    id: string;
    title: string;
    description: string;
    venue: string;
    status: string;
    externalId: string;
    impliedProb: number;
    spread: number;
    liquidity: number;
    resolutionTime: string | null;
    resolutionCriteria: string;
    category: string;
  };
  pipeline: {
    stages: Array<{
      stage: string;
      status: string;
      startedAt: string;
      endedAt: string | null;
      duration: number;
      serviceName: string;
      provider: string;
      model: string;
      message: string;
      failureReason: string | null;
    }>;
  };
  sources: {
    deerflow: Array<any>;
    reddit: Array<any>;
    twitter: Array<any>;
    agentReach: Array<any>;
    searxng: Array<any>;
  };
  synthesis: {
    summary: string;
    findings: string[];
    contradictions: string[];
    consensusProbability: number;
    agreements: string[];
    disagreements: string[];
    finalAssessment: string;
    confidence: number;
    sourceComparisons: Array<any>;
  } | null;
  debate: {
    bullOutput: string;
    bearOutput: string;
    contradictionOutput: string;
    judgeOutput: string;
    decision: string;
    confidence: number;
  } | null;
  risk: {
    checks: Array<any>;
    kellyFraction: number;
    positionSize: number;
    edge: number;
    finalDecision: 'BID' | 'WATCH' | 'SKIP';
  } | null;
  decision: {
    predictedProb: number;
    predictedSide: 'YES' | 'NO';
    entryPrice: number;
    stake: number;
    confidence: number;
    rationale: string;
  } | null;
  paperBet: any | null;
  agentOutputs: Array<any>;
  auditLog: Array<any>;
}

interface LiveProgress {
  marketId: string;
  status: string;
  isLive: boolean;
  isComplete: boolean;
  activeAgents: Array<{
    role: string;
    serviceName: string;
    provider: string;
    model: string;
    startedAt: string;
    message: string;
  }>;
  completedAgents: Array<any>;
  recentEvents: Array<any>;
}

export default function MarketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const marketId = params.id as string;
  
  const [data, setData] = useState<MarketDetailData | null>(null);
  const [liveProgress, setLiveProgress] = useState<LiveProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  
  // Fetch initial data
  useEffect(() => {
    fetchMarketDetail();
  }, [marketId]);
  
  // Poll for live updates - MORE AGGRESSIVE when data is missing
  useEffect(() => {
    const hasNoData = !data || 
      (data.agentOutputs.length === 0 && 
       data.sources.deerflow.length === 0 &&
       data.sources.reddit.length === 0 &&
       data.sources.twitter.length === 0 &&
       data.sources.agentReach.length === 0 &&
       data.sources.searxng.length === 0);
    
    // Poll every 1 second if no data, every 2 seconds if has data
    const intervalMs = hasNoData ? 1000 : 2000;
    
    const pollInterval = setInterval(async () => {
      try {
        const liveRes = await fetch(`/api/market/${marketId}/live`);
        if (liveRes.ok) {
          const liveData = await liveRes.json();
          setLiveProgress(liveData);
          setLastRefresh(new Date());
          
          // Refresh full detail when live completes OR when we first get activity
          if (liveData.isComplete || (hasNoData && liveData.recentEvents?.length > 0)) {
            fetchMarketDetail();
          }
        }
      } catch (e) {
        // Silent fail
      }
    }, intervalMs);
    
    return () => clearInterval(pollInterval);
  }, [marketId, data]);
  
  async function fetchMarketDetail() {
    try {
      setLoading(true);
      const [detailRes, liveRes] = await Promise.all([
        fetch(`/api/market/${marketId}/detail`),
        fetch(`/api/market/${marketId}/live`)
      ]);
      
      if (!detailRes.ok) throw new Error(`HTTP ${detailRes.status}`);
      const detailData = await detailRes.json();
      const liveData = liveRes.ok ? await liveRes.json() : null;
      
      setData(detailData);
      setLiveProgress(liveData);
      setLastRefresh(new Date());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
  
  if (loading) return <div className="p-8 text-white">Loading comprehensive market detail...</div>;
  if (error) return <div className="p-8 text-red-400">Error: {error}</div>;
  if (!data) return <div className="p-8 text-gray-400">No data found</div>;
  
  const totalSources = 
    data.sources.deerflow.length + 
    data.sources.reddit.length + 
    data.sources.twitter.length + 
    data.sources.agentReach.length + 
    data.sources.searxng.length;
  
  const isLive = liveProgress?.isLive || false;
  const activeAgents = liveProgress?.activeAgents || [];
  
  const toggleSourceSection = (section: string) => {
    const newSet = new Set(expandedSources);
    if (newSet.has(section)) {
      newSet.delete(section);
    } else {
      newSet.add(section);
    }
    setExpandedSources(newSet);
  };
  
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* STICKY HEADER */}
      <div className="sticky top-0 z-50 bg-gray-950/95 backdrop-blur border-b border-gray-800 p-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => router.back()}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white truncate">{data.market.title}</h1>
            <div className="flex items-center gap-2 text-xs text-gray-400 mt-1">
              <Badge variant="outline" className="text-[10px]">{data.market.venue}</Badge>
              <Badge variant={data.market.status === 'RESOLVED' ? 'default' : 'outline'} className="text-[10px]">
                {data.market.status}
              </Badge>
              {isLive && (
                <Badge className="animate-pulse border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px]">
                  <Radio className="h-3 w-3 mr-1" />
                  LIVE PROCESSING
                </Badge>
              )}
              <span className="text-gray-500">ID: {marketId.slice(-8)}</span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={fetchMarketDetail}>
            <RefreshCw className={cn("h-4 w-4 mr-2", isLive && "animate-spin")} />
            {isLive ? 'Auto' : 'Refresh'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => copyToClipboard(JSON.stringify(data, null, 2))}>
            <Copy className="h-4 w-4 mr-2" />
            Copy
          </Button>
          <Button variant="outline" size="sm" onClick={() => downloadReport(data)}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>

      {/* SINGLE COMPREHENSIVE SCROLLABLE CONTENT */}
      <div className="p-4 space-y-6 max-w-[1800px] mx-auto">
        
        {/* SECTION 1: QUICK STATS BAR */}
        <div className="grid grid-cols-6 gap-3">
          <StatCard icon={Database} label="Sources" value={totalSources} subValue="Target: 500-600" color={totalSources >= 400 ? 'green' : totalSources >= 200 ? 'yellow' : 'red'} />
          <StatCard icon={Cpu} label="Agents" value={data.agentOutputs.length} />
          <StatCard icon={Activity} label="Implied Prob" value={`${(data.market.impliedProb * 100).toFixed(1)}%`} />
          <StatCard icon={TrendingUp} label="Liquidity" value={`$${(data.market.liquidity / 1000).toFixed(1)}K`} />
          <StatCard icon={Scale} label="Edge" value={data.risk?.edge ? `${(data.risk.edge * 100).toFixed(1)}%` : 'N/A'} />
          <StatCard icon={Target} label="Resolution" value={data.paperBet?.actualOutcome || 'Pending'} color={data.paperBet?.actualOutcome === 'YES' ? 'green' : data.paperBet?.actualOutcome === 'NO' ? 'red' : 'gray'} />
        </div>

        {/* SECTION 1.5: RESEARCH PENDING BANNER (when no data yet) */}
        {totalSources === 0 && data.agentOutputs.length === 0 && !isLive && (
          <Card className="border-amber-500/30 bg-amber-950/10">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-amber-500/20 animate-ping" />
                    <div className="relative p-2 rounded-full bg-amber-500/20">
                      <Clock className="h-5 w-5 text-amber-400 animate-pulse" />
                    </div>
                  </div>
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      Research Pending
                      <Badge className="animate-pulse border-amber-500/30 bg-amber-500/20 text-amber-400">
                        QUEUED
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      Waiting for research to begin • Auto-refreshing every second
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 text-amber-400 animate-spin" />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm text-gray-400">
                <p>This market is queued for research. The page will automatically update when:</p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li>Market scanning identifies this market as relevant</li>
                  <li>Research agents begin collecting 500-600 sources</li>
                  <li>Synthesis, debate, and risk analysis complete</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

        {/* SECTION 2: LIVE PROCESSING STATUS (if active) */}
        {isLive && (
          <Card className="border-emerald-500/30 bg-emerald-950/10">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
                    <div className="relative p-2 rounded-full bg-emerald-500/20">
                      <Radio className="h-5 w-5 text-emerald-400 animate-pulse" />
                    </div>
                  </div>
                  <div>
                    <CardTitle className="text-lg flex items-center gap-2">
                      Live Research in Progress
                      <Badge className="animate-pulse border-emerald-500/30 bg-emerald-500/20 text-emerald-400">
                        REAL-TIME
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      Stage: {liveProgress?.status?.toUpperCase()} • Updated {Math.floor((Date.now() - lastRefresh.getTime()) / 1000)}s ago
                    </CardDescription>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {activeAgents.length > 0 && (
                <div>
                  <p className="text-sm text-gray-400 mb-2">Active Agents (Parallel Execution):</p>
                  <div className="flex flex-wrap gap-2">
                    {activeAgents.map((agent, idx) => (
                      <div key={idx} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700">
                        <Loader2 className="h-4 w-4 text-violet-400 animate-spin" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white">{agent.role}</span>
                            {agent.model && <Badge variant="outline" className="text-[10px]">{agent.model}</Badge>}
                          </div>
                          <p className="text-xs text-gray-500">{agent.message}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* SECTION 3: MARKET DESCRIPTION & INFO */}
        <div className="grid grid-cols-3 gap-4">
          <Card className="col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-cyan-400" />
                Market Description
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-300 leading-relaxed">{data.market.description}</p>
              <Separator className="my-4" />
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div><span className="text-gray-500">Category:</span> <span className="text-gray-300">{data.market.category}</span></div>
                <div><span className="text-gray-500">Venue:</span> <span className="text-gray-300">{data.market.venue}</span></div>
                <div><span className="text-gray-500">Spread:</span> <span className="text-gray-300">{(data.market.spread * 100).toFixed(2)}%</span></div>
                <div><span className="text-gray-500">Resolution:</span> <span className="text-gray-300">{data.market.resolutionTime || 'TBD'}</span></div>
              </div>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-emerald-400" />
                Market Metrics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <MetricRow label="Implied Probability" value={`${(data.market.impliedProb * 100).toFixed(1)}%`} />
              <MetricRow label="Liquidity" value={`$${data.market.liquidity.toLocaleString()}`} />
              <MetricRow label="Spread" value={`${(data.market.spread * 100).toFixed(2)}%`} />
              <MetricRow label="External ID" value={data.market.externalId} />
            </CardContent>
          </Card>
        </div>

        {/* SECTION 4: ALL SOURCES (500-600) - FULL WIDTH */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5 text-blue-400" />
                Complete Source Inventory ({totalSources} / Target: 500-600)
              </CardTitle>
              <select 
                className="bg-gray-800 border border-gray-700 rounded px-3 py-1 text-sm"
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
              >
                <option value="all">Show All Providers</option>
                <option value="deerflow">DeerFlow ({data.sources.deerflow.length})</option>
                <option value="reddit">Reddit ({data.sources.reddit.length})</option>
                <option value="twitter">X/Twitter ({data.sources.twitter.length})</option>
                <option value="agentReach">Agent-Reach ({data.sources.agentReach.length})</option>
                <option value="searxng">SearXNG ({data.sources.searxng.length})</option>
              </select>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* DeerFlow */}
              {(sourceFilter === 'all' || sourceFilter === 'deerflow') && (
                <SourceSection 
                  title="DeerFlow Research" 
                  count={data.sources.deerflow.length}
                  icon={Brain}
                  color="text-violet-400"
                  isExpanded={expandedSources.has('deerflow')}
                  onToggle={() => toggleSourceSection('deerflow')}
                >
                  <div className="grid gap-2 max-h-[400px] overflow-y-auto">
                    {data.sources.deerflow.map((source, idx) => (
                      <SourceCard key={idx} source={source} provider="DeerFlow" />
                    ))}
                    {data.sources.deerflow.length === 0 && <EmptySources />}
                  </div>
                </SourceSection>
              )}
              
              {/* Reddit */}
              {(sourceFilter === 'all' || sourceFilter === 'reddit') && (
                <SourceSection 
                  title="Reddit Posts" 
                  count={data.sources.reddit.length}
                  icon={MessageSquare}
                  color="text-orange-400"
                  isExpanded={expandedSources.has('reddit')}
                  onToggle={() => toggleSourceSection('reddit')}
                >
                  <div className="grid gap-2 max-h-[400px] overflow-y-auto">
                    {data.sources.reddit.map((post, idx) => (
                      <RedditPostCard key={idx} post={post} />
                    ))}
                    {data.sources.reddit.length === 0 && <EmptySources />}
                  </div>
                </SourceSection>
              )}
              
              {/* Twitter/X */}
              {(sourceFilter === 'all' || sourceFilter === 'twitter') && (
                <SourceSection 
                  title="X/Twitter Posts" 
                  count={data.sources.twitter.length}
                  icon={Twitter}
                  color="text-blue-400"
                  isExpanded={expandedSources.has('twitter')}
                  onToggle={() => toggleSourceSection('twitter')}
                >
                  <div className="grid gap-2 max-h-[400px] overflow-y-auto">
                    {data.sources.twitter.map((tweet, idx) => (
                      <TwitterCard key={idx} tweet={tweet} />
                    ))}
                    {data.sources.twitter.length === 0 && <EmptySources />}
                  </div>
                </SourceSection>
              )}
              
              {/* Agent-Reach */}
              {(sourceFilter === 'all' || sourceFilter === 'agentReach') && (
                <SourceSection 
                  title="Agent-Reach Sources" 
                  count={data.sources.agentReach.length}
                  icon={Server}
                  color="text-purple-400"
                  isExpanded={expandedSources.has('agentReach')}
                  onToggle={() => toggleSourceSection('agentReach')}
                >
                  <div className="grid gap-2 max-h-[400px] overflow-y-auto">
                    {data.sources.agentReach.map((source, idx) => (
                      <SourceCard key={idx} source={source} provider="Agent-Reach" />
                    ))}
                    {data.sources.agentReach.length === 0 && <EmptySources />}
                  </div>
                </SourceSection>
              )}
              
              {/* SearXNG */}
              {(sourceFilter === 'all' || sourceFilter === 'searxng') && (
                <SourceSection 
                  title="Web Sources (SearXNG)" 
                  count={data.sources.searxng.length}
                  icon={Globe}
                  color="text-green-400"
                  isExpanded={expandedSources.has('searxng')}
                  onToggle={() => toggleSourceSection('searxng')}
                >
                  <div className="grid gap-2 max-h-[400px] overflow-y-auto">
                    {data.sources.searxng.map((source, idx) => (
                      <SourceCard key={idx} source={source} provider={source.engine || 'SearXNG'} />
                    ))}
                    {data.sources.searxng.length === 0 && <EmptySources />}
                  </div>
                </SourceSection>
              )}
            </div>
          </CardContent>
        </Card>

        {/* SECTION 5: PIPELINE EXECUTION */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flame className="h-5 w-5 text-orange-400" />
              Pipeline Execution Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.pipeline.stages.length > 0 ? (
              <div className="space-y-2">
                {data.pipeline.stages.map((stage, idx) => (
                  <PipelineStageRow key={idx} stage={stage} index={idx} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                {isLive ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
                    <p>Pipeline stages will appear as agents complete...</p>
                  </div>
                ) : (
                  <p>No pipeline data available</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* SECTION 6: SYNTHESIS & ANALYSIS */}
        {data.synthesis ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-amber-400" />
                Synthesis & Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-2">Summary</h4>
                  <p className="text-gray-300 whitespace-pre-wrap">{data.synthesis.summary}</p>
                  
                  <div className="grid grid-cols-3 gap-3 mt-4">
                    <StatBox label="Consensus" value={`${(data.synthesis.consensusProbability * 100).toFixed(1)}%`} />
                    <StatBox label="Confidence" value={`${(data.synthesis.confidence * 100).toFixed(0)}%`} />
                    <StatBox label="Sources" value={data.synthesis.sourceComparisons.length} />
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-green-400" />
                      Findings ({data.synthesis.findings.length})
                    </h4>
                    <ScrollArea className="h-[200px]">
                      <ul className="space-y-1">
                        {data.synthesis.findings.map((finding, idx) => (
                          <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                            <span className="text-green-400 mt-1">•</span>
                            {finding}
                          </li>
                        ))}
                      </ul>
                    </ScrollArea>
                  </div>
                  
                  {data.synthesis.contradictions.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-gray-400 mb-2 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 text-amber-400" />
                        Contradictions ({data.synthesis.contradictions.length})
                      </h4>
                      <ScrollArea className="h-[150px]">
                        <ul className="space-y-1">
                          {data.synthesis.contradictions.map((contradiction, idx) => (
                            <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                              <span className="text-amber-400 mt-1">!</span>
                              {contradiction}
                            </li>
                          ))}
                        </ul>
                      </ScrollArea>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed border-gray-700">
            <CardContent className="p-8 text-center text-gray-500">
              <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Synthesis will be available after research completes</p>
            </CardContent>
          </Card>
        )}

        {/* SECTION 7: DEBATE & JUDGE ANALYSIS */}
        {data.debate ? (
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-green-500/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-400">
                  <TrendingUp className="h-5 w-5" />
                  Bull Analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-sm whitespace-pre-wrap text-gray-300 bg-gray-900 p-4 rounded max-h-[400px] overflow-y-auto">
                  {data.debate.bullOutput}
                </pre>
              </CardContent>
            </Card>
            
            <Card className="border-red-500/20">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-red-400">
                  <TrendingUp className="h-5 w-5 rotate-180" />
                  Bear Analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-sm whitespace-pre-wrap text-gray-300 bg-gray-900 p-4 rounded max-h-[400px] overflow-y-auto">
                  {data.debate.bearOutput}
                </pre>
              </CardContent>
            </Card>
            
            {data.debate.contradictionOutput && (
              <Card className="border-amber-500/20 col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-amber-400">
                    <Flame className="h-5 w-5" />
                    Contradiction Analysis
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-sm whitespace-pre-wrap text-gray-300 bg-gray-900 p-4 rounded max-h-[300px] overflow-y-auto">
                    {data.debate.contradictionOutput}
                  </pre>
                </CardContent>
              </Card>
            )}
            
            {data.debate.judgeOutput && (
              <Card className="border-cyan-500 col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-cyan-400">
                    <Scale className="h-5 w-5" />
                    Judge Verdict
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-sm whitespace-pre-wrap text-gray-300 bg-gray-900 p-4 rounded max-h-[300px] overflow-y-auto mb-4">
                    {data.debate.judgeOutput}
                  </pre>
                  <div className="flex items-center justify-between p-4 bg-gray-800 rounded">
                    <div>
                      <span className="text-gray-400 text-sm">Decision:</span>
                      <span className="ml-2 text-lg font-bold text-white">{data.debate.decision}</span>
                    </div>
                    <div>
                      <span className="text-gray-400 text-sm">Confidence:</span>
                      <span className="ml-2 text-lg font-bold text-cyan-400">{(data.debate.confidence * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          <Card className="border-dashed border-gray-700">
            <CardContent className="p-8 text-center text-gray-500">
              <Scale className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Debate analysis will be available after judge completes</p>
            </CardContent>
          </Card>
        )}

        {/* SECTION 8: RISK ENGINE OUTPUT */}
        {data.risk ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-red-400" />
                Risk Engine Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-3">Risk Checks</h4>
                  <div className="space-y-2">
                    {data.risk.checks.map((check, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2 bg-gray-800 rounded">
                        <div className="flex items-center gap-2">
                          {check.passed ? (
                            <CheckCircle2 className="h-4 w-4 text-green-400" />
                          ) : (
                            <XCircle className="h-4 w-4 text-red-400" />
                          )}
                          <span className="text-sm text-gray-300">{check.name}</span>
                        </div>
                        <div className="text-right">
                          <span className={cn("text-sm", check.passed ? "text-green-400" : "text-red-400")}>
                            {check.passed ? 'PASS' : 'FAIL'}
                          </span>
                          <span className="text-xs text-gray-500 ml-2">
                            {check.value.toFixed(2)} / {check.threshold.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div className="space-y-4">
                  <div className="p-4 bg-gray-800 rounded">
                    <span className="text-gray-400 text-sm">Kelly Fraction</span>
                    <p className="text-2xl font-bold text-white">{(data.risk.kellyFraction * 100).toFixed(1)}%</p>
                  </div>
                  <div className="p-4 bg-gray-800 rounded">
                    <span className="text-gray-400 text-sm">Position Size</span>
                    <p className="text-2xl font-bold text-white">${data.risk.positionSize.toLocaleString()}</p>
                  </div>
                  <div className="p-4 bg-gray-800 rounded">
                    <span className="text-gray-400 text-sm">Edge</span>
                    <p className="text-2xl font-bold text-emerald-400">{(data.risk.edge * 100).toFixed(2)}%</p>
                  </div>
                  <div className={cn(
                    "p-4 rounded",
                    data.risk.finalDecision === 'BID' ? "bg-emerald-500/20 border border-emerald-500/30" :
                    data.risk.finalDecision === 'WATCH' ? "bg-amber-500/20 border border-amber-500/30" :
                    "bg-red-500/20 border border-red-500/30"
                  )}>
                    <span className="text-gray-400 text-sm">Final Decision</span>
                    <p className={cn(
                      "text-3xl font-bold",
                      data.risk.finalDecision === 'BID' ? "text-emerald-400" :
                      data.risk.finalDecision === 'WATCH' ? "text-amber-400" :
                      "text-red-400"
                    )}>
                      {data.risk.finalDecision}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed border-gray-700">
            <CardContent className="p-8 text-center text-gray-500">
              <ShieldAlert className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Risk analysis will be available after risk engine completes</p>
            </CardContent>
          </Card>
        )}

        {/* SECTION 9: FINAL DECISION & PAPER BET */}
        <div className="grid grid-cols-2 gap-4">
          {data.decision && (
            <Card className="border-cyan-500/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-cyan-400">
                  <Target className="h-5 w-5" />
                  Final Decision
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-gray-800 rounded">
                    <span className="text-gray-400 text-xs">Predicted Probability</span>
                    <p className="text-xl font-bold text-white">{(data.decision.predictedProb * 100).toFixed(1)}%</p>
                  </div>
                  <div className="p-3 bg-gray-800 rounded">
                    <span className="text-gray-400 text-xs">Side</span>
                    <p className="text-xl font-bold text-white">{data.decision.predictedSide}</p>
                  </div>
                  <div className="p-3 bg-gray-800 rounded">
                    <span className="text-gray-400 text-xs">Entry Price</span>
                    <p className="text-xl font-bold text-white">{(data.decision.entryPrice * 100).toFixed(1)}%</p>
                  </div>
                  <div className="p-3 bg-gray-800 rounded">
                    <span className="text-gray-400 text-xs">Stake</span>
                    <p className="text-xl font-bold text-white">${data.decision.stake.toLocaleString()}</p>
                  </div>
                </div>
                {data.decision.rationale && (
                  <div className="mt-4 p-3 bg-gray-800/50 rounded">
                    <span className="text-gray-400 text-xs">Rationale</span>
                    <p className="text-sm text-gray-300 mt-1">{data.decision.rationale}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          
          {data.paperBet && (
            <Card className="border-purple-500/30">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-purple-400">
                  <BarChart3 className="h-5 w-5" />
                  Paper Bet Outcome
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-gray-800 rounded">
                    <span className="text-gray-400 text-xs">Predicted</span>
                    <p className="text-xl font-bold text-white">{data.paperBet.predictedSide}</p>
                  </div>
                  <div className="p-3 bg-gray-800 rounded">
                    <span className="text-gray-400 text-xs">Actual</span>
                    <p className={cn(
                      "text-xl font-bold",
                      data.paperBet.actualOutcome === 'YES' ? "text-green-400" : "text-red-400"
                    )}>
                      {data.paperBet.actualOutcome || 'Pending'}
                    </p>
                  </div>
                  <div className="p-3 bg-gray-800 rounded">
                    <span className="text-gray-400 text-xs">PnL</span>
                    <p className={cn(
                      "text-xl font-bold",
                      (data.paperBet.pnl || 0) >= 0 ? "text-green-400" : "text-red-400"
                    )}>
                      {data.paperBet.pnl !== null ? `$${data.paperBet.pnl.toFixed(2)}` : 'N/A'}
                    </p>
                  </div>
                  <div className="p-3 bg-gray-800 rounded">
                    <span className="text-gray-400 text-xs">Brier Score</span>
                    <p className="text-xl font-bold text-white">
                      {data.paperBet.brierScore !== null ? data.paperBet.brierScore.toFixed(3) : 'N/A'}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* SECTION 10: AGENT OUTPUTS */}
        {data.agentOutputs.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cpu className="h-5 w-5 text-violet-400" />
                Agent Outputs ({data.agentOutputs.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                {data.agentOutputs.map((agent, idx) => (
                  <AgentOutputRow key={idx} agent={agent} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* SECTION 11: RAW DATA DUMP */}
        <Card className="border-gray-700">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-gray-400" />
              Complete Raw Data
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px]">
              <pre className="text-xs whitespace-pre-wrap text-gray-500">
                {JSON.stringify(data, null, 2)}
              </pre>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* FOOTER */}
        <div className="text-center text-sm text-gray-600 py-4">
          Last updated: {lastRefresh.toLocaleString()} • Market ID: {marketId}
        </div>
      </div>
    </div>
  );
}

// Helper Components
function StatCard({ icon: Icon, label, value, subValue, color = 'gray' }: any) {
  const colorClasses = {
    gray: 'text-gray-400',
    green: 'text-green-400',
    yellow: 'text-yellow-400',
    red: 'text-red-400',
    blue: 'text-blue-400',
    purple: 'text-purple-400',
  };
  
  return (
    <Card className="p-3">
      <div className="flex items-center gap-3">
        <Icon className={`h-5 w-5 ${colorClasses[color as keyof typeof colorClasses]}`} />
        <div>
          <div className="text-xl font-bold">{value}</div>
          <div className="text-xs text-gray-400">{label}</div>
          {subValue && <div className="text-[10px] text-gray-500">{subValue}</div>}
        </div>
      </div>
    </Card>
  );
}

function MetricRow({ label, value }: any) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm font-medium text-gray-200">{value}</span>
    </div>
  );
}

function StatBox({ label, value, color = 'gray' }: any) {
  return (
    <div className="bg-gray-800 p-3 rounded text-center">
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs text-gray-400">{label}</div>
    </div>
  );
}

function SourceSection({ title, count, icon: Icon, color, isExpanded, onToggle, children }: any) {
  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 bg-gray-800/50 hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${color}`} />
          <span className="font-medium">{title}</span>
          <Badge variant="outline" className="text-[10px]">{count}</Badge>
        </div>
        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {isExpanded && (
        <div className="p-3 bg-gray-900/30">
          {children}
        </div>
      )}
    </div>
  );
}

function SourceCard({ source, provider }: any) {
  return (
    <div className="p-3 bg-gray-800 rounded border border-gray-700">
      <a 
        href={source.url} 
        target="_blank" 
        rel="noopener noreferrer"
        className="text-sm font-medium text-cyan-400 hover:underline flex items-center gap-1"
      >
        {source.title || source.url}
        <ExternalLink className="h-3 w-3" />
      </a>
      <p className="text-xs text-gray-400 mt-1 line-clamp-2">{source.snippet || source.content}</p>
      <div className="flex items-center gap-2 mt-2">
        <Badge variant="outline" className="text-[10px]">{provider}</Badge>
        {source.iteration && <span className="text-[10px] text-gray-500">Iter {source.iteration}</span>}
      </div>
    </div>
  );
}

function RedditPostCard({ post }: any) {
  return (
    <div className="p-3 bg-orange-950/20 border border-orange-900/50 rounded">
      <a href={post.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-orange-400 hover:underline">
        {post.title}
      </a>
      <p className="text-xs text-gray-400 mt-1 line-clamp-2">{post.selftext}</p>
      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
        <span>r/{post.subreddit}</span>
        <span>↑ {post.score}</span>
        <span>💬 {post.numComments}</span>
      </div>
    </div>
  );
}

function TwitterCard({ tweet }: any) {
  return (
    <div className="p-3 bg-blue-950/20 border border-blue-900/50 rounded">
      <p className="text-sm text-gray-300">{tweet.content}</p>
      <div className="flex items-center gap-2 mt-2">
        <span className="text-xs text-blue-400">@{tweet.author || 'unknown'}</span>
        <a href={tweet.url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-blue-400">
          View on X
        </a>
      </div>
    </div>
  );
}

function EmptySources() {
  return (
    <div className="text-center py-4 text-gray-500 text-sm">
      No sources from this provider yet
    </div>
  );
}

function PipelineStageRow({ stage, index }: any) {
  const isRunning = stage.status === 'running' || stage.status === 'started';
  const isCompleted = stage.status === 'completed';
  const isFailed = stage.status === 'failed';
  
  return (
    <div className={cn(
      "flex items-center gap-4 p-3 rounded border",
      isRunning ? "bg-violet-950/20 border-violet-500/30" :
      isCompleted ? "bg-green-950/10 border-green-500/20" :
      isFailed ? "bg-red-950/10 border-red-500/20" :
      "bg-gray-800 border-gray-700"
    )}>
      <div className="text-sm text-gray-500 w-6">{index + 1}</div>
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-medium">{stage.stage}</span>
            <Badge className={cn(
              "text-[10px]",
              isRunning && "bg-violet-500/20 text-violet-400 animate-pulse",
              isCompleted && "bg-green-500/20 text-green-400",
              isFailed && "bg-red-500/20 text-red-400"
            )}>
              {isRunning && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
              {stage.status}
            </Badge>
          </div>
          <span className="text-xs text-gray-400">
            {stage.duration ? `${(stage.duration / 1000).toFixed(1)}s` : isRunning ? '...' : ''}
          </span>
        </div>
        <div className="text-xs text-gray-500 mt-1">{stage.message}</div>
        <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-600">
          {stage.serviceName && <span>Svc: {stage.serviceName}</span>}
          {stage.provider && <span>Prov: {stage.provider}</span>}
          {stage.model && <span>Model: {stage.model}</span>}
        </div>
      </div>
    </div>
  );
}

function AgentOutputRow({ agent }: any) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="border border-gray-800 rounded overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 bg-gray-800/50 hover:bg-gray-800"
      >
        <div className="flex items-center gap-3">
          <Badge className="text-[10px]">{agent.role}</Badge>
          <span className="text-sm text-gray-300">{agent.serviceName}</span>
          {agent.modelUsed && <span className="text-xs text-gray-500">{agent.modelUsed}</span>}
        </div>
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>
      {expanded && (
        <div className="p-3 bg-gray-900/50">
          <pre className="text-xs whitespace-pre-wrap text-gray-400 max-h-[300px] overflow-y-auto">
            {agent.output}
          </pre>
        </div>
      )}
    </div>
  );
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

function downloadReport(data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `market-${data.market.id}-report.json`;
  a.click();
  URL.revokeObjectURL(url);
}
