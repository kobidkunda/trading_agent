'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
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
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  BarChart3,
  Target,
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Radio,
  CircleDot,
  Loader2,
  Bot,
  Eye,
  FlaskConical,
  FileText,
  ExternalLink,
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
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
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
import type { LiveActivityEvent, LiveMarketProgress, LivePipelineStage, TransparencySourceRef } from '@/lib/types';

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
  paperBetsResolved: number;
  paperBetAccuracy: number;
  lastActivity: string | null;
  currentStage: LivePipelineStage | null;
  currentStageStartedAt: string | null;
  currentMarketTitle: string | null;
  activityEvents: LiveActivityEvent[];
  marketProgress: LiveMarketProgress[];
  lastCompletedMarket: {
    marketId: string;
    marketTitle: string;
    completedAt: string;
  } | null;
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

// ── Agent pipeline config ─────────────────────────────────────────────────

const AGENT_STEPS = [
  { key: 'SCAN', label: 'Scan', icon: ScanSearch, color: 'text-blue-400' },
  { key: 'TRIAGE', label: 'Triage', icon: Filter, color: 'text-violet-400' },
  { key: 'DEERFLOW', label: 'DeerFlow', icon: BookOpen, color: 'text-amber-400' },
  { key: 'TRADINGAGENTS', label: 'TradingAgents', icon: Bot, color: 'text-sky-400' },
  { key: 'AGENT_REACH', label: 'Agent Reach', icon: Radio, color: 'text-fuchsia-400' },
  { key: 'SYNTHESIS', label: 'Synthesis', icon: Eye, color: 'text-indigo-400' },
  { key: 'JUDGE', label: 'Judge', icon: Scale, color: 'text-emerald-400' },
  { key: 'RISK', label: 'Risk', icon: ShieldAlert, color: 'text-red-400' },
  { key: 'DECISION', label: 'Decision', icon: Target, color: 'text-cyan-400' },
  { key: 'RESOLUTION_CHECK', label: 'Resolution', icon: CheckCircle2, color: 'text-gray-400' },
] as const;

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

function formatDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso) return '—';
  const start = new Date(startIso).getTime();
  const end = endIso ? new Date(endIso).getTime() : Date.now();
  const diff = Math.max(0, end - start);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function agentIndex(agent: string | null): number {
  if (!agent) return -1;
  const idx = AGENT_STEPS.findIndex((s) => s.key === agent);
  return idx;
}

function findActiveEvent(events: LiveActivityEvent[], currentStage: LivePipelineStage | null): LiveActivityEvent | null {
  if (!currentStage) return null;
  // Find the most recent event for the current stage that is not completed/failed/skipped
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.stage === currentStage && !['completed', 'failed', 'skipped'].includes(event.type)) {
      return event;
    }
  }
  return null;
}

function findStageStartTime(events: LiveActivityEvent[], currentStage: LivePipelineStage | null): string | null {
  if (!currentStage) return null;
  // Find the most recent 'started' event for the current stage
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.stage === currentStage && event.type === 'started') {
      return event.timestamp;
    }
  }
  return null;
}

function findStageEndTime(events: LiveActivityEvent[], currentStage: LivePipelineStage | null): string | null {
  if (!currentStage) return null;
  // Find the most recent terminal event for the current stage
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.stage === currentStage && (event.type === 'completed' || event.type === 'failed' || event.type === 'skipped')) {
      return event.timestamp;
    }
  }
  return null;
}

