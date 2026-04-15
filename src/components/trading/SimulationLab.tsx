'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Play,
  Square,
  Settings,
  Activity,
  ScanSearch,
  Filter,
  BookOpen,
  Scale,
  ShieldAlert,
  Zap,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  BarChart3,
  Target,
  ArrowRight,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Radio,
  CircleDot,
  Loader2,
  Bot,
  Eye,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { VENUE_OPTIONS, CATEGORY_OPTIONS } from '@/lib/constants';

// ── Types ──────────────────────────────────────────────────────────────────

interface SimState {
  status: 'STOPPED' | 'STARTING' | 'RUNNING' | 'STOPPING';
  startedAt: string | null;
  stoppedAt: string | null;
  currentCycle: number;
  marketsScanned: number;
  marketsRelevant: number;
  ordersPlaced: number;
  ordersSkipped: number;
  totalExposure: number;
  totalEstimatedPnl: number;
  lastActivity: string | null;
  currentAgent: string | null;
  currentMarketTitle: string | null;
  error: string | null;
  config: {
    venues: string[];
    categories: string[];
    scanIntervalSec: number;
    marketsPerScan: number;
    maxPortfolioExposure: number;
  };
}

interface RecentOrder {
  id: string;
  venueOrderId: string;
  side: string;
  price: number;
  size: number;
  filledSize: number;
  status: string;
  submittedAt: string;
  filledAt: string | null;
  market: { id: string; title: string } | null;
}

interface RecentJob {
  id: string;
  type: string;
  status: string;
  priority: number;
  payload: string | null;
  result: string | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

// ── Agent pipeline config ─────────────────────────────────────────────────

const AGENT_STEPS = [
  { key: 'SCANNER', label: 'Scanner', icon: ScanSearch, color: 'text-blue-400' },
  { key: 'TRIAGE', label: 'Triage', icon: Filter, color: 'text-violet-400' },
  { key: 'RESEARCH', label: 'Research', icon: BookOpen, color: 'text-amber-400' },
  { key: 'JUDGE', label: 'Judge', icon: Scale, color: 'text-emerald-400' },
  { key: 'RISK', label: 'Risk', icon: ShieldAlert, color: 'text-red-400' },
  { key: 'EXECUTOR', label: 'Executor', icon: Zap, color: 'text-cyan-400' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '--:--:--';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

function agentIndex(agent: string | null): number {
  if (!agent) return -1;
  const idx = AGENT_STEPS.findIndex((s) => s.key === agent);
  return idx;
}

// ── Component ──────────────────────────────────────────────────────────────

export function SimulationLab() {
  const [state, setState] = useState<SimState | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [scanInterval, setScanInterval] = useState(10);
  const [marketsPerScan, setMarketsPerScan] = useState(3);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Poll simulation state ──────────────────────────────────────────────
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/simulation');
      if (res.ok) {
        const data = await res.json();
        setState(data);
      }
    } catch {
      // ignore
    }
  }, []);

