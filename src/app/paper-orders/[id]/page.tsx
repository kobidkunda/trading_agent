'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  Activity,
  Clock,
  Brain,
  Database,
  ShieldAlert,
  Target,
  TrendingUp,
  TrendingDown,
  ScrollText,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ExternalLink,
  History,
  Gauge,
  Info,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ── API response types (inferred from /api/orders/[id] route include shape) ──

interface FillRecord {
  id: string;
  orderId: string;
  price: number;
  size: number;
  fee: number;
  fillModel: string | null;
  fillTime: string;
}

interface StrategyConfigVersionBrief {
  id: string;
  version: number;
  name: string | null;
  status: string;
}

interface DecisionRecord {
  id: string;
  action: string;
  side: string | null;
  reasonCode: string | null;
  reason: string | null;
  judgeProbability: number | null;
  impliedProb: number | null;
  edge: number | null;
  confidence: number | null;
  uncertainty: number | null;
  maxSize: number | null;
  urgency: string | null;
  fees: number | null;
  slippage: number | null;
  mode: string;
  dataSource: string;
  executionMode: string;
  dryRun: boolean;
  brierScore: number | null;
  createdAt: string;
  strategyConfigVersion: StrategyConfigVersionBrief | null;
}

interface PaperBetRecord {
  id: string;
  marketId: string;
  predictionType: string;
  setupType: string | null;
  aPlusStatus: string | null;
  executionStatus: string;
  executedAt: string | null;
  predictedProb: number;
  predictedSide: string;
  impliedProb: number;
  edge: number;
  confidence: number;
  stake: number;
  entryPrice: number;
  actualOutcome: string | null;
  resolvedProb: number | null;
  resolvedAt: string | null;
  directionCorrect: boolean | null;
  probError: number | null;
  brierScore: number | null;
  pnl: number | null;
  createdAt: string;
  updatedAt: string;
  decision: DecisionRecord;
}

interface AgentOutputRecord {
  id: string;
  role: string;
  stage: string | null;
  serviceName: string | null;
  provider: string | null;
  modelUsed: string | null;
  summary: string | null;
  output: string;
  tokenCount: number | null;
  latencyMs: number | null;
  startedAt: string | null;
  endedAt: string | null;
}

interface ResearchSourceRecord {
  id: string;
  url: string;
  title: string | null;
  sourceType: string;
}

interface ResearchRunRecord {
  id: string;
  status: string;
  depth: string;
  startedAt: string | null;
  completedAt: string | null;
  agentOutputs: AgentOutputRecord[];
  sources: ResearchSourceRecord[];
}

interface MarketContextRecord {
  id: string;
  title: string;
  venue: string;
  category: string;
  status: string;
  externalId: string;
  description: string | null;
  latestPrice: number | null;
  latestSpread: number | null;
  latestLiquidity: number | null;
  resolutionTime: string | null;
  positions: Array<{
    id: string;
    side: string;
    entryPrice: number;
    currentSize: number;
    status: string;
    unrealizedPnl: number;
  }>;
  decisions: DecisionRecord[];
  researchRuns: ResearchRunRecord[];
}

interface AuditLogRecord {
  id: string;
  action: string;
  actor: string | null;
  details: string | null;
  createdAt: string;
}

interface OrderDetailPayload {
  id: string;
  marketId: string;
  venueOrderId: string | null;
  executionMode: string;
  dataSource: string;
  lifecycleStatus: string;
  side: string;
  price: number;
  size: number;
  filledSize: number;
  remainingSize: number;
  avgFillPrice: number | null;
  failureReason: string | null;
  spreadCost: number | null;
  slippageCost: number | null;
  estimatedFillCost: number | null;
  status: string;
  retryCount: number;
  fillAttemptCount: number;
  lastFillAttemptAt: string | null;
  orderExpiryAt: string | null;
  fillModel: string | null;
  submittedAt: string | null;
  filledAt: string | null;
  cancelledAt: string | null;
  expiredAt: string | null;
  createdAt: string;
  updatedAt: string;
  fills: FillRecord[];
  paperBet: PaperBetRecord | null;
  market: MarketContextRecord | null;
  strategyConfigVersion: StrategyConfigVersionBrief | null;
  auditLogs: AuditLogRecord[];
}

