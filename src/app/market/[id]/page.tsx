'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  Brain,
  Clock,
  ExternalLink,
  Landmark,
  Loader2,
  Radio,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Gauge,
  Waves,
  CircleAlert,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { OperatorDashboardPayload, OperatorMarketItem } from '@/lib/engine/operator-dashboard-view-model';

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
    category: string;
  };
  candidate: {
    id: string;
    stage: string;
    candidateScore: number | null;
    triageStatus: string | null;
    researchQueued: boolean;
    skipReason: string | null;
    lastProcessedAt: string | null;
    updatedAt: string | null;
  } | null;
  counts: {
    researchRuns: number;
    decisions: number;
    outcomes: number;
    postmortems: number;
    orderbookSnapshots: number;
  };
  pipeline: {
    stages: Array<{
      stage: string;
      status: string;
      startedAt: string | null;
      endedAt: string | null;
      serviceName: string;
      provider: string;
      model: string;
      message: string;
      failureReason: string | null;
    }>;
  };
  sources: {
    deerflow: Array<{ title: string; url: string; snippet: string }>;
    reddit: Array<{ title: string; url: string; subreddit?: string; selftext?: string }>;
    twitter: Array<{ title: string; url: string; content?: string; author?: string }>;
    agentReach: Array<{ title: string; url: string; snippet: string }>;
    searxng: Array<{ title: string; url: string; snippet: string }>;
  };
  sourceErrors?: Record<string, Array<{ role: string; serviceName: string | null; message: string; modelUsed: string | null }>>;
  synthesis: {
    summary: string;
    finalAssessment: string;
  } | null;
  debate: {
    bullOutput: string;
    bearOutput: string;
    judgeOutput: string;
    contradictionOutput: string;
  } | null;
  risk: {
    finalDecision: string;
    edge: number;
  } | null;
  decision: {
    predictedProb: number;
    predictedSide: 'YES' | 'NO';
    confidence: number;
    rationale: string;
  } | null;
  paperBet: {
    actualOutcome: string | null;
    pnl: number | null;
    resolvedAt: string | null;
  } | null;
  auditLog: Array<{
    action: string;
    timestamp: string;
    actor: string;
    details: string;
  }>;
}

interface LiveProgressData {
  status: string;
  isLive: boolean;
  progress: {
    currentStage: string | null;
  };
  recentEvents: Array<{
    stage: string;
    type: string;
    message: string;
    timestamp: string;
  }>;
}

