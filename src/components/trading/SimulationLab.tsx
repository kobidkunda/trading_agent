'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  FlaskConical,
  Gauge,
  Landmark,
  Loader2,
  Play,
  Radio,
  Scale,
  ShieldAlert,
  Sparkles,
  Square,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useTradingStore } from '@/store/trading-store';
import { getSimulationAccess } from '@/lib/engine/simulation-access';
import { syncTradingModeFromBackend } from '@/lib/engine/trading-mode-client';
import { PaginationBar } from '@/components/trading/PaginationBar';
import type {
  OperatorAttempt,
  OperatorDashboardPayload,
  OperatorMarketItem,
} from '@/lib/engine/operator-dashboard-view-model';

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatPercent(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${(value * 100).toFixed(1)}%`;
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
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function modeTone(mode: 'DEMO' | 'PAPER' | 'LIVE'): string {
  if (mode === 'DEMO') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (mode === 'LIVE') return 'border-red-500/30 bg-red-500/10 text-red-300';
  return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
}

function executionTone(mode: 'SIMULATED' | 'REAL'): string {
  return mode === 'REAL'
    ? 'border-red-500/30 bg-red-500/10 text-red-300'
    : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300';
}

function resultTone(result: string): string {
  if (result === 'WON') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
  if (result === 'LOST' || result === 'FAILED') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (result === 'CANCELLED' || result === 'EXPIRED') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  return 'border-gray-700 bg-gray-800/70 text-gray-300';
}

function statusTone(status: string): string {
  if (['SUBMITTED', 'PARTIAL', 'PLANNED'].includes(status)) return 'text-cyan-300';
  if (['PENDING', 'WATCH'].includes(status)) return 'text-amber-300';
  if (status === 'RESOLVED') return 'text-emerald-300';
  return 'text-gray-300';
}

function stageTone(stage: string): string {
  if (stage.includes('RISK')) return 'text-red-300';
  if (stage.includes('JUDGE')) return 'text-emerald-300';
  if (stage.includes('TRIAGE')) return 'text-violet-300';
  if (stage.includes('SCAN')) return 'text-sky-300';
  if (stage.includes('RESEARCH') || stage.includes('DEERFLOW') || stage.includes('AGENT')) return 'text-amber-300';
  return 'text-gray-300';
}

function summaryCards(data: OperatorDashboardPayload['summary']) {
  return [
    { label: 'Currently Playing', value: data.currentlyPlaying, icon: Radio, accent: 'text-cyan-300', compact: false },
    { label: 'Open Bets', value: String(data.openBets), icon: TrendingUp, accent: 'text-emerald-300', compact: true },
    { label: 'Pending Decisions', value: String(data.pendingDecisions), icon: Clock, accent: 'text-amber-300', compact: true },
    { label: 'Wins', value: String(data.wins), icon: Target, accent: 'text-emerald-300', compact: true },
    { label: 'Losses', value: String(data.losses), icon: TrendingDown, accent: 'text-red-300', compact: true },
    { label: 'Resolved Today', value: String(data.resolvedToday), icon: Sparkles, accent: 'text-sky-300', compact: true },
    { label: 'Exposure', value: formatCurrency(data.exposure), icon: Landmark, accent: 'text-violet-300', compact: true },
    { label: 'Pipeline Alerts', value: String(data.pipelineAlerts), icon: AlertTriangle, accent: 'text-red-300', compact: true },
  ];
}

function FocusNarrativeCard({
  title,
  copy,
  icon: Icon,
  tone,
}: {
  title: string;
  copy: string | null;
  icon: React.ElementType;
  tone: string;
}) {
  return (
    <Card className="border-gray-800 bg-gray-900/85">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm text-white">
          <Icon className={cn('h-4 w-4', tone)} />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm leading-6 text-gray-300">
          {copy || 'No structured narrative available for this stage yet.'}
        </p>
      </CardContent>
    </Card>
  );
}

function AttemptRow({
  attempt,
  active,
}: {
  attempt: OperatorAttempt;
  active: boolean;
}) {
  return (
    <div
      className={cn(
        'grid gap-3 rounded-2xl border px-4 py-3 text-sm md:grid-cols-[1.2fr_0.6fr_0.7fr_0.8fr_0.9fr_0.9fr_0.9fr_1fr]',
        active ? 'border-cyan-500/30 bg-cyan-500/8' : 'border-gray-800 bg-gray-900/65',
      )}
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-white">{attempt.label}</span>
          <Badge className={cn('text-[10px]', modeTone(attempt.mode))}>{attempt.mode}</Badge>
          <Badge className={cn('text-[10px]', executionTone(attempt.executionMode))}>{attempt.executionMode}</Badge>
        </div>
        <p className="text-xs text-gray-400">{attempt.rationale || 'No rationale captured yet.'}</p>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Placed</p>
        <p className="mt-1 text-sm text-gray-200">{formatDateTime(attempt.placedAt)}</p>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Side</p>
        <p className="mt-1 text-sm text-gray-200">{attempt.side || '—'}</p>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Price</p>
        <p className="mt-1 text-sm text-gray-200">{attempt.price != null ? formatPercent(attempt.price) : '—'}</p>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Size</p>
        <p className="mt-1 text-sm text-gray-200">{attempt.size != null ? formatCurrency(attempt.size) : '—'}</p>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Fill</p>
        <p className={cn('mt-1 text-sm', statusTone(attempt.fillStatus))}>{attempt.fillStatus}</p>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Status</p>
        <p className={cn('mt-1 text-sm', statusTone(attempt.status))}>{attempt.status}</p>
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Outcome</p>
        <div className="mt-1 flex items-center gap-2">
          <Badge className={cn('text-[10px]', resultTone(attempt.result))}>{attempt.outcomeLabel}</Badge>
        </div>
      </div>
    </div>
  );
}

export function SimulationLab() {
  const router = useRouter();
  const { tradingMode } = useTradingStore();
  const [dashboard, setDashboard] = useState<OperatorDashboardPayload | null>(null);
  const [scanInterval, setScanInterval] = useState(120);
  const [marketsPerScan, setMarketsPerScan] = useState(1);
  const [expandedMarkets, setExpandedMarkets] = useState<string[]>([]);
  const [ledgerPage, setLedgerPage] = useState(1);
  const [ledgerLimit, setLedgerLimit] = useState(25);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalLedgerMarkets = dashboard?.markets?.length ?? 0;
  const totalLedgerPages = Math.ceil(totalLedgerMarkets / ledgerLimit);
  const paginatedMarkets = (dashboard?.markets ?? []).slice(
    (ledgerPage - 1) * ledgerLimit,
    ledgerPage * ledgerLimit,
  );

  const fetchDashboard = useCallback(async () => {
    try {
      const response = await fetch('/api/trading/operator?limit=80', { cache: 'no-store' });
      if (!response.ok) return;
      const payload = (await response.json()) as OperatorDashboardPayload;
      setDashboard(payload);
      setScanInterval(payload.simulation.config.scanIntervalSec);
      setMarketsPerScan(payload.simulation.config.marketsPerScan);
    } catch {
      // keep existing state during transient failures
    }
  }, []);

  useEffect(() => {
    const initialLoad = setTimeout(() => {
      void fetchDashboard();
    }, 0);
    pollRef.current = setInterval(() => {
      void fetchDashboard();
    }, 3000);

    return () => {
      clearTimeout(initialLoad);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchDashboard]);

  const handleStart = useCallback(async () => {
    try {
      await syncTradingModeFromBackend();
    } catch {
      // keep local mode if backend sync is briefly unavailable
    }

    let currentMode = useTradingStore.getState().tradingMode;

    // LIVE mode is blocked for simulation — switch to DEMO as fallback
    if (currentMode === 'LIVE') {
      const modeResponse = await fetch('/api/trading/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'DEMO' }),
      });

      if (!modeResponse.ok) {
        const errorPayload = await modeResponse.json().catch(() => null);
        toast.error(errorPayload?.error || 'Failed to switch to DEMO mode');
        return;
      }

      await syncTradingModeFromBackend().catch(() => {
        useTradingStore.getState().setTradingMode('DEMO');
      });
      currentMode = useTradingStore.getState().tradingMode;
    }

    const access = getSimulationAccess(currentMode);
    if (!access.allowed) {
      toast.error(access.reason || 'Simulation unavailable in this mode');
      return;
    }

    const response = await fetch('/api/simulation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'start',
        config: { scanIntervalSec: scanInterval, marketsPerScan },
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      toast.error(errorPayload?.error || 'Failed to start simulation');
      return;
    }

    const label = currentMode === 'PAPER' ? 'Paper' : 'Demo';
    toast.success(`${label} simulation started`);
    void fetchDashboard();
  }, [fetchDashboard, marketsPerScan, scanInterval]);

  const handleStop = useCallback(async () => {
    const response = await fetch('/api/simulation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'stop' }),
    });

    if (!response.ok) {
      toast.error('Failed to stop simulation');
      return;
    }

    toast.info('Simulation stopped');
    void fetchDashboard();
  }, [fetchDashboard]);

  const handleConfig = useCallback(async () => {
    const response = await fetch('/api/simulation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'config',
        config: { scanIntervalSec: scanInterval, marketsPerScan },
      }),
    });

    if (!response.ok) {
      toast.error('Failed to update config');
      return;
    }

    toast.success('Operator loop config updated');
    void fetchDashboard();
  }, [fetchDashboard, marketsPerScan, scanInterval]);

  if (!dashboard) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-gray-900/80 px-5 py-4 text-sm text-gray-300">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
          Loading operator dashboard
        </div>
      </div>
    );
  }

  const simulationAccess = getSimulationAccess(tradingMode);
  const isRunning = dashboard.simulation.status === 'RUNNING';
  const focus = dashboard.focus;
  const focusMarket = dashboard.markets.find((market) => market.marketId === focus.marketId) ?? dashboard.markets[0];
  const cards = summaryCards(dashboard.summary);

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-[28px] border border-gray-800 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_30%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.14),transparent_35%),linear-gradient(180deg,rgba(17,24,39,0.98),rgba(3,7,18,0.98))]">
        <div className="flex flex-col gap-6 p-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10">
                <FlaskConical className="h-5 w-5 text-cyan-300" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-2xl font-semibold tracking-tight text-white">Operator Dashboard</h2>
                  <Badge className={cn('text-[10px]', modeTone(dashboard.mode))}>{dashboard.mode}</Badge>
                  <Badge className={cn('text-[10px]', isRunning ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-gray-700 bg-gray-800/80 text-gray-300')}>
                    {dashboard.simulation.status}
                  </Badge>
                </div>
                <p className="mt-1 max-w-3xl text-sm text-gray-400">
                  One operator surface for DEMO, PAPER, and LIVE. Markets stay deduped, attempts stay inspectable, and the current bet remains visible after refresh.
                </p>
              </div>
            </div>
            {!simulationAccess.allowed && (
              <div className="flex max-w-3xl items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{simulationAccess.reason} Starting from here will switch the app to DEMO first, then launch the simulated loop.</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-gray-800 bg-gray-950/70 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.22em] text-gray-500">Focus stage</p>
              <p className={cn('mt-1 text-sm font-medium', stageTone(focus.stage))}>{focus.stage}</p>
            </div>
            {isRunning ? (
              <Button size="sm" variant="destructive" className="gap-2" onClick={handleStop}>
                <Square className="h-4 w-4" />
                Stop Simulation
              </Button>
            ) : (
              <Button size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500" onClick={handleStart}>
                <Play className="h-4 w-4" />
                {simulationAccess.allowed
                  ? tradingMode === 'PAPER'
                    ? 'Start Paper Simulation'
                    : 'Start Demo Simulation'
                  : 'Switch to DEMO & Start'}
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card
            key={card.label}
            className={cn(
              'border-gray-800 bg-gray-900/90',
              !card.compact && 'md:col-span-2 xl:col-span-1',
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">{card.label}</p>
                  <p className={cn('mt-2 truncate text-lg font-semibold', card.accent)}>{card.value}</p>
                </div>
                <card.icon className={cn('mt-0.5 h-4 w-4 shrink-0', card.accent)} />
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <Card className="border-gray-800 bg-gray-900/90">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-white">
                  <Radio className={cn('h-4 w-4', isRunning ? 'text-emerald-300' : 'text-gray-500')} />
                  Live Ops Rail
                </CardTitle>
                <CardDescription className="text-gray-500">
                  Current market, current attempt, and the narrative driving the next action.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-gray-700 text-gray-200 hover:bg-gray-800"
                onClick={() => focus.marketId && router.push(`/market/${focus.marketId}`)}
                disabled={!focus.marketId}
              >
                <Eye className="h-4 w-4" />
                Open Detail
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 rounded-[24px] border border-gray-800 bg-gray-950/75 p-5 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={cn('text-[10px]', modeTone(focus.mode))}>{focus.mode}</Badge>
                  <Badge className={cn('text-[10px]', executionTone(focus.executionType))}>{focus.executionType}</Badge>
                  <Badge className="border-gray-700 bg-gray-800/80 text-[10px] text-gray-200">{focus.status}</Badge>
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Focus market</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">{focus.title}</h3>
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-gray-400">
                    <span className="flex items-center gap-2">
                      <Landmark className="h-4 w-4 text-cyan-300" />
                      {focus.venue || 'Unknown venue'}
                    </span>
                    <span className="flex items-center gap-2">
                      <Gauge className={cn('h-4 w-4', stageTone(focus.stage))} />
                      {focus.stage}
                    </span>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Started</p>
                    <p className="mt-1 text-sm text-gray-200">{formatDateTime(focus.startedAt)}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Last update</p>
                    <p className="mt-1 text-sm text-gray-200">{formatRelative(focus.lastUpdatedAt)}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Next action</p>
                    <p className="mt-1 text-sm text-gray-200">{focus.nextAction}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-gray-800 bg-gradient-to-b from-gray-900 to-gray-950 p-4">
                <p className="text-[11px] uppercase tracking-[0.22em] text-gray-500">Loop controls</p>
                <div className="mt-4 space-y-5">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-gray-300">Cycle interval</Label>
                      <span className="text-sm font-medium text-cyan-300">{scanInterval}s</span>
                    </div>
                    <Slider value={[scanInterval]} min={30} max={600} step={30} onValueChange={([value]) => setScanInterval(value)} />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-sm text-gray-300">Markets per cycle</Label>
                      <span className="text-sm font-medium text-cyan-300">{marketsPerScan}</span>
                    </div>
                    <Slider value={[marketsPerScan]} min={1} max={10} step={1} onValueChange={([value]) => setMarketsPerScan(value)} />
                  </div>
                  <Separator className="bg-gray-800" />
                  <Button variant="outline" className="w-full border-gray-700 text-gray-100 hover:bg-gray-800" onClick={handleConfig}>
                    Apply Operator Config
                  </Button>
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/80 p-3 text-xs text-gray-400">
                    <p className="font-medium text-gray-200">System pulse</p>
                    <p className="mt-1">Cycle {dashboard.simulation.currentCycle} • Last activity {formatRelative(dashboard.simulation.lastActivity)}</p>
                    {dashboard.simulation.error && (
                      <p className="mt-2 text-red-300">Loop error: {dashboard.simulation.error}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <FocusNarrativeCard title="Bull Thesis" copy={focus.bullThesis} icon={TrendingUp} tone="text-emerald-300" />
              <FocusNarrativeCard title="Bear Thesis" copy={focus.bearThesis} icon={TrendingDown} tone="text-red-300" />
              <FocusNarrativeCard title="Judge Conclusion" copy={focus.judgeConclusion} icon={Scale} tone="text-cyan-300" />
              <FocusNarrativeCard title="Risk Decision" copy={focus.riskDecision} icon={ShieldAlert} tone="text-amber-300" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-gray-800 bg-gray-900/90">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-white">
              <Activity className="h-4 w-4 text-violet-300" />
              Focus Snapshot
            </CardTitle>
            <CardDescription className="text-gray-500">
              Quick operator read on the market currently at the top of the stack.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {focusMarket ? (
              <>
                <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/8 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-200/70">Current bet</p>
                  <p className="mt-2 text-base font-semibold text-white">{focusMarket.title}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge className={cn('text-[10px]', resultTone(focusMarket.winLoss))}>{focusMarket.latestOutcome}</Badge>
                    <Badge className="border-gray-700 bg-gray-800 text-[10px] text-gray-200">{focusMarket.latestAttemptStatus}</Badge>
                    <Badge className={cn('text-[10px]', executionTone(focusMarket.executionType))}>{focusMarket.executionType}</Badge>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Venue</p>
                    <p className="mt-1 text-sm text-gray-200">{focusMarket.venue}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Lifecycle</p>
                    <p className={cn('mt-1 text-sm', statusTone(focusMarket.latestAttemptStatus))}>{focusMarket.latestAttemptStatus}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Implied price</p>
                    <p className="mt-1 text-sm text-gray-200">{formatPercent(focusMarket.impliedProb)}</p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-950/80 p-3">
                    <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Last activity</p>
                    <p className="mt-1 text-sm text-gray-200">{formatRelative(focusMarket.lastActivityAt)}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="w-full gap-2 border-gray-700 text-gray-100 hover:bg-gray-800"
                  onClick={() => router.push(`/market/${focusMarket.marketId}`)}
                >
                  <ExternalLink className="h-4 w-4" />
                  Open Market Audit Page
                </Button>
              </>
            ) : (
              <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-6 text-sm text-gray-400">
                No focus market available yet.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <Card className="border-gray-800 bg-gray-900/90">
          <CardHeader className="pb-4">
            <CardTitle className="text-white">Canonical Trades Ledger</CardTitle>
            <CardDescription className="text-gray-500">
              One row per market. Expand to inspect each simulated or real attempt with exact times, venue, status, and result.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {totalLedgerMarkets === 0 ? (
              <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-10 text-center text-sm text-gray-400">
                No markets have been scanned into the operator ledger yet.
              </div>
            ) : (
              paginatedMarkets.map((market: OperatorMarketItem) => {
                const expanded = expandedMarkets.includes(market.marketId);
                return (
                  <div key={market.marketId} className="rounded-[26px] border border-gray-800 bg-gray-950/60">
                    <div
                      className={cn(
                        'grid gap-3 rounded-[26px] px-4 py-4 md:grid-cols-[1fr_auto]',
                        market.isActive ? 'bg-cyan-500/8' : '',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedMarkets((current) =>
                            current.includes(market.marketId)
                              ? current.filter((id) => id !== market.marketId)
                              : [...current, market.marketId]
                          )
                        }
                        className={cn(
                          'grid gap-4 rounded-[20px] text-left transition-colors md:grid-cols-[26px_1.4fr_0.6fr_0.7fr_0.7fr_0.7fr_0.8fr]',
                          market.isActive ? 'hover:bg-cyan-500/5' : 'hover:bg-gray-900/70',
                        )}
                      >
                        <div className="flex items-center justify-center">
                          {expanded ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-medium text-white">{market.title}</span>
                            {market.isActive && (
                              <Badge className="border-cyan-500/30 bg-cyan-500/10 text-[10px] text-cyan-200">ACTIVE</Badge>
                            )}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                            <span>{market.venue}</span>
                            <span>•</span>
                            <span>{market.category}</span>
                            <span>•</span>
                            <span>{market.pipelineStage}</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Decision</p>
                          <p className="mt-1 text-sm text-gray-200">{market.latestDecision}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Attempt</p>
                          <p className={cn('mt-1 text-sm', statusTone(market.latestAttemptStatus))}>{market.latestAttemptStatus}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Outcome</p>
                          <Badge className={cn('mt-1 text-[10px]', resultTone(market.winLoss))}>{market.latestOutcome}</Badge>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Attempts</p>
                          <p className="mt-1 text-sm text-gray-200">{market.attemptCount}</p>
                        </div>
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Last activity</p>
                          <p className="mt-1 text-sm text-gray-200">{formatRelative(market.lastActivityAt)}</p>
                        </div>
                      </button>
                      <div className="flex items-center justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="gap-2 text-cyan-300 hover:bg-cyan-500/10 hover:text-cyan-200"
                          onClick={() => {
                            router.push(`/market/${market.marketId}`);
                          }}
                        >
                          Open
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {expanded && (
                      <div className="space-y-3 border-t border-gray-800 px-4 py-4">
                        <div className="grid gap-4 lg:grid-cols-4">
                          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-3">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Bull</p>
                            <p className="mt-2 text-sm text-gray-300">{market.bullThesis || 'No bull thesis captured yet.'}</p>
                          </div>
                          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-3">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Bear</p>
                            <p className="mt-2 text-sm text-gray-300">{market.bearThesis || 'No bear thesis captured yet.'}</p>
                          </div>
                          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-3">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Judge</p>
                            <p className="mt-2 text-sm text-gray-300">{market.judgeConclusion || 'No judge conclusion captured yet.'}</p>
                          </div>
                          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-3">
                            <p className="text-[11px] uppercase tracking-[0.18em] text-gray-500">Risk</p>
                            <p className="mt-2 text-sm text-gray-300">{market.riskDecision || 'No risk decision captured yet.'}</p>
                          </div>
                        </div>

                        <div className="space-y-3">
                          {market.attempts.map((attempt, index) => (
                            <AttemptRow key={attempt.id} attempt={attempt} active={index === 0 && market.isActive} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
            {totalLedgerMarkets > 0 && (
              <div className="mt-4 flex items-center justify-between border-t border-gray-800 pt-4">
                <span className="text-xs text-gray-500">
                  Showing {(ledgerPage - 1) * ledgerLimit + 1}–{Math.min(ledgerPage * ledgerLimit, totalLedgerMarkets)} of {totalLedgerMarkets}
                </span>
                <PaginationBar
                  page={ledgerPage}
                  totalPages={totalLedgerPages}
                  limit={ledgerLimit}
                  onPageChange={setLedgerPage}
                  onLimitChange={(l) => { setLedgerLimit(l); setLedgerPage(1); }}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