function SourceLinks({ references, maxLinks = 3 }: { references: TransparencySourceRef[] | undefined; maxLinks?: number }) {
  if (!references || references.length === 0) return null;
  const links = references.slice(0, maxLinks);
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {links.map((ref, idx) => (
        <a
          key={idx}
          href={ref.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded border border-gray-700 bg-gray-800/50 px-2 py-1 text-[10px] text-cyan-400 hover:bg-gray-700 hover:underline"
          title={ref.title}
        >
          <span className="truncate max-w-[120px]">{
            (() => {
              try {
                return ref.domain || new URL(ref.url).hostname;
              } catch {
                return ref.domain || 'Invalid URL';
              }
            })()
          }</span>
          <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      ))}
      {references.length > maxLinks && (
        <span className="inline-flex items-center px-2 py-1 text-[10px] text-gray-500">
          +{references.length - maxLinks} more
        </span>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function SimulationLab() {
  const router = useRouter();
  const [state, setState] = useState<SimState | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [scanInterval, setScanInterval] = useState(120);
  const [marketsPerScan, setMarketsPerScan] = useState(1);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applySimulationState = useCallback((data: SimState) => {
    setState(data);
    setScanInterval(data.config.scanIntervalSec);
    setMarketsPerScan(data.config.marketsPerScan);
  }, []);

  // ── Poll simulation state ──────────────────────────────────────────────
  const fetchState = useCallback(async () => {
    try {
      const res = await fetch('/api/simulation');
      if (res.ok) {
        const data = await res.json();
        applySimulationState(data);
      }
    } catch {
      // ignore
    }
  }, [applySimulationState]);

  const fetchRecentOrders = useCallback(async () => {
    try {
      const ordersRes = await fetch('/api/orders?limit=20');
      if (ordersRes.ok) {
        const data = await ordersRes.json();
        setRecentOrders(data.orders ?? []);
      }
    } catch {
      // ignore
    }
  }, []);

  // Initial load + auto-poll
  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void fetchState();
      void fetchRecentOrders();
    }, 0);
    pollRef.current = setInterval(() => {
      void fetchState();
    }, 2000);
    return () => {
      clearTimeout(initialLoad);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchRecentOrders, fetchState]);

  // Fetch recent orders when running
  useEffect(() => {
    if (!state || state.status !== 'RUNNING') return;
    const interval = setInterval(fetchRecentOrders, 3000);
    return () => clearInterval(interval);
  }, [fetchRecentOrders, state?.status]);

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
        applySimulationState(data);
        toast.success('Live Pipeline Started', {
          description: 'Real LLM agents will research, analyze, and trade — each cycle takes 2-10 minutes per market.',
        });
      }
    } catch {
      toast.error('Failed to start simulation');
    }
  }, [applySimulationState, scanInterval, marketsPerScan]);

  const handleStop = useCallback(async () => {
    try {
      const res = await fetch('/api/simulation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      if (res.ok) {
        const data = await res.json();
        applySimulationState(data);
        void fetchRecentOrders();
        toast.info('Simulation Stopped', {
          description: `Cycle ${data.currentCycle} completed. ${data.ordersPlaced} orders placed.`,
        });
      }
    } catch {
      toast.error('Failed to stop simulation');
    }
  }, [applySimulationState, fetchRecentOrders]);

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
        applySimulationState(data);
        toast.success('Simulation Reset');
      }
    } catch {
      toast.error('Failed to reset');
    }
  }, [applySimulationState, scanInterval, marketsPerScan]);

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
        applySimulationState(data);
        toast.success('Config updated');
      }
    } catch {
      toast.error('Failed to update config');
    }
  }, [applySimulationState, scanInterval, marketsPerScan]);

  const isRunning = state?.status === 'RUNNING';
  const activeIdx = agentIndex(state?.currentStage ?? null);
  const liveEvents = state?.activityEvents.slice(0, 12) ?? [];
  const recentMarketHistory = state?.marketProgress.slice(0, 6) ?? [];
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
                {state.currentStage ?? 'RUNNING'}:
                {' '}
                <span className="font-medium">{state.currentMarketTitle}</span>
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Stats Grid ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {[
          { label: 'Cycles', value: state?.currentCycle ?? 0, icon: Activity, color: 'text-purple-400', sub: isRunning ? 'Running now' : 'Not started' },
          { label: 'Scanned', value: state?.marketsScanned ?? 0, icon: ScanSearch, color: 'text-blue-400', sub: `${state?.marketsRelevant ?? 0} relevant` },
          { label: 'Buy Signals', value: state?.ordersPlaced ?? 0, icon: TrendingUp, color: 'text-emerald-400', sub: `${state?.ordersSkipped ?? 0} skipped` },
          { label: 'Exposure', value: formatCurrency(state?.totalExposure ?? 0), icon: DollarSign, color: 'text-cyan-400', sub: 'Total portfolio' },
          { label: 'Est. PnL', value: `$${(state?.totalEstimatedPnl ?? 0).toFixed(2)}`, icon: (state?.totalEstimatedPnl ?? 0) >= 0 ? TrendingUp : TrendingDown, color: (state?.totalEstimatedPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400', sub: 'Simulated' },
          { label: 'Prediction Accuracy', value: `${state?.paperBetAccuracy ?? 0}%`, icon: Target, color: 'text-purple-400', sub: `${state?.paperBetsResolved ?? 0} bets resolved` },
          { label: 'Win Rate', value: `${winRate}%`, icon: BarChart3, color: 'text-amber-400', sub: `${state?.ordersPlaced ?? 0} of ${((state?.ordersPlaced ?? 0) + (state?.ordersSkipped ?? 0))} passed risk` },
          { label: 'Bets Resolved', value: `${state?.paperBetsResolved ?? 0}`, icon: CheckCircle2, color: 'text-blue-400', sub: `${state?.paperBetAccuracy ?? 0}% accuracy` },
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
                  <Label className="text-sm text-gray-300">Cycle Interval</Label>
                  <span className="text-sm font-bold tabular-nums text-purple-400">{scanInterval >= 60 ? `${Math.floor(scanInterval/60)}m${scanInterval%60 ? `${scanInterval%60}s` : ''}` : `${scanInterval}s`}</span>
                </div>
                <Slider
                  value={[scanInterval]}
                  min={30}
                  max={600}
                  step={30}
                  onValueChange={([v]) => setScanInterval(v)}
                  className="py-1"
                />
                <div className="flex justify-between text-[11px] text-gray-600">
                  <span>30s (fast)</span>
                  <span>10m (thorough)</span>
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
                    <p>The system places <strong>paper bets</strong> (not real orders), then polls for market resolutions and scores predictions against actual outcomes. Accuracy % is tracked automatically.</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Right: Live Activity ── */}
        <div className="space-y-4 lg:col-span-2">
          <Card className="border-gray-800 bg-gray-900">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-white">
                <Loader2 className={cn('h-4 w-4', isRunning ? 'animate-spin text-emerald-400' : 'text-gray-500')} />
                Active Pipeline Stage
              </CardTitle>
              <CardDescription className="text-gray-500">
                Live simulation state is sourced directly from `/api/simulation`.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Current stage</p>
                    <p className="mt-2 text-lg font-semibold text-white">{state?.currentStage ?? 'Idle'}</p>
                    <p className="mt-1 text-sm text-gray-400">{state?.currentMarketTitle ?? 'No market in progress'}</p>
                  </div>
                  <Badge className={cn(
                    'text-[10px]',
                    isRunning
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-gray-700 bg-gray-800 text-gray-400',
                  )}>
                    {state?.status ?? 'STOPPED'}
                  </Badge>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] text-gray-500">Stage started</p>
                    <p className="mt-1 text-xs tabular-nums text-gray-300">{formatTime(state?.currentStageStartedAt ?? null)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-500">Last activity</p>
                    <p className="mt-1 text-xs tabular-nums text-gray-300">{formatRelative(state?.lastActivity ?? null)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] text-gray-500">Last completed market</p>
                    {state?.lastCompletedMarket && state.lastCompletedMarket.marketId !== 'resolution-cycle' ? (
                      <button
                        onClick={() => router.push(`/market/${state.lastCompletedMarket!.marketId}`)}
                        className="mt-1 text-xs text-cyan-400 hover:underline flex items-center gap-1"
                      >
                        {state.lastCompletedMarket.marketTitle}
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    ) : (
                      <p className="mt-1 text-xs text-gray-300">
                        {state?.lastCompletedMarket?.marketId === 'resolution-cycle' ? 'Resolution Check Cycle' : 'None yet'}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Live Stage Detail Cards */}
              {(() => {
                const activeEvent = findActiveEvent(state?.activityEvents ?? [], state?.currentStage ?? null);
                const stageStartedAt = findStageStartTime(state?.activityEvents ?? [], state?.currentStage ?? null);
                const stageEndedAt = findStageEndTime(state?.activityEvents ?? [], state?.currentStage ?? null);
                const isTerminal = activeEvent?.type === 'completed' || activeEvent?.type === 'failed' || activeEvent?.type === 'skipped';
                
                if (!activeEvent && !isRunning) return null;
                
                return (
                  <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-4">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500 mb-3">Current Stage Detail</p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div>
                        <p className="text-[11px] text-gray-500">Service</p>
                        <p className="text-sm text-white font-medium">{activeEvent?.serviceName || 'System'}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-gray-500">Model / Provider</p>
                        <p className="text-sm text-white">{activeEvent?.model || activeEvent?.provider || '—'}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-gray-500">Status</p>
                        <Badge className={cn(
                          'mt-0.5 text-[10px]',
                          activeEvent?.type === 'started' && 'border-blue-500/30 bg-blue-500/10 text-blue-400',
                          activeEvent?.type === 'progress' && 'border-violet-500/30 bg-violet-500/10 text-violet-400',
                          activeEvent?.type === 'completed' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
                          activeEvent?.type === 'skipped' && 'border-amber-500/30 bg-amber-500/10 text-amber-400',
                          activeEvent?.type === 'failed' && 'border-red-500/30 bg-red-500/10 text-red-400',
                          activeEvent?.type === 'timeout' && 'border-red-500/30 bg-red-500/10 text-red-400',
                          !activeEvent && 'border-gray-700 bg-gray-800 text-gray-400',
                        )}>
                          {activeEvent?.type || (isRunning ? 'running' : 'idle')}
                        </Badge>
                      </div>
                      <div>
                        <p className="text-[11px] text-gray-500">Started</p>
                        <p className="text-sm text-white">{stageStartedAt ? formatTime(stageStartedAt) : '—'}</p>
                      </div>
                      {isTerminal && stageEndedAt && (
                        <>
                          <div>
                            <p className="text-[11px] text-gray-500">Ended</p>
                            <p className="text-sm text-white">{formatTime(stageEndedAt)}</p>
                          </div>
                          <div>
                            <p className="text-[11px] text-gray-500">Duration</p>
                            <p className="text-sm text-white">{formatDuration(stageStartedAt, stageEndedAt)}</p>
                          </div>
                        </>
                      )}
                      {!isTerminal && stageStartedAt && (
                        <div>
                          <p className="text-[11px] text-gray-500">Elapsed</p>
                          <p className="text-sm text-white">{formatDuration(stageStartedAt, null)}</p>
                        </div>
                      )}
                      {activeEvent?.failureReason && (
                        <div className="sm:col-span-2 lg:col-span-4">
                          <p className="text-[11px] text-gray-500">Failure Reason</p>
                          <p className="text-sm text-red-400">{activeEvent.failureReason}</p>
                        </div>
                      )}
                      {activeEvent?.summary && (
                        <div className="sm:col-span-2 lg:col-span-4">
                          <p className="text-[11px] text-gray-500">Summary</p>
                          <p className="text-sm text-gray-300 line-clamp-3">{activeEvent.summary}</p>
                        </div>
                      )}
                    </div>
                    <SourceLinks references={activeEvent?.references} maxLinks={3} />
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          <Card className="border-gray-800 bg-gray-900">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-sm text-white">
                    <Eye className="h-4 w-4 text-gray-400" />
                    Live Activity
                  </CardTitle>
                  <CardDescription className="text-gray-500">
                    Recent stage events emitted by the live simulation pipeline.
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
              {liveEvents.length > 0 ? (
                <div className="max-h-[320px] overflow-y-auto divide-y divide-gray-800/50">
                  {liveEvents.map((event) => {
                    // Find timing context for this event
                    const eventStageStarted = findStageStartTime(
                      state?.activityEvents?.filter(e => e.marketId === event.marketId) ?? [],
                      event.stage
                    );
                    return (
                      <div key={`${event.timestamp}-${event.marketId}-${event.stage}-${event.type}`} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-800/30">
                        <Badge
                          className={cn(
                            'mt-0.5 text-[10px]',
                            event.type === 'started' && 'border-blue-500/30 bg-blue-500/10 text-blue-400',
                            event.type === 'progress' && 'border-violet-500/30 bg-violet-500/10 text-violet-400',
                            event.type === 'completed' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
                            event.type === 'skipped' && 'border-amber-500/30 bg-amber-500/10 text-amber-400',
                            event.type === 'failed' && 'border-red-500/30 bg-red-500/10 text-red-400',
                            event.type === 'timeout' && 'border-red-500/30 bg-red-500/10 text-red-400',
                          )}
                        >
                          {event.stage}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-gray-200">{event.message}</p>
                          {event.marketId !== 'resolution-cycle' ? (
                            <button
                              onClick={() => router.push(`/market/${event.marketId}`)}
                              className="mt-1 truncate text-[11px] text-cyan-400 hover:underline flex items-center gap-1"
                            >
                              {event.marketTitle}
                              <ExternalLink className="h-3 w-3" />
                            </button>
                          ) : (
                            <p className="mt-1 truncate text-[11px] text-gray-500">{event.marketTitle}</p>
                          )}
                          {/* Service/model/failure context */}
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
                            {event.serviceName && (
                              <span className="text-gray-400">Svc: {event.serviceName}</span>
                            )}
                            {event.model && (
                              <span className="text-gray-400">Model: {event.model}</span>
                            )}
                            {event.failureReason && (
                              <span className="text-red-400">Error: {event.failureReason}</span>
                            )}
                            {eventStageStarted && event.type !== 'started' && (
                              <span className="text-gray-500">
                                Duration: {formatDuration(eventStageStarted, event.timestamp)}
                              </span>
                            )}
                          </div>
                          {/* Source links */}
                          <SourceLinks references={event.references} maxLinks={3} />
                        </div>
                        <span className="shrink-0 text-[10px] tabular-nums text-gray-600">
                          {formatTime(event.timestamp)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16">
                  <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
                    <Activity className="h-7 w-7 text-gray-600" />
                  </div>
                  <p className="text-sm font-medium text-gray-400">No live activity yet</p>
                  <p className="mt-1 max-w-md text-center text-xs text-gray-600">
                    Start the simulation to stream stage-by-stage pipeline events for each market under evaluation.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-gray-800 bg-gray-900">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-white">
                <Clock className="h-4 w-4 text-gray-400" />
                Recent Market History
              </CardTitle>
              <CardDescription className="text-gray-500">
                Latest market-level pipeline progress with detailed stage records from simulation state.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {recentMarketHistory.length > 0 ? (
                recentMarketHistory.map((market) => {
                  // Get terminal events (completed/failed/skipped) for this market
                  const terminalEvents = market.history.filter(
                    (e) => e.type === 'completed' || e.type === 'failed' || e.type === 'skipped'
                  ).slice(-3); // Show up to 3 most recent terminal events

                  // Skip the resolution-cycle pseudo-market from history display
                  if (market.marketId === 'resolution-cycle') {
                    return null;
                  }

                  return (
                    <div key={market.marketId} className="rounded-lg border border-gray-800 bg-gray-800/30 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <button
                            onClick={() => router.push(`/market/${market.marketId}`)}
                            className="truncate text-sm font-medium text-cyan-400 hover:underline flex items-center gap-1"
                          >
                            {market.marketTitle}
                            <ExternalLink className="h-3 w-3" />
                          </button>
                          <p className="mt-1 text-xs text-gray-500">Current stage: {market.currentStage ?? 'Idle'}</p>
                        </div>
                        <Badge className={cn(
                          'text-[10px] capitalize',
                          market.status === 'completed' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
                          market.status === 'running' && 'border-blue-500/30 bg-blue-500/10 text-blue-400',
                          market.status === 'skipped' && 'border-amber-500/30 bg-amber-500/10 text-amber-400',
                          market.status === 'failed' && 'border-red-500/30 bg-red-500/10 text-red-400',
                        )}>
                          {market.status}
                        </Badge>
                      </div>

                      {/* Recent Stage Records */}
                      {terminalEvents.length > 0 && (
                        <div className="mt-3 space-y-2">
                          <p className="text-[10px] uppercase tracking-wider text-gray-600">Recent Stage Records</p>
                          {terminalEvents.map((event, idx) => (
                            <div key={idx} className="rounded border border-gray-800/50 bg-gray-800/20 p-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <Badge className={cn(
                                    'text-[9px]',
                                    event.type === 'completed' && 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
                                    event.type === 'skipped' && 'border-amber-500/30 bg-amber-500/10 text-amber-400',
                                    event.type === 'failed' && 'border-red-500/30 bg-red-500/10 text-red-400',
                                  )}>
                                    {event.stage}
                                  </Badge>
                                  <span className="text-[10px] text-gray-400">{event.type}</span>
                                </div>
                                <span className="text-[9px] tabular-nums text-gray-500">{formatTime(event.timestamp)}</span>
                              </div>
                              <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-gray-500">
                                {event.serviceName && <span>Svc: {event.serviceName}</span>}
                                {event.model && <span>Model: {event.model}</span>}
                              </div>
                              {event.failureReason && (
                                <p className="mt-1 text-[9px] text-red-400">{event.failureReason}</p>
                              )}
                              {event.summary && (
                                <p className="mt-1 text-[9px] text-gray-400 line-clamp-2">{event.summary}</p>
                              )}
                              <SourceLinks references={event.references} maxLinks={2} />
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
                        <span>{market.history.length} events total</span>
                        <span className="tabular-nums">Updated {formatRelative(market.lastUpdatedAt)}</span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-600">
                  <Clock className="mb-2 h-8 w-8 opacity-30" />
                  <p className="text-sm font-medium">No recent market history</p>
                  <p className="mt-1 text-xs">Processed markets will appear here as the live simulation advances.</p>
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