interface OrderbookDetailData {
  market: {
    id: string;
    title: string;
    venue: string;
    category: string;
    externalId: string;
    status: string;
    latestPrice: number | null;
    latestSpread: number | null;
    latestLiquidity: number | null;
    lastSnapshotAt: string | null;
  } | null;
  snapshot: {
    id: string;
    marketId: string;
    orderbookSource: string | null;
    spreadSource: string | null;
    bestBid: number | null;
    bestAsk: number | null;
    spread: number | null;
    bidDepth: number | null;
    askDepth: number | null;
    depthImbalance: number | null;
    largeBidWall: number | null;
    largeAskWall: number | null;
    thinBookDanger: boolean;
    priceImpact: number | null;
    fillProbability: number | null;
    recentMovement: number | null;
    depthDecay: number | null;
    capturedAt: string;
  };
  recentSnapshots: Array<{
    id: string;
    capturedAt: string;
    bestBid: number | null;
    bestAsk: number | null;
    spread: number | null;
    bidDepth: number | null;
    askDepth: number | null;
    depthImbalance: number | null;
    thinBookDanger: boolean;
    largeBidWall: number | null;
    largeAskWall: number | null;
    fillProbability: number | null;
    recentMovement: number | null;
    depthDecay: number | null;
  }>;
  analysis: {
    orderbookQualityScore?: number | null;
    levels?: Array<{ price: number; size: number; side?: 'BID' | 'ASK' }> | null;
  };
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(value: string | null): string {
  if (!value) return '—';
  const diff = Date.now() - new Date(value).getTime();
  const seconds = Math.max(0, Math.floor(diff / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—';
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number | null | undefined): string {
  if (value == null) return '—';
  const pct = value * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function toneForResult(result: string): string {
  if (result === 'WON') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (result === 'LOST' || result === 'FAILED') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (result === 'CANCELLED' || result === 'EXPIRED') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return 'border-gray-700 bg-gray-800 text-gray-300';
}

function toneForMode(mode: string): string {
  if (mode === 'DEMO') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (mode === 'LIVE') return 'border-red-500/30 bg-red-500/10 text-red-300';
  return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
}

function SourceList({
  title,
  items,
  errors,
}: {
  title: string;
  items: Array<{ title?: string; url?: string; snippet?: string; content?: string; subreddit?: string; author?: string }>;
  errors?: Array<{ role: string; serviceName: string | null; message: string; modelUsed: string | null }>;
}) {
  return (
    <Card className="border-gray-800 bg-gray-900/85">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm text-white">{title}</CardTitle>
        <CardDescription className="text-gray-500">{items.length} sources</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.slice(0, 4).map((item, index) => (
          <div key={`${item.url}-${index}`} className="rounded-2xl border border-gray-800 bg-gray-950/70 p-3">
            <a href={item.url} target="_blank" rel="noreferrer" className="font-medium text-cyan-300 hover:underline">
              {item.title || item.url || 'Untitled source'}
            </a>
            <p className="mt-2 text-sm text-gray-400">
              {item.snippet || item.content || item.subreddit || item.author || 'No preview available.'}
            </p>
          </div>
        ))}
        {items.length === 0 && (!errors || errors.length === 0) && (
          <p className="text-sm text-gray-500">No sources captured for this provider.</p>
        )}
        {items.length === 0 && errors && errors.length > 0 && (
          <div className="space-y-2">
            {errors.slice(0, 3).map((err, index) => (
              <div key={`${err.role}-${index}`} className="rounded-2xl border border-red-500/20 bg-red-500/5 p-3">
                <p className="text-xs uppercase tracking-[0.18em] text-red-400">{err.role}</p>
                <p className="mt-1 text-sm text-red-200">{err.message}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MarketDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const marketId = params.id as string;
  const activeTab = searchParams.get('tab');
  const isOrderbookTab = activeTab === 'orderbook';

  const [detail, setDetail] = useState<MarketDetailData | null>(null);
  const [orderbookDetail, setOrderbookDetail] = useState<OrderbookDetailData | null>(null);
  const [operatorMarket, setOperatorMarket] = useState<OperatorMarketItem | null>(null);
  const [operatorMode, setOperatorMode] = useState<'DEMO' | 'PAPER' | 'LIVE'>('PAPER');
  const [live, setLive] = useState<LiveProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchPage = async () => {
      try {
        const [detailRes, operatorRes, liveRes, orderbookRes] = await Promise.all([
          fetch(`/api/market/${marketId}/detail`, { cache: 'no-store' }),
          fetch(`/api/trading/operator?marketId=${marketId}`, { cache: 'no-store' }),
          fetch(`/api/market/${marketId}/live`, { cache: 'no-store' }),
          isOrderbookTab
            ? fetch(`/api/orderbook?marketId=${marketId}`, { cache: 'no-store' })
            : Promise.resolve(null),
        ]);

        if (!detailRes.ok) throw new Error(`Market detail failed with ${detailRes.status}`);
        if (!operatorRes.ok) throw new Error(`Operator detail failed with ${operatorRes.status}`);

        const detailPayload = (await detailRes.json()) as MarketDetailData;
        const operatorPayload = (await operatorRes.json()) as OperatorDashboardPayload;
        const livePayload = liveRes.ok ? ((await liveRes.json()) as LiveProgressData) : null;
        const orderbookPayload =
          orderbookRes && orderbookRes.ok
            ? ((await orderbookRes.json()) as OrderbookDetailData)
            : null;

        if (cancelled) return;
        setDetail(detailPayload);
        setOrderbookDetail(orderbookPayload);
        setOperatorMarket(operatorPayload.markets[0] ?? null);
        setOperatorMode(operatorPayload.mode);
        setLive(livePayload);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load market detail');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchPage();
    const interval = setInterval(() => {
      void fetchPage();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOrderbookTab, marketId]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-gray-900/90 px-5 py-4 text-sm text-gray-300">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
          Loading market audit page
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="min-h-screen bg-gray-950 p-8 text-red-300">
        Error loading market detail: {error || 'Unknown error'}
      </div>
    );
  }

  const sourceCounts = [
    { label: 'DeerFlow', count: detail.sources.deerflow.length },
    { label: 'Reddit', count: detail.sources.reddit.length },
    { label: 'X/Twitter', count: detail.sources.twitter.length },
    { label: 'Agent Reach', count: detail.sources.agentReach.length },
    { label: 'SearXNG', count: detail.sources.searxng.length },
  ];
  const totalSources = sourceCounts.reduce((sum, item) => sum + item.count, 0);
  const currentAttempt = operatorMarket?.attempts[0] ?? null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <div className="border-b border-gray-800 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.14),transparent_26%),linear-gradient(180deg,rgba(17,24,39,0.97),rgba(3,7,18,0.97))]">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-4">
              <Button variant="outline" size="sm" className="gap-2 border-gray-700 text-gray-200 hover:bg-gray-800" onClick={() => router.back()}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={cn('text-[10px]', toneForMode(operatorMode))}>{operatorMode}</Badge>
                  <Badge className="border-gray-700 bg-gray-800 text-[10px] text-gray-200">{detail.market.venue}</Badge>
                  <Badge className="border-gray-700 bg-gray-800 text-[10px] text-gray-200">{detail.market.status}</Badge>
                  {isOrderbookTab && (
                    <Badge className="border-cyan-500/30 bg-cyan-500/10 text-[10px] text-cyan-300">ORDERBOOK DETAIL</Badge>
                  )}
                  {live?.isLive && (
                    <Badge className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-300">LIVE PROCESSING</Badge>
                  )}
                </div>
                <h1 className="mt-3 max-w-5xl text-3xl font-semibold tracking-tight text-white">{detail.market.title}</h1>
                <p className="mt-3 max-w-4xl text-sm leading-6 text-gray-400">
                  {detail.market.description || 'No market description stored yet.'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" className="gap-2 border-gray-700 text-gray-200 hover:bg-gray-800" onClick={() => window.location.reload()}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <Button variant="outline" size="sm" className="gap-2 border-gray-700 text-gray-200 hover:bg-gray-800" onClick={() => router.push('/')}>
                <ExternalLink className="h-4 w-4" />
                Operator Dashboard
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {isOrderbookTab && (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
              {[
                { label: 'Best bid', value: formatPercent(orderbookDetail?.snapshot.bestBid), icon: TrendingUp },
                { label: 'Best ask', value: formatPercent(orderbookDetail?.snapshot.bestAsk), icon: TrendingDown },
                { label: 'Spread', value: formatPercent(orderbookDetail?.snapshot.spread), icon: Gauge },
                { label: 'Fill prob', value: formatPercent(orderbookDetail?.snapshot.fillProbability), icon: Activity },
                { label: 'Book quality', value: orderbookDetail?.analysis.orderbookQualityScore?.toFixed(1) ?? '—', icon: Waves },
                { label: 'Liquidity', value: formatCurrency(orderbookDetail?.market?.latestLiquidity ?? detail.market.liquidity), icon: Landmark },
              ].map((card) => (
                <Card key={card.label} className="border-gray-800 bg-gray-900/85">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{card.label}</p>
                        <p className="mt-2 text-lg font-semibold text-white">{card.value}</p>
                      </div>
                      <card.icon className="h-4 w-4 text-cyan-300" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </section>

            <section className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <Card className="border-gray-800 bg-gray-900/90">
                <CardHeader className="pb-4">
                  <CardTitle className="text-white">Exchange Snapshot</CardTitle>
                  <CardDescription className="text-gray-500">
                    Latest captured orderbook state for this market.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {orderbookDetail ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-300/70">Bid depth</p>
                          <p className="mt-2 text-2xl font-semibold text-emerald-300">{formatCurrency(orderbookDetail.snapshot.bidDepth)}</p>
                        </div>
                        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-red-300/70">Ask depth</p>
                          <p className="mt-2 text-2xl font-semibold text-red-300">{formatCurrency(orderbookDetail.snapshot.askDepth)}</p>
                        </div>
                        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-amber-300/70">Imbalance</p>
                          <p className="mt-2 text-2xl font-semibold text-amber-300">{formatSignedPercent(orderbookDetail.snapshot.depthImbalance)}</p>
                        </div>
                        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                          <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/70">Price impact</p>
                          <p className="mt-2 text-2xl font-semibold text-cyan-300">{formatPercent(orderbookDetail.snapshot.priceImpact)}</p>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-4 text-sm text-gray-300">
                        <div className="grid gap-3 md:grid-cols-2">
                          <p>Orderbook source: <span className="text-white">{orderbookDetail.snapshot.orderbookSource ?? 'unknown'}</span></p>
                          <p>Spread source: <span className="text-white">{orderbookDetail.snapshot.spreadSource ?? 'unknown'}</span></p>
                          <p>Captured at: <span className="text-white">{formatDateTime(orderbookDetail.snapshot.capturedAt)}</span></p>
                          <p>Recent movement: <span className="text-white">{formatSignedPercent(orderbookDetail.snapshot.recentMovement)}</span></p>
                          <p>Depth decay: <span className="text-white">{formatPercent(orderbookDetail.snapshot.depthDecay)}</span></p>
                          <p>Thin book: <span className={orderbookDetail.snapshot.thinBookDanger ? 'text-red-300' : 'text-emerald-300'}>{orderbookDetail.snapshot.thinBookDanger ? 'Warning' : 'No'}</span></p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <p className="text-sm font-medium text-white">Recent Snapshot Feed</p>
                        {orderbookDetail.recentSnapshots.length > 0 ? (
                          orderbookDetail.recentSnapshots.slice(0, 10).map((snapshot) => (
                            <div key={snapshot.id} className="grid grid-cols-[1.4fr_repeat(5,minmax(0,1fr))] gap-2 rounded-2xl border border-gray-800 bg-gray-950/75 px-3 py-2 text-xs">
                              <div className="text-gray-500">{formatDateTime(snapshot.capturedAt)}</div>
                              <div className="text-emerald-300">{formatPercent(snapshot.bestBid)}</div>
                              <div className="text-red-300">{formatPercent(snapshot.bestAsk)}</div>
                              <div className="text-cyan-300">{formatPercent(snapshot.spread)}</div>
                              <div className="text-gray-300">{formatCurrency(snapshot.bidDepth)}</div>
                              <div className="text-gray-300">{formatCurrency(snapshot.askDepth)}</div>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-4 text-sm text-gray-500">
                            No recent orderbook snapshots stored for this market.
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
                      No detailed orderbook snapshot stored for this market yet.
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="border-gray-800 bg-gray-900/90">
                <CardHeader className="pb-4">
                  <CardTitle className="text-white">Book Levels</CardTitle>
                  <CardDescription className="text-gray-500">
                    Raw stored levels from exchange capture.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {orderbookDetail?.analysis.levels?.length ? (
                    orderbookDetail.analysis.levels.slice(0, 30).map((level, index) => (
                      <div key={`${level.side ?? 'UNK'}-${level.price}-${index}`} className="grid grid-cols-[80px_1fr_1fr] gap-3 rounded-2xl border border-gray-800 bg-gray-950/75 px-3 py-2 text-xs">
                        <div className={level.side === 'BID' ? 'text-emerald-300' : level.side === 'ASK' ? 'text-red-300' : 'text-gray-400'}>
                          {level.side ?? 'LEVEL'}
                        </div>
                        <div className="text-gray-200">{formatPercent(level.price)}</div>
                        <div className="text-gray-400">{formatCurrency(level.size)}</div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-4 text-sm text-gray-500">
                      No raw level payload stored for this market.
                    </div>
                  )}

                  {orderbookDetail?.snapshot.thinBookDanger && (
                    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
                      <div className="flex items-center gap-2">
                        <CircleAlert className="h-4 w-4" />
                        Thin book warning active for this market.
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </>
        )}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          {[
            { label: 'Current status', value: operatorMarket?.latestAttemptStatus || live?.status || '—', icon: Activity },
            { label: 'Outcome', value: operatorMarket?.latestOutcome || detail.paperBet?.actualOutcome || 'Pending', icon: Sparkles },
            { label: 'Attempts', value: String(operatorMarket?.attemptCount ?? 0), icon: Target },
            { label: 'Liquidity', value: formatCurrency(detail.market.liquidity), icon: Landmark },
            { label: 'Implied price', value: formatPercent(detail.market.impliedProb), icon: TrendingUp },
            { label: 'Sources', value: String(totalSources), icon: Brain },
          ].map((card) => (
            <Card key={card.label} className="border-gray-800 bg-gray-900/85">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{card.label}</p>
                    <p className="mt-2 text-lg font-semibold text-white">{card.value}</p>
                  </div>
                  <card.icon className="h-4 w-4 text-cyan-300" />
                </div>
              </CardContent>
            </Card>
          ))}
        </section>

        {isOrderbookTab && (
          <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
            <Card className="border-gray-800 bg-gray-900/90">
              <CardHeader className="pb-4">
                <CardTitle className="text-white">Pipeline Readiness</CardTitle>
                <CardDescription className="text-gray-500">
                  Why research / decision / order sections may still be empty for this market.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Candidate stage</p>
                    <p className="mt-1 text-sm text-gray-200">{detail.candidate?.stage || 'NO_CANDIDATE'}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Candidate score</p>
                    <p className="mt-1 text-sm text-gray-200">{detail.candidate?.candidateScore != null ? detail.candidate.candidateScore.toFixed(1) : '—'}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Research runs</p>
                    <p className="mt-1 text-sm text-gray-200">{detail.counts.researchRuns}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Decisions</p>
                    <p className="mt-1 text-sm text-gray-200">{detail.counts.decisions}</p>
                  </div>
                </div>

                {detail.candidate?.stage === 'SCANNED' && detail.counts.researchRuns === 0 && (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200">
                    This market has orderbook snapshots, but pipeline has not advanced beyond <span className="font-medium text-amber-100">SCANNED</span>. That is why research, bull/bear, judge, decision, and audit sections are still empty.
                  </div>
                )}

                {detail.candidate?.skipReason && (
                  <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-200">
                    Skip reason: {detail.candidate.skipReason}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-gray-800 bg-gray-900/90">
              <CardHeader className="pb-4">
                <CardTitle className="text-white">Data Coverage</CardTitle>
                <CardDescription className="text-gray-500">
                  Stored artifacts available for this market right now.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {[
                  ['Orderbook snapshots', String(detail.counts.orderbookSnapshots)],
                  ['Research runs', String(detail.counts.researchRuns)],
                  ['Decisions', String(detail.counts.decisions)],
                  ['Outcomes', String(detail.counts.outcomes)],
                  ['Postmortems', String(detail.counts.postmortems)],
                  ['Triage status', detail.candidate?.triageStatus || '—'],
                  ['Research queued', detail.candidate ? (detail.candidate.researchQueued ? 'Yes' : 'No') : '—'],
                  ['Last processed', detail.candidate?.lastProcessedAt ? formatDateTime(detail.candidate.lastProcessedAt) : '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between rounded-2xl border border-gray-800 bg-gray-950/75 px-3 py-2 text-sm">
                    <span className="text-gray-400">{label}</span>
                    <span className="text-gray-200">{value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>
        )}

        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="border-gray-800 bg-gray-900/90">
            <CardHeader className="pb-4">
              <CardTitle className="text-white">Attempt Ledger</CardTitle>
              <CardDescription className="text-gray-500">
                Exact bet attempts for this market, including simulated attempts in DEMO/PAPER and real orders in LIVE.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {operatorMarket?.attempts.length ? (
                operatorMarket.attempts.map((attempt, index) => (
                  <div
                    key={attempt.id}
                    className={cn(
                      'rounded-[24px] border px-4 py-4',
                      index === 0 ? 'border-cyan-500/30 bg-cyan-500/8' : 'border-gray-800 bg-gray-950/70',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-white">{attempt.label}</span>
                          <Badge className={cn('text-[10px]', toneForMode(attempt.mode))}>{attempt.mode}</Badge>
                          <Badge className={cn('text-[10px]', toneForResult(attempt.result))}>{attempt.outcomeLabel}</Badge>
                        </div>
                        <p className="mt-2 text-sm text-gray-400">{attempt.rationale || 'No rationale recorded for this attempt.'}</p>
                      </div>
                      <div className="text-right text-sm text-gray-400">
                        <p>Placed {formatDateTime(attempt.placedAt)}</p>
                        <p className="mt-1">Updated {formatRelative(attempt.updatedAt)}</p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                      <div className="rounded-2xl border border-gray-800 bg-gray-900/75 p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Side</p>
                        <p className="mt-1 text-sm text-gray-200">{attempt.side || '—'}</p>
                      </div>
                      <div className="rounded-2xl border border-gray-800 bg-gray-900/75 p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Price</p>
                        <p className="mt-1 text-sm text-gray-200">{formatPercent(attempt.price)}</p>
                      </div>
                      <div className="rounded-2xl border border-gray-800 bg-gray-900/75 p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Size</p>
                        <p className="mt-1 text-sm text-gray-200">{formatCurrency(attempt.size)}</p>
                      </div>
                      <div className="rounded-2xl border border-gray-800 bg-gray-900/75 p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Fill</p>
                        <p className="mt-1 text-sm text-gray-200">{attempt.fillStatus}</p>
                      </div>
                      <div className="rounded-2xl border border-gray-800 bg-gray-900/75 p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Status</p>
                        <p className="mt-1 text-sm text-gray-200">{attempt.status}</p>
                      </div>
                      <div className="rounded-2xl border border-gray-800 bg-gray-900/75 p-3">
                        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Edge</p>
                        <p className="mt-1 text-sm text-gray-200">{formatPercent(attempt.edge)}</p>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-6 text-sm text-gray-400">
                  No attempts recorded for this market yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-800 bg-gray-900/90">
            <CardHeader className="pb-4">
              <CardTitle className="text-white">Live Status</CardTitle>
              <CardDescription className="text-gray-500">
                Current processing state, recent events, and resolution context.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="border-gray-700 bg-gray-800 text-[10px] text-gray-200">{live?.status || 'idle'}</Badge>
                  <Badge className="border-gray-700 bg-gray-800 text-[10px] text-gray-200">{live?.progress.currentStage || '—'}</Badge>
                </div>
                <p className="mt-3 text-sm text-gray-400">
                  Resolution time: {formatDateTime(detail.market.resolutionTime)}
                </p>
                <p className="mt-1 text-sm text-gray-400">
                  Paper outcome: {detail.paperBet?.actualOutcome || 'Pending'} {detail.paperBet?.pnl != null ? `• ${formatCurrency(detail.paperBet.pnl)}` : ''}
                </p>
              </div>
              <div className="space-y-3">
                {(live?.recentEvents || []).slice(0, 6).map((event, index) => (
                  <div key={`${event.timestamp}-${index}`} className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">{event.stage}</p>
                        <p className="mt-1 text-sm text-gray-400">{event.message}</p>
                      </div>
                      <span className="text-xs text-gray-500">{formatRelative(event.timestamp)}</span>
                    </div>
                  </div>
                ))}
                {(!live?.recentEvents || live.recentEvents.length === 0) && (
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-4 text-sm text-gray-500">
                    No recent live events for this market.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card className="border-gray-800 bg-gray-900/90">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-white">
                <TrendingUp className="h-4 w-4 text-emerald-300" />
                Bull vs Bear
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Bull thesis</p>
                <p className="mt-2 text-sm leading-6 text-gray-300">{operatorMarket?.bullThesis || detail.debate?.bullOutput || 'No bull thesis captured yet.'}</p>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Bear thesis</p>
                <p className="mt-2 text-sm leading-6 text-gray-300">{operatorMarket?.bearThesis || detail.debate?.bearOutput || 'No bear thesis captured yet.'}</p>
              </div>
              <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Judge conclusion</p>
                <p className="mt-2 text-sm leading-6 text-gray-300">{operatorMarket?.judgeConclusion || detail.debate?.judgeOutput || 'No judge output captured yet.'}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-gray-800 bg-gray-900/90">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-white">
                <ShieldAlert className="h-4 w-4 text-amber-300" />
                Risk and Decision
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-4">
                <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Risk decision</p>
                <p className="mt-2 text-sm leading-6 text-gray-300">{operatorMarket?.riskDecision || detail.decision?.rationale || 'No risk summary available yet.'}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Predicted side</p>
                  <p className="mt-1 text-sm text-gray-200">{detail.decision?.predictedSide || '—'}</p>
                </div>
                <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Predicted prob</p>
                  <p className="mt-1 text-sm text-gray-200">{formatPercent(detail.decision?.predictedProb)}</p>
                </div>
                <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Edge</p>
                  <p className="mt-1 text-sm text-gray-200">{formatPercent(detail.risk?.edge)}</p>
                </div>
              </div>
              {detail.synthesis && (
                <>
                  <Separator className="bg-gray-800" />
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Synthesis</p>
                    <p className="mt-2 text-sm leading-6 text-gray-300">{detail.synthesis.finalAssessment || detail.synthesis.summary}</p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
          <SourceList title="DeerFlow Sources" items={detail.sources.deerflow} errors={detail.sourceErrors?.deerflow} />
          <SourceList title="Reddit Sources" items={detail.sources.reddit} errors={detail.sourceErrors?.reddit} />
          <SourceList title="X/Twitter Sources" items={detail.sources.twitter} errors={detail.sourceErrors?.twitter} />
          <SourceList title="Agent Reach Sources" items={detail.sources.agentReach} errors={detail.sourceErrors?.agentReach} />
          <SourceList title="SearXNG Sources" items={detail.sources.searxng} errors={detail.sourceErrors?.searxng} />

          <Card className="border-gray-800 bg-gray-900/85">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-white">
                <Scale className="h-4 w-4 text-cyan-300" />
                Pipeline Timeline
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.pipeline.stages.map((stage, index) => (
                <div key={`${stage.stage}-${index}`} className="rounded-2xl border border-gray-800 bg-gray-950/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-white">{stage.stage}</p>
                      <p className="mt-1 text-xs text-gray-500">{stage.serviceName || stage.provider || 'system'}</p>
                    </div>
                    <Badge className="border-gray-700 bg-gray-800 text-[10px] text-gray-200">{stage.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-gray-400">{stage.message || stage.failureReason || 'No stage message recorded.'}</p>
                  <p className="mt-2 text-xs text-gray-500">
                    {formatDateTime(stage.startedAt)} → {formatDateTime(stage.endedAt)}
                  </p>
                </div>
              ))}
              {detail.pipeline.stages.length === 0 && (
                <p className="text-sm text-gray-500">No pipeline stages stored for this market yet.</p>
              )}
            </CardContent>
          </Card>
        </section>

        <section>
          <Card className="border-gray-800 bg-gray-900/90">
            <CardHeader className="pb-4">
              <CardTitle className="text-white">Audit Trail</CardTitle>
              <CardDescription className="text-gray-500">
                Stored system changes and lifecycle notes for this market.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {detail.auditLog.slice(0, 8).map((entry, index) => (
                <div key={`${entry.timestamp}-${index}`} className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-white">{entry.action}</p>
                      <p className="mt-1 text-sm text-gray-400">{entry.details}</p>
                    </div>
                    <span className="text-xs text-gray-500">{formatDateTime(entry.timestamp)}</span>
                  </div>
                </div>
              ))}
              {detail.auditLog.length === 0 && (
                <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-4 text-sm text-gray-500">
                  No audit log entries for this market yet.
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