// ── Helpers ──

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(value: string | null | undefined): string {
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

function formatCurrency(val: number | null | undefined): string {
  if (val == null) return '—';
  if (Math.abs(val) >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `$${(val / 1_000).toFixed(1)}K`;
  return `$${val.toFixed(2)}`;
}

function formatPercent(val: number | null | undefined): string {
  if (val == null) return '—';
  return `${(val * 100).toFixed(1)}%`;
}

function formatPnl(val: number | null): string {
  if (val === null) return '—';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${formatCurrency(val)}`;
}

function pnlColor(val: number | null): string {
  if (val === null) return 'text-gray-500';
  if (val > 0) return 'text-emerald-400';
  if (val < 0) return 'text-red-400';
  return 'text-gray-400';
}

function lifecycleBadge(status: string) {
  const styles: Record<string, string> = {
    PLANNED: 'border-gray-500/30 bg-gray-500/10 text-gray-400',
    SUBMITTED: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
    PARTIALLY_FILLED: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    FILLED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    CANCELLED: 'border-red-500/30 bg-red-500/10 text-red-400',
    FAILED: 'border-red-600/30 bg-red-600/10 text-red-500',
    EXPIRED: 'border-gray-600/30 bg-gray-600/10 text-gray-500',
  };
  return (
    <Badge variant="outline" className={cn('text-[10px]', styles[status] ?? styles.PLANNED)}>
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

function sideBadge(side: string) {
  const isYes = side === 'YES';
  return (
    <Badge className={cn(
      'border-transparent text-[10px] text-white',
      isYes ? 'bg-emerald-600/70' : 'bg-red-600/70',
    )}>
      {side}
    </Badge>
  );
}

function decisionActionBadge(action: string) {
  const styles: Record<string, string> = {
    BID: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    SKIP: 'border-gray-500/30 bg-gray-500/10 text-gray-400',
    WATCH: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  };
  return (
    <Badge variant="outline" className={cn('text-[10px]', styles[action] ?? styles.SKIP)}>
      {action}
    </Badge>
  );
}

function researchStatusBadge(status: string) {
  const styles: Record<string, string> = {
    COMPLETED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    RUNNING: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
    PENDING: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    FAILED: 'border-red-500/30 bg-red-500/10 text-red-400',
  };
  return (
    <Badge variant="outline" className={cn('text-[10px]', styles[status] ?? 'border-gray-700 bg-gray-800 text-gray-300')}>
      {status}
    </Badge>
  );
}

// ── Timeline helpers ──

const ORDER_LIFECYCLE_STAGES = ['PLANNED', 'SUBMITTED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'FAILED', 'EXPIRED'] as const;

function stageIndex(stage: string): number {
  return ORDER_LIFECYCLE_STAGES.indexOf(stage as typeof ORDER_LIFECYCLE_STAGES[number]);
}

function stageIcon(stage: string) {
  if (stage === 'PLANNED') return <Clock className="h-4 w-4" />;
  if (stage === 'SUBMITTED') return <Activity className="h-4 w-4" />;
  if (stage === 'PARTIALLY_FILLED') return <TrendingUp className="h-4 w-4" />;
  if (stage === 'FILLED') return <CheckCircle className="h-4 w-4" />;
  if (stage === 'CANCELLED') return <XCircle className="h-4 w-4" />;
  if (stage === 'EXPIRED') return <AlertTriangle className="h-4 w-4" />;
  if (stage === 'FAILED') return <ShieldAlert className="h-4 w-4" />;
  return <Info className="h-4 w-4" />;
}

// ── Page ──

export default function PaperOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;

  const [detail, setDetail] = useState<OrderDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchOrder = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}`, { cache: 'no-store' });
        if (!res.ok) {
          if (res.status === 404) throw new Error('Order not found');
          throw new Error(`Failed with status ${res.status}`);
        }
        const payload = (await res.json()) as OrderDetailPayload;
        if (!cancelled) {
          setDetail(payload);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load order detail');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void fetchOrder();
    const interval = setInterval(() => {
      void fetchOrder();
    }, 15_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orderId]);

  // ── Loading ──

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-gray-900/90 px-5 py-4 text-sm text-gray-300">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />
          Loading order detail
        </div>
      </div>
    );
  }

  // ── Error ──

  if (error || !detail) {
    return (
      <div className="min-h-screen bg-gray-950 p-8">
        <Card className="border-red-500/30 bg-gray-900">
          <CardContent className="flex flex-col items-center py-12">
            <XCircle className="mb-3 h-10 w-10 text-red-400" />
            <p className="text-sm text-red-400">{error || 'Order not found'}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 gap-2 border-gray-700 text-gray-300 hover:bg-gray-800"
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Derived data ──

  const isFailed = detail.lifecycleStatus === 'FAILED';
  const isFilled = detail.lifecycleStatus === 'FILLED';
  const isCancelled = detail.lifecycleStatus === 'CANCELLED';
  const isExpired = detail.lifecycleStatus === 'EXPIRED';
  const isTerminal = isFilled || isCancelled || isExpired || isFailed;
  const currentStageIdx = stageIndex(detail.lifecycleStatus);
  const decision = detail.paperBet?.decision ?? null;
  const paperBet = detail.paperBet;
  const market = detail.market;
  const fills = detail.fills ?? [];
  const researchRuns = market?.researchRuns ?? [];
  const auditLogs = detail.auditLogs ?? [];
  const pnlValue = paperBet?.pnl ?? null;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* ── Header ── */}
      <div className="border-b border-gray-800 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.14),transparent_26%),linear-gradient(180deg,rgba(17,24,39,0.97),rgba(3,7,18,0.97))]">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-4">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-gray-700 text-gray-200 hover:bg-gray-800"
                onClick={() => router.push('/paper-orders')}
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Paper Orders
              </Button>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {market && (
                    <Badge className="border-gray-700 bg-gray-800 text-[10px] text-gray-200">
                      {market.venue}
                    </Badge>
                  )}
                  {sideBadge(detail.side)}
                  {lifecycleBadge(detail.lifecycleStatus)}
                  {detail.executionMode === 'SIMULATED' && (
                    <Badge className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-300">
                      PAPER
                    </Badge>
                  )}
                  {detail.fillModel && (
                    <Badge className="border-gray-700 bg-gray-800 text-[10px] text-gray-300">
                      {detail.fillModel}
                    </Badge>
                  )}
                </div>
                <h1 className="mt-3 max-w-5xl text-3xl font-semibold tracking-tight text-white">
                  {market?.title ?? 'Unknown Market'}
                </h1>
                <p className="mt-3 max-w-4xl text-sm leading-6 text-gray-400">
                  Order #{detail.id.slice(0, 8)} — created {formatDateTime(detail.createdAt)}
                  {detail.venueOrderId && (
                    <span className="ml-2 inline-flex items-center gap-1">
                      <Database className="h-3 w-3 text-gray-500" />
                      <span className="text-gray-500">{detail.venueOrderId}</span>
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-gray-700 text-gray-200 hover:bg-gray-800"
                onClick={() => window.location.reload()}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              {market && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 border-gray-700 text-gray-200 hover:bg-gray-800"
                  onClick={() => router.push(`/market/${market.id}`)}
                >
                  <ExternalLink className="h-4 w-4" />
                  Market Audit
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {/* ── Stats grid 4-up ── */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="border-gray-800 bg-gray-900/85">
            <CardContent className="p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Price</p>
              <p className="mt-2 text-lg font-semibold text-white">
                {detail.price != null ? `$${detail.price.toFixed(4)}` : '—'}
              </p>
            </CardContent>
          </Card>
          <Card className="border-gray-800 bg-gray-900/85">
            <CardContent className="p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Order Size</p>
              <p className="mt-2 text-lg font-semibold text-white">{formatCurrency(detail.size)}</p>
            </CardContent>
          </Card>
          <Card className="border-gray-800 bg-gray-900/85">
            <CardContent className="p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Filled / Remaining</p>
              <p className="mt-2 text-lg font-semibold">
                <span className="text-emerald-300">{formatCurrency(detail.filledSize)}</span>
                <span className="text-gray-600"> / </span>
                <span className="text-amber-300">{formatCurrency(detail.remainingSize)}</span>
              </p>
            </CardContent>
          </Card>
          <Card
            className={cn(
              'border bg-gray-900/85',
              pnlValue && pnlValue > 0 ? 'border-emerald-500/20' : pnlValue && pnlValue < 0 ? 'border-red-500/20' : 'border-gray-800',
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">PnL</p>
                  <p className={cn('mt-2 text-lg font-semibold', pnlColor(pnlValue))}>
                    {formatPnl(pnlValue)}
                  </p>
                </div>
                {pnlValue && pnlValue > 0 ? (
                  <TrendingUp className="h-4 w-4 text-emerald-300" />
                ) : pnlValue && pnlValue < 0 ? (
                  <TrendingDown className="h-4 w-4 text-red-300" />
                ) : null}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ── Order detail / costs ── */}
        <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          {/* Left: Detail stats */}
          <Card className="border-gray-800 bg-gray-900/90">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-white">
                <ScrollText className="h-4 w-4 text-emerald-300" />
                Order Detail
              </CardTitle>
              <CardDescription className="text-gray-500">
                All order fields and lifecycle timestamps.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Avg fill price</p>
                  <p className="mt-1 text-sm text-white">{formatCurrency(detail.avgFillPrice)}</p>
                </div>
                <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Fill attempts</p>
                  <p className="mt-1 text-sm text-white">{detail.fillAttemptCount}</p>
                </div>
                <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Retry count</p>
                  <p className="mt-1 text-sm text-white">{detail.retryCount}</p>
                </div>
                <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Fill model</p>
                  <p className="mt-1 text-sm text-white">{detail.fillModel || '—'}</p>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Execution mode</p>
                  <p className="mt-1 text-sm text-white">{detail.executionMode}</p>
                </div>
                <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Data source</p>
                  <p className="mt-1 text-sm text-white">{detail.dataSource}</p>
                </div>
                <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Order expiry</p>
                  <p className="mt-1 text-sm text-white">{formatDateTime(detail.orderExpiryAt)}</p>
                </div>
                <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Venue order ID</p>
                  <p className="mt-1 text-sm text-gray-400">{detail.venueOrderId || 'internal-only'}</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
                {[
                  { label: 'Created', value: formatDateTime(detail.createdAt) },
                  { label: 'Submitted', value: formatDateTime(detail.submittedAt) },
                  { label: 'Filled', value: formatDateTime(detail.filledAt) },
                  { label: 'Cancelled', value: formatDateTime(detail.cancelledAt) },
                  { label: 'Expired', value: formatDateTime(detail.expiredAt) },
                  { label: 'Last fill attempt', value: formatDateTime(detail.lastFillAttemptAt) },
                  { label: 'Updated', value: formatRelative(detail.updatedAt) },
                  { label: 'Strategy version', value: detail.strategyConfigVersion ? `v${detail.strategyConfigVersion.version}` : '—' },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{item.label}</p>
                    <p className="mt-1 text-sm text-gray-300">{item.value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Right: Costs */}
          <Card className="border-gray-800 bg-gray-900/90">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-white">
                <Gauge className="h-4 w-4 text-cyan-300" />
                Execution Costs
              </CardTitle>
              <CardDescription className="text-gray-500">
                Spread, slippage, and fee breakdown.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: 'Spread cost', value: formatCurrency(detail.spreadCost) },
                { label: 'Slippage cost', value: formatCurrency(detail.slippageCost) },
                { label: 'Estimated fill cost', value: formatCurrency(detail.estimatedFillCost) },
                { label: 'Avg fill price', value: formatCurrency(detail.avgFillPrice) },
                { label: 'Order price', value: detail.price != null ? `$${detail.price.toFixed(4)}` : '—' },
                { label: 'Filled size', value: formatCurrency(detail.filledSize) },
                { label: 'Remaining size', value: formatCurrency(detail.remainingSize) },
                { label: 'Fill attempts', value: String(detail.fillAttemptCount) },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-2xl border border-gray-800 bg-gray-950/75 px-3 py-2 text-sm">
                  <span className="text-gray-400">{item.label}</span>
                  <span className="font-medium text-gray-200">{item.value}</span>
                </div>
              ))}
              {detail.failureReason && (
                <div className="rounded-2xl border border-red-500/30 bg-red-500/5 px-3 py-3 text-sm text-red-300">
                  <span className="font-medium">Failure reason:</span> {detail.failureReason}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── Fills table ── */}
        <section>
          <Card className="border-gray-800 bg-gray-900/90">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-white">
                <Activity className="h-4 w-4 text-cyan-300" />
                Fills
                <span className="text-xs font-normal text-gray-500">({fills.length} total)</span>
              </CardTitle>
              <CardDescription className="text-gray-500">
                Individual fill events for this order.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {fills.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-800 bg-gray-950/60 py-12">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                    <ScrollText className="h-6 w-6 text-gray-500" />
                  </div>
                  <p className="text-sm text-gray-400">No fills recorded yet</p>
                  <p className="mt-1 text-xs text-gray-600">
                    {isTerminal ? 'This order reached its terminal state without any fills.' : 'Fills will appear as they are recorded.'}
                  </p>
                </div>
              ) : (
                <div className="max-h-[500px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-gray-800 hover:bg-transparent">
                        <TableHead className="text-gray-500">Fill time</TableHead>
                        <TableHead className="text-right text-gray-500">Price</TableHead>
                        <TableHead className="text-right text-gray-500">Size</TableHead>
                        <TableHead className="text-right text-gray-500">Fee</TableHead>
                        <TableHead className="text-gray-500">Fill model</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fills.map((fill) => (
                        <TableRow key={fill.id} className="border-gray-800 hover:bg-gray-800/50">
                          <TableCell className="text-xs text-gray-300">
                            {formatDateTime(fill.fillTime)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums text-white">
                            ${fill.price.toFixed(4)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums text-gray-300">
                            {formatCurrency(fill.size)}
                          </TableCell>
                          <TableCell className="text-right text-xs tabular-nums text-gray-500">
                            {formatCurrency(fill.fee)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="border-gray-700 bg-gray-800 text-[10px] text-gray-300">
                              {fill.fillModel || '—'}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── Decision context ── */}
        {decision && (
          <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
            <Card className="border-gray-800 bg-gray-900/90">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-white">
                  <Target className="h-4 w-4 text-emerald-300" />
                  Decision
                </CardTitle>
                <CardDescription className="text-gray-500">
                  The evaluation that produced this order.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  {decisionActionBadge(decision.action)}
                  {decision.side && sideBadge(decision.side)}
                  {decision.urgency && (
                    <Badge variant="outline" className={cn(
                      'text-[10px]',
                      decision.urgency === 'IMMEDIATE' && 'border-red-500/30 bg-red-500/10 text-red-400',
                      decision.urgency === 'HIGH' && 'border-amber-500/30 bg-amber-500/10 text-amber-400',
                      decision.urgency === 'MEDIUM' && 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
                      decision.urgency === 'LOW' && 'border-gray-700 bg-gray-800 text-gray-300',
                    )}>
                      {decision.urgency}
                    </Badge>
                  )}
                </div>
                {decision.reason && (
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Rationale</p>
                    <p className="mt-2 text-sm leading-6 text-gray-300">{decision.reason}</p>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-300/70">Predicted prob</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-300">{formatPercent(decision.judgeProbability)}</p>
                  </div>
                  <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/70">Implied prob</p>
                    <p className="mt-1 text-sm font-semibold text-cyan-300">{formatPercent(decision.impliedProb)}</p>
                  </div>
                  <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-amber-300/70">Edge</p>
                    <p className="mt-1 text-sm font-semibold text-amber-300">{formatPercent(decision.edge)}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Confidence</p>
                    <p className="mt-1 text-sm font-semibold text-gray-200">{formatPercent(decision.confidence)}</p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Max size</p>
                    <p className="mt-1 text-sm text-gray-200">{formatCurrency(decision.maxSize)}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Uncertainty</p>
                    <p className="mt-1 text-sm text-gray-200">{formatPercent(decision.uncertainty)}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Reason code</p>
                    <p className="mt-1 text-sm text-gray-300">{decision.reasonCode || '—'}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Brier score</p>
                    <p className="mt-1 text-sm text-gray-300">{decision.brierScore != null ? decision.brierScore.toFixed(4) : '—'}</p>
                  </div>
                </div>
                {decision.strategyConfigVersion && (
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3 text-xs text-gray-500">
                    Strategy: <span className="text-gray-300">{decision.strategyConfigVersion.name || `v${decision.strategyConfigVersion.version}`}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-gray-800 bg-gray-900/90">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-white">
                  <Database className="h-4 w-4 text-cyan-300" />
                  Paper Bet
                </CardTitle>
                <CardDescription className="text-gray-500">
                  Dry-run tracking and scoring data.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border p-4 border-cyan-500/30 bg-cyan-500/5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/70">P&L</p>
                      <p className={cn('mt-2 text-3xl font-semibold', pnlColor(pnlValue))}>
                        {formatPnl(pnlValue)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Brier</p>
                      <p className="mt-1 text-lg font-semibold text-gray-200">
                        {paperBet?.brierScore != null ? paperBet.brierScore.toFixed(4) : '—'}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {paperBet ? ([
                    { label: 'Predicted prob', value: formatPercent(paperBet.predictedProb), accent: 'emerald' },
                    { label: 'Implied prob', value: formatPercent(paperBet.impliedProb), accent: 'cyan' },
                    { label: 'Edge', value: formatPercent(paperBet.edge), accent: 'amber' },
                    { label: 'Confidence', value: formatPercent(paperBet.confidence), accent: 'gray' },
                    { label: 'Stake', value: formatCurrency(paperBet.stake), accent: 'gray' },
                    { label: 'Entry price', value: paperBet.entryPrice != null ? `$${paperBet.entryPrice.toFixed(4)}` : '—', accent: 'gray' },
                    { label: 'Predicted side', value: paperBet.predictedSide, accent: 'gray' },
                    { label: 'Prediction type', value: paperBet.predictionType, accent: 'gray' },
                    { label: 'Setup type', value: paperBet.setupType || '—', accent: 'gray' },
                    { label: 'A+ status', value: paperBet.aPlusStatus || '—', accent: 'gray' },
                    { label: 'Prob error', value: paperBet.probError != null ? paperBet.probError.toFixed(4) : '—', accent: 'gray' },
                    { label: 'Direction correct', value: paperBet.directionCorrect === null ? '—' : paperBet.directionCorrect ? 'Yes' : 'No', accent: 'gray' },
                  ] as const).map((item) => (
                    <div key={item.label} className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{item.label}</p>
                      <p className="mt-1 text-sm text-gray-200">{item.value}</p>
                    </div>
                  ))
                : null}
                </div>
                {paperBet?.actualOutcome && (
                  <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                    <p className="text-xs text-gray-400">
                      Outcome: <span className="font-medium text-emerald-300">{paperBet.actualOutcome}</span>
                      {paperBet.resolvedAt && <span className="ml-1 text-gray-500">at {formatDateTime(paperBet.resolvedAt)}</span>}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── Failure info ── */}
        {isFailed && (
          <section>
            <Card className="border-red-500/30 bg-gray-900/90">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-white">
                  <ShieldAlert className="h-4 w-4 text-red-400" />
                  Failure Information
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
                  <p className="text-sm font-medium text-red-300">Failure reason</p>
                  <p className="mt-2 text-sm leading-6 text-red-200">
                    {detail.failureReason || 'No failure reason recorded.'}
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Retry count</p>
                    <p className="mt-1 text-sm text-white">{detail.retryCount}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Fill attempts</p>
                    <p className="mt-1 text-sm text-white">{detail.fillAttemptCount}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Last fill attempt</p>
                    <p className="mt-1 text-sm text-white">{formatDateTime(detail.lastFillAttemptAt)}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Venue order ID</p>
                    <p className="mt-1 text-sm text-gray-400">{detail.venueOrderId || '—'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        {/* ── Market context ── */}
        {market && (
          <section className="grid gap-6 xl:grid-cols-2">
            <Card className="border-gray-800 bg-gray-900/90">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-white">
                  <Database className="h-4 w-4 text-cyan-300" />
                  Market Context
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-2xl border border-gray-800 bg-gray-950/75 p-4">
                  <h3 className="font-medium text-white">{market.title}</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge className="border-gray-700 bg-gray-800 text-[10px] text-gray-200">{market.venue}</Badge>
                    <Badge className="border-gray-700 bg-gray-800 text-[10px] text-gray-200">{market.category}</Badge>
                    <Badge className="border-gray-700 bg-gray-800 text-[10px] text-gray-200">{market.status}</Badge>
                  </div>
                  {market.description && (
                    <p className="mt-3 text-sm leading-6 text-gray-400">{market.description}</p>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    { label: 'Latest price', value: formatPercent(market.latestPrice) },
                    { label: 'Spread', value: formatPercent(market.latestSpread) },
                    { label: 'Liquidity', value: formatCurrency(market.latestLiquidity) },
                    { label: 'Resolution', value: formatDateTime(market.resolutionTime) },
                    { label: 'External ID', value: market.externalId },
                    { label: 'Market ID', value: market.id.slice(0, 12) },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{item.label}</p>
                      <p className="mt-1 text-sm text-gray-200">{item.value}</p>
                    </div>
                  ))}
                </div>
                {market.positions.length > 0 && (
                  <>
                    <Separator className="bg-gray-800" />
                    <div>
                      <p className="mb-3 text-sm font-medium text-white">Open Positions</p>
                      {market.positions.map((pos) => (
                        <div key={pos.id} className="mb-2 rounded-2xl border border-gray-800 bg-gray-950/75 p-3 text-sm">
                          <div className="flex items-center gap-2">
                            {sideBadge(pos.side)}
                            <span className="text-gray-300">{pos.status}</span>
                            <span className="tabular-nums text-gray-400">
                              Entry: ${pos.entryPrice.toFixed(4)} | Size: {formatCurrency(pos.currentSize)}
                            </span>
                            <span className={cn('tabular-nums', pnlColor(pos.unrealizedPnl))}>
                              {formatPnl(pos.unrealizedPnl)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Other market decisions */}
            {market.decisions.length > 0 && (
              <Card className="border-gray-800 bg-gray-900/90">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2 text-white">
                    <History className="h-4 w-4 text-amber-300" />
                    Market Decisions
                  </CardTitle>
                  <CardDescription className="text-gray-500">
                    Recent decisions for this market.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {market.decisions.map((dec) => (
                    <div key={dec.id} className="rounded-2xl border border-gray-800 bg-gray-950/75 p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        {decisionActionBadge(dec.action)}
                        {dec.side && sideBadge(dec.side)}
                        {dec.urgency && (
                          <Badge variant="outline" className="border-gray-700 bg-gray-800 text-[10px] text-gray-300">
                            {dec.urgency}
                          </Badge>
                        )}
                      </div>
                      {dec.reason && (
                        <p className="mt-2 text-sm text-gray-400">{dec.reason}</p>
                      )}
                      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                        <span className="text-gray-500">Edge: {formatPercent(dec.edge)}</span>
                        <span className="text-gray-500">Conf: {formatPercent(dec.confidence)}</span>
                        <span className="text-gray-500">{formatDateTime(dec.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </section>
        )}

        {/* ── Research & Agent outputs ── */}
        <section>
          <Card className="border-gray-800 bg-gray-900/90">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-white">
                <Brain className="h-4 w-4 text-cyan-300" />
                Research & Agent Outputs
                <span className="text-xs font-normal text-gray-500">({researchRuns.length} runs)</span>
              </CardTitle>
              <CardDescription className="text-gray-500">
                Research pipeline and AI agent analysis for this market.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {researchRuns.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-800 bg-gray-950/60 py-12">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                    <Brain className="h-6 w-6 text-gray-500" />
                  </div>
                  <p className="text-sm text-gray-400">No research data</p>
                  <p className="mt-1 text-xs text-gray-600">Research runs and agent outputs will appear when pipeline processes this market.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {researchRuns.map((run) => (
                    <div key={run.id} className="rounded-2xl border border-gray-800 bg-gray-950/70 p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <span className="text-sm font-medium text-white">{run.depth}</span>
                          {researchStatusBadge(run.status)}
                        </div>
                        <span className="text-xs text-gray-500">
                          {formatDateTime(run.startedAt)} → {formatDateTime(run.completedAt)}
                        </span>
                      </div>

                      {/* Agent outputs */}
                      {run.agentOutputs.length > 0 && (
                        <div className="mt-4 space-y-3">
                          <p className="text-xs font-medium text-gray-400">Agent Outputs ({run.agentOutputs.length})</p>
                          {run.agentOutputs.map((output) => (
                            <div key={output.id} className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <Badge className="border-cyan-500/30 bg-cyan-500/10 text-[10px] text-cyan-300">
                                    {output.role}
                                  </Badge>
                                  {output.modelUsed && (
                                    <Badge variant="outline" className="border-gray-700 bg-gray-800 text-[10px] text-gray-300">
                                      {output.modelUsed}
                                    </Badge>
                                  )}
                                  {output.provider && (
                                    <Badge variant="outline" className="border-gray-700 bg-gray-800 text-[10px] text-gray-500">
                                      {output.provider}
                                    </Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 text-xs text-gray-500">
                                  {output.latencyMs != null && <span>{output.latencyMs}ms</span>}
                                  {output.tokenCount != null && <span>{output.tokenCount} tokens</span>}
                                  {output.stage && <span className="text-gray-600">{output.stage}</span>}
                                </div>
                              </div>
                              {(output.summary || output.output) && (
                                <p className="mt-3 text-sm leading-6 text-gray-400">
                                  {output.summary || (() => {
                                    try {
                                      const parsed = JSON.parse(output.output);
                                      if (typeof parsed === 'string') return parsed;
                                      return JSON.stringify(parsed, null, 2);
                                    } catch {
                                      return output.output.slice(0, 500);
                                    }
                                  })()}
                                </p>
                              )}
                              {output.serviceName && (
                                <p className="mt-2 text-xs text-gray-600">Service: {output.serviceName}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Sources */}
                      {run.sources.length > 0 && (
                        <div className="mt-4">
                          <p className="text-xs font-medium text-gray-400">Sources ({run.sources.length})</p>
                          <div className="mt-2 space-y-2">
                            {run.sources.map((source) => (
                              <div key={source.id} className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-gray-900/70 px-3 py-2 text-xs">
                                <Badge variant="outline" className="border-gray-700 bg-gray-800 text-[10px] text-gray-500">
                                  {source.sourceType}
                                </Badge>
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="truncate text-cyan-300 hover:underline"
                                >
                                  {source.title || source.url}
                                </a>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ── Order tracking timeline ── */}
        <section>
          <Card className="border-gray-800 bg-gray-900/90">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-white">
                <History className="h-4 w-4 text-emerald-300" />
                Order Lifecycle Timeline
              </CardTitle>
              <CardDescription className="text-gray-500">
                PLANNED → SUBMITTED → ... → terminal state.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-0">
                {ORDER_LIFECYCLE_STAGES.map((stage, idx) => {
                  const isPast = idx <= currentStageIdx;
                  const isCurrent = idx === currentStageIdx;
                  const isFuture = idx > currentStageIdx;
                  // Map stage to actual timestamp
                  const timestamp =
                    stage === 'PLANNED' ? detail.createdAt :
                    stage === 'SUBMITTED' ? detail.submittedAt :
                    stage === 'FILLED' ? detail.filledAt :
                    stage === 'CANCELLED' ? detail.cancelledAt :
                    stage === 'EXPIRED' ? detail.expiredAt :
                    stage === 'FAILED' ? (detail.filledAt || detail.submittedAt || detail.createdAt) :
                    stage === 'PARTIALLY_FILLED' ? (fills.length > 0 && !isFilled ? fills[fills.length - 1]?.fillTime : null) :
                    null;

                  return (
                    <div key={stage} className="flex gap-4">
                      {/* Timeline line + dot */}
                      <div className="relative flex flex-col items-center">
                        <div
                          className={cn(
                            'relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2',
                            isCurrent && 'border-emerald-500 bg-emerald-500/20 text-emerald-300',
                            isPast && !isCurrent && 'border-cyan-500/60 bg-cyan-500/10 text-cyan-300',
                            isFuture && 'border-gray-700 bg-gray-800 text-gray-500',
                          )}
                        >
                          {stageIcon(stage)}
                        </div>
                        {idx < ORDER_LIFECYCLE_STAGES.length - 1 && (
                          <div
                            className={cn(
                              'absolute top-8 h-[calc(100%+0.5rem)] w-0.5',
                              isPast && idx < currentStageIdx ? 'bg-cyan-500/50' : 'bg-gray-800',
                            )}
                          />
                        )}
                      </div>
                      {/* Stage label + timestamp */}
                      <div className="pb-6 pt-1">
                        <p
                          className={cn(
                            'text-sm font-medium',
                            isCurrent && 'text-emerald-300',
                            isPast && !isCurrent && 'text-cyan-300',
                            isFuture && 'text-gray-600',
                          )}
                        >
                          {stage.replace(/_/g, ' ')}
                        </p>
                        {timestamp && isPast && (
                          <p className="mt-1 text-xs text-gray-500">{formatDateTime(timestamp)}</p>
                        )}
                        {!timestamp && isPast && stage === 'PARTIALLY_FILLED' && fills.length > 0 && (
                          <p className="mt-1 text-xs text-gray-500">{fills.length} fill(s) recorded</p>
                        )}
                        {isFuture && (
                          <p className="mt-1 text-xs text-gray-700">Not yet reached</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* ── Audit logs ── */}
        <section>
          <Card className="border-gray-800 bg-gray-900/90">
            <CardHeader className="pb-4">
              <CardTitle className="flex items-center gap-2 text-white">
                <History className="h-4 w-4 text-gray-400" />
                Audit Trail
                <span className="text-xs font-normal text-gray-500">({auditLogs.length} entries)</span>
              </CardTitle>
              <CardDescription className="text-gray-500">
                System changes and lifecycle events for this order.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {auditLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-800 bg-gray-950/60 py-12">
                  <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                    <ScrollText className="h-6 w-6 text-gray-500" />
                  </div>
                  <p className="text-sm text-gray-400">No audit log entries yet</p>
                  <p className="mt-1 text-xs text-gray-600">Audit entries are created as the order progresses through its lifecycle.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {auditLogs.slice(0, 50).map((entry, index) => (
                    <div key={`${entry.id}-${index}`} className="rounded-2xl border border-gray-800 bg-gray-950/75 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-medium text-white">{entry.action}</p>
                          <p className="mt-1 text-sm text-gray-400">{entry.details || 'No details recorded.'}</p>
                          {entry.actor && (
                            <p className="mt-1 text-xs text-gray-600">Actor: {entry.actor}</p>
                          )}
                        </div>
                        <span className="text-xs text-gray-500">{formatDateTime(entry.createdAt)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