  // Poll recent orders
  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch('/api/simulation?action=run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketCount: 0 }),
      });
      // We use GET from the main API for data
      const dataRes = await fetch('/api/simulation');
      if (dataRes.ok) {
        const data = await dataRes.json();
        setState(data);
      }
    } catch {
      // ignore
    }
  }, []);

  // Initial load + auto-poll
  useEffect(() => {
    fetchState();
    pollRef.current = setInterval(fetchState, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchState]);

  // Fetch recent orders & jobs when running
  useEffect(() => {
    if (!state || state.status !== 'RUNNING') return;
    const interval = setInterval(async () => {
      try {
        const [ordersRes, jobsRes] = await Promise.all([
          fetch('/api/orders?limit=20'),
          fetch('/api/jobs?limit=30'),
        ]);
        if (ordersRes.ok) {
          const data = await ordersRes.json();
          setRecentOrders(data.orders ?? []);
        }
        if (jobsRes.ok) {
          const data = await jobsRes.json();
          setRecentJobs(data.jobs ?? []);
        }
      } catch {
        // ignore
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [state?.status]);

  // ── Actions ────────────────────────────────────────────────────────────

  const handleStart = useCallback(async () => {
    try {
      const res = await fetch('/api/simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          config: { scanIntervalSec: scanInterval, marketsPerScan },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setState(data);
        toast.success('Live Simulation Started', {
          description: 'System is now trading in dry-run mode — orders are simulated but recorded as real.',
        });
      }
    } catch {
      toast.error('Failed to start simulation');
    }
  }, [scanInterval, marketsPerScan]);

  const handleStop = useCallback(async () => {
    try {
      const res = await fetch('/api/simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      if (res.ok) {
        const data = await res.json();
        setState(data);
        toast.info('Simulation Stopped', {
          description: `Cycle ${data.currentCycle} completed. ${data.ordersPlaced} orders placed.`,
        });
      }
    } catch {
      toast.error('Failed to stop simulation');
    }
  }, []);

  const handleResetStats = useCallback(async () => {
    try {
      await fetch('/api/simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      await new Promise((r) => setTimeout(r, 500));
      const res = await fetch('/api/simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          config: { scanIntervalSec: scanInterval, marketsPerScan },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setState(data);
        toast.success('Simulation Reset');
      }
    } catch {
      toast.error('Failed to reset');
    }
  }, [scanInterval, marketsPerScan]);

  const handleConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'config',
          config: { scanIntervalSec: scanInterval, marketsPerScan },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setState(data);
        toast.success('Config updated');
      }
    } catch {
      toast.error('Failed to update config');
    }
  }, [scanInterval, marketsPerScan]);

  const isRunning = state?.status === 'RUNNING';
  const activeIdx = agentIndex(state?.currentAgent ?? null);
  const winRate = state && (state.ordersPlaced + state.ordersSkipped) > 0
    ? ((state.ordersPlaced / (state.ordersPlaced + state.ordersSkipped)) * 100).toFixed(1)
    : '0.0';

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-600/20">
              <FlaskConical className="h-4 w-4 text-purple-400" />
            </div>
            <h2 className="text-xl font-semibold text-white">Simulation Lab</h2>
            {isRunning && (
              <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px] animate-pulse">
                <CircleDot className="h-3 w-3" />
                LIVE
              </Badge>
            )}
            {state && state.status === 'STOPPED' && state.ordersPlaced > 0 && (
              <Badge className="gap-1 border-gray-500/30 bg-gray-500/10 text-gray-400 text-[10px]">
                <CheckCircle2 className="h-3 w-3" />
                Stopped
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Continuous dry-run — scans markets, runs agents, places simulated orders in real-time
          </p>
        </div>
        <div className="flex items-center gap-2">
          {state && state.status === 'STOPPED' && state.ordersPlaced > 0 && (
            <Button variant="ghost" size="sm" onClick={handleResetStats} className="text-gray-400 hover:text-white">
              <Radio className="mr-2 h-4 w-4" />
              Reset &amp; Restart
            </Button>
          )}
          {isRunning ? (
            <Button variant="destructive" size="sm" onClick={handleStop} className="gap-2">
              <Square className="h-4 w-4" />
              Stop Simulation
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleStart}
              className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Play className="h-4 w-4" />
              Start Live Simulation
            </Button>
          )}
        </div>
      </div>

      {/* ── Live Agent Pipeline ── */}
      <Card className={cn(
        'border-gray-800 bg-gray-900',
        isRunning && 'border-emerald-500/20 shadow-sm shadow-emerald-500/5',
      )}>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
            ) : (
              <Activity className="h-4 w-4 text-gray-500" />
            )}
            <span className="text-sm font-medium text-white">Agent Pipeline</span>
            {isRunning && (
              <span className="text-xs text-emerald-400 ml-auto">
                Cycle #{state?.currentCycle}
              </span>
            )}
            {!isRunning && (
              <span className="text-xs text-gray-600 ml-auto">Idle</span>
            )}
          </div>

          {/* Agent steps */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {AGENT_STEPS.map((step, idx) => {
              const isActive = activeIdx === idx;
              const isDone = activeIdx > idx && isRunning;
              const Icon = step.icon;

              return (
                <div key={step.key} className="flex items-center">
                  <div
                    className={cn(
                      'flex min-w-[80px] flex-col items-center gap-1 rounded-lg border px-3 py-2.5 transition-all sm:min-w-[95px]',
                      isActive
                        ? 'border-emerald-500/50 bg-emerald-500/10 shadow-sm shadow-emerald-500/10'
                        : isDone
                          ? 'border-emerald-500/20 bg-emerald-500/5'
                          : 'border-gray-800 bg-gray-800/40',
                    )}
                  >
                    <div className="relative">
                      <Icon
                        className={cn(
                          'h-4 w-4 transition-colors',
                          isActive ? 'text-emerald-400' : isDone ? 'text-emerald-400/60' : 'text-gray-600',
                        )}
                      />
                      {isActive && (
                        <span className="absolute -right-1 -top-1 h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
                      )}
                    </div>
                    <span className={cn(
                      'text-[10px] font-medium',
                      isActive ? 'text-emerald-300' : isDone ? 'text-emerald-300/50' : 'text-gray-600',
                    )}>
                      {step.label}
                    </span>
                  </div>
                  {idx < AGENT_STEPS.length - 1 && (
                    <ArrowRight className={cn(
                      'mx-0.5 h-3 w-3 shrink-0',
                      isDone || isActive ? 'text-emerald-500/50' : 'text-gray-700',
                    )} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Currently processing */}
          {isRunning && state?.currentMarketTitle && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
              <Bot className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
              <span className="text-[11px] text-emerald-300 truncate flex-1">
                {state.currentAgent}:
                {' '}
                <span className="font-medium">{state.currentMarketTitle}</span>
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Stats Grid ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6">
        {[
          { label: 'Cycles', value: state?.currentCycle ?? 0, icon: Activity, color: 'text-purple-400', sub: isRunning ? 'Running now' : 'Not started' },
          { label: 'Scanned', value: state?.marketsScanned ?? 0, icon: ScanSearch, color: 'text-blue-400', sub: `${state?.marketsRelevant ?? 0} relevant` },
          { label: 'Buy Signals', value: state?.ordersPlaced ?? 0, icon: TrendingUp, color: 'text-emerald-400', sub: `${state?.ordersSkipped ?? 0} skipped` },
          { label: 'Exposure', value: formatCurrency(state?.totalExposure ?? 0), icon: DollarSign, color: 'text-cyan-400', sub: 'Total portfolio' },
          { label: 'Est. PnL', value: `$${(state?.totalEstimatedPnl ?? 0).toFixed(2)}`, icon: (state?.totalEstimatedPnl ?? 0) >= 0 ? TrendingUp : TrendingDown, color: (state?.totalEstimatedPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400', sub: 'Simulated' },
          { label: 'Win Rate', value: `${winRate}%`, icon: BarChart3, color: 'text-amber-400', sub: `${state?.ordersPlaced ?? 0} of ${((state?.ordersPlaced ?? 0) + (state?.ordersSkipped ?? 0))} passed risk` },
        ].map((s) => (
          <Card key={s.label} className="border-gray-800 bg-gray-900">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <s.icon className={cn('h-3.5 w-3.5', s.color)} />
                <span className="text-lg font-bold tabular-nums text-white">{s.value}</span>
              </div>
              <p className="mt-1 text-[11px] font-medium text-gray-400">{s.label}</p>
              <p className="text-[10px] text-gray-600">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left: Config Panel ── */}
        <div className="space-y-4 lg:col-span-1">
          <Card className="border-gray-800 bg-gray-900">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-white">
                <Settings className="h-4 w-4 text-gray-400" />
                Configuration
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Scan interval */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-gray-300">Scan Interval</Label>
                  <span className="text-sm font-bold tabular-nums text-purple-400">{scanInterval}s</span>
                </div>
                <Slider
                  value={[scanInterval]}
                  min={3}
                  max={60}
                  step={1}
                  onValueChange={([v]) => setScanInterval(v)}
                  className="py-1"
                />
                <div className="flex justify-between text-[11px] text-gray-600">
                  <span>3s (fast)</span>
                  <span>60s (slow)</span>
                </div>
              </div>

              <Separator className="bg-gray-800" />

              {/* Markets per scan */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-gray-300">Markets Per Cycle</Label>
                  <span className="text-sm font-bold tabular-nums text-purple-400">{marketsPerScan}</span>
                </div>
                <Slider
                  value={[marketsPerScan]}
                  min={1}
                  max={10}
                  step={1}
                  onValueChange={([v]) => setMarketsPerScan(v)}
                  className="py-1"
                />
                <div className="flex justify-between text-[11px] text-gray-600">
                  <span>1</span>
                  <span>10</span>
                </div>
              </div>

              <Separator className="bg-gray-800" />

              {/* Apply config */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleConfig}
                className="w-full border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
              >
                Apply Config
              </Button>

              <Separator className="bg-gray-800" />

              {/* System info */}
              <div className="space-y-2">
                <Label className="text-sm text-gray-300">System Info</Label>
                <div className="rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-[11px] text-gray-500">Uptime</span>
                    <span className="text-[11px] text-gray-300 tabular-nums">
                      {state?.startedAt ? formatRelative(state.startedAt) : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[11px] text-gray-500">Last Activity</span>
                    <span className="text-[11px] text-gray-300 tabular-nums">
                      {state?.lastActivity ? formatRelative(state.lastActivity) : 'N/A'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[11px] text-gray-500">Status</span>
                    <span className={cn(
                      'text-[11px] font-medium',
                      isRunning ? 'text-emerald-400' : 'text-gray-400',
                    )}>
                      {state?.status ?? 'STOPPED'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Warning */}
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                  <div className="text-[11px] text-amber-400/80 space-y-0.5">
                    <p className="font-medium">Dry-Run Mode Active</p>
                    <p>The system will process markets, run all agents, and execute trades. Orders are <strong>simulated</strong> but recorded in the database exactly like real trades.</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Right: Live Activity ── */}
        <div className="space-y-4 lg:col-span-2">
          {/* Agent Activity Feed */}
          <Card className="border-gray-800 bg-gray-900">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm text-white">
                    <Eye className="h-4 w-4 text-gray-400" />
                    Live Agent Activity
                  </CardTitle>
                  <CardDescription className="text-gray-500">
                    Most recent jobs from the agent pipeline
                  </CardDescription>
                </div>
                {isRunning && (
                  <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px] animate-pulse">
                    <CircleDot className="h-3 w-3" />
                    Streaming
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {recentJobs.length > 0 ? (
                <div className="max-h-[400px] overflow-y-auto divide-y divide-gray-800/50">
                  {recentJobs.map((job) => (
                    <div key={job.id} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-gray-800/30">
                      <Badge
                        className={cn(
                          'text-[10px]',
                          job.type === 'SCAN' && 'border-blue-500/30 bg-blue-500/10 text-blue-400',
                          job.type === 'TRIAGE' && 'border-violet-500/30 bg-violet-500/10 text-violet-400',
                          job.type === 'RESEARCH' && 'border-amber-500/30 bg-amber-500/10 text-amber-400',
                          job.type === 'JUDGE' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
                          job.type === 'RISK' && 'border-red-500/30 bg-red-500/10 text-red-400',
                          job.type === 'EXECUTE' && 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
                        )}
                      >
                        {job.type}
                      </Badge>
                      {(() => {
                        const payload = job.payload ? (() => { try { return JSON.parse(job.payload); } catch { return {}; } })() : {};
                        return (
                          <p className="flex-1 truncate text-xs text-gray-300">
                            {payload.marketTitle || payload.title || job.id.slice(0, 8)}
                          </p>
                        );
                      })()}
                      <span className="text-[10px] text-gray-600 tabular-nums shrink-0">
                        {formatRelative(job.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
                    <Bot className="h-7 w-7 text-gray-600" />
                  </div>
                  <p className="text-sm font-medium text-gray-400">No agent activity yet</p>
                  <p className="mt-1 max-w-md text-center text-xs text-gray-600">
                    Click &quot;Start Live Simulation&quot; to begin continuous market processing. Agents will scan, triage, research, judge, risk-check, and simulate order execution in real-time.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Orders */}
          <Card className="border-gray-800 bg-gray-900">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-white">
                <Target className="h-4 w-4 text-gray-400" />
                Simulated Orders
              </CardTitle>
              <CardDescription className="text-gray-500">
                {recentOrders.length > 0 ? `${recentOrders.length} orders recorded` : 'No orders yet'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {recentOrders.length > 0 ? (
                <div className="max-h-[400px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-gray-800 hover:bg-transparent">
                        <TableHead className="text-gray-500">Market</TableHead>
                        <TableHead className="text-gray-500">Side</TableHead>
                        <TableHead className="text-right text-gray-500">Price</TableHead>
                        <TableHead className="text-right text-gray-500">Size</TableHead>
                        <TableHead className="text-right text-gray-500">Time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentOrders.map((order) => (
                        <TableRow
                          key={order.id}
                          className="cursor-pointer border-gray-800 transition-colors hover:bg-gray-800/50"
                          onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}
                        >
                          <TableCell>
                            <p className="max-w-[200px] truncate text-xs text-gray-300">
                              {order.market?.title || order.venueOrderId}
                            </p>
                          </TableCell>
                          <TableCell>
                            <Badge className={cn(
                              'text-[10px]',
                              order.side === 'YES'
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                : 'border-red-500/30 bg-red-500/10 text-red-400',
                            )}>
                              {order.side}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs tabular-nums text-gray-300">
                              {(order.price * 100).toFixed(1)}c
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs tabular-nums text-gray-300">
                              {formatCurrency(order.size)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-[10px] tabular-nums text-gray-500">
                              {formatTime(order.filledAt || order.submittedAt)}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-600">
                  <Clock className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm font-medium">No orders yet</p>
                  <p className="text-xs mt-1">Orders will appear here as the simulation runs</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
