'use client';

import { useEffect, useState } from 'react';
import {
  Layers,
  Sliders,
  History,
  Play,
  Loader2,
  XCircle,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  ArrowUpDown,
  Rocket,
  Shield,
  Save,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

// ── types ────────────────────────────────────────────────────────────────────

interface StrategyConfigVersion {
  id: string;
  version: number;
  name: string | null;
  config: string;
  status: string;
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
  sampleSize: number | null;
  aPlusWinRate: number | null;
  aPlusROI: number | null;
  brierScore: number | null;
  drawdown: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface BacktestRun {
  id: string;
  strategyConfigId: string | null;
  status: string;
  mode: string;
  periodStart: string;
  periodEnd: string;
  totalMarkets: number;
  totalBets: number;
  winRate: number | null;
  roi: number | null;
  brierScore: number | null;
  drawdown: number | null;
  sharpeRatio: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface ParamFormState {
  candidateScoreThreshold: string;
  minAdjustedEdge: string;
  minLiquidity: string;
  maxSpread: string;
  confidenceThreshold: string;
  maxPositionSize: string;
}

const DEFAULT_PARAMS: ParamFormState = {
  candidateScoreThreshold: '0.6',
  minAdjustedEdge: '0.05',
  minLiquidity: '1000',
  maxSpread: '0.05',
  confidenceThreshold: '0.55',
  maxPositionSize: '5000',
};

// ── helpers ──────────────────────────────────────────────────────────────────

function configStatusBadge(status: string) {
  switch (status) {
    case 'DRAFT':
      return (
        <Badge className="border-gray-600/40 bg-gray-600/10 text-gray-400 text-[10px]">
          DRAFT
        </Badge>
      );
    case 'TESTING':
      return (
        <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px]">
          TESTING
        </Badge>
      );
    case 'PAPER':
      return (
        <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px]">
          PAPER
        </Badge>
      );
    case 'LIVE_APPROVED':
      return (
        <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px] gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          LIVE
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="border-gray-700 text-gray-400 text-[10px]">
          {status}
        </Badge>
      );
  }
}

function backtestStatusBadge(status: string) {
  switch (status) {
    case 'RUNNING':
      return (
        <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px] gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          RUNNING
        </Badge>
      );
    case 'COMPLETED':
      return (
        <Badge className="border-cyan-500/30 bg-cyan-500/10 text-cyan-400 text-[10px] gap-1">
          <CheckCircle className="h-2.5 w-2.5" />
          COMPLETED
        </Badge>
      );
    case 'FAILED':
      return (
        <Badge className="border-red-500/30 bg-red-500/10 text-red-400 text-[10px] gap-1">
          <XCircle className="h-2.5 w-2.5" />
          FAILED
        </Badge>
      );
    case 'PENDING':
      return (
        <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px] gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          PENDING
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="border-gray-700 text-gray-400 text-[10px]">
          {status}
        </Badge>
      );
  }
}

function modeBadge(mode: string) {
  switch (mode) {
    case 'TEST':
      return (
        <Badge className="border-blue-500/30 bg-blue-500/10 text-blue-400 text-[10px]">
          TEST
        </Badge>
      );
    case 'PAPER':
      return (
        <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px]">
          PAPER
        </Badge>
      );
    case 'LIVE':
      return (
        <Badge className="border-red-500/30 bg-red-500/10 text-red-400 text-[10px] gap-1">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
          LIVE
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="border-gray-700 text-gray-400 text-[10px]">
          {mode}
        </Badge>
      );
  }
}

function roiColor(roi: number | null): string {
  if (roi === null) return 'text-gray-500';
  if (roi > 0) return 'text-emerald-400';
  if (roi < 0) return 'text-red-400';
  return 'text-gray-400';
}

function formatPct(value: number | null): string {
  if (value === null || value === undefined) return '—';
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${(value * 100).toFixed(1)}%`;
}

function formatDrawdown(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return `${(Math.abs(value) * 100).toFixed(1)}%`;
}

function formatBrier(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(4);
}

function formatSharpe(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return value.toFixed(2);
}

function formatPeriod(start: string, end: string): string {
  const sd = new Date(start);
  const ed = new Date(end);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return `${fmt(sd)} → ${fmt(ed)}`;
}

// ── component ────────────────────────────────────────────────────────────────

export function StrategyOptimizerDashboard() {
  // --- strategy configs ---
  const [configs, setConfigs] = useState<StrategyConfigVersion[]>([]);
  const [configsLoading, setConfigsLoading] = useState(true);
  const [configsError, setConfigsError] = useState<string | null>(null);

  // --- backtests ---
  const [backtests, setBacktests] = useState<BacktestRun[]>([]);
  const [backtestsLoading, setBacktestsLoading] = useState(true);
  const [backtestsError, setBacktestsError] = useState<string | null>(null);

  // --- backtest sort: ROI asc / desc / none ---
  const [roiSort, setRoiSort] = useState<'asc' | 'desc' | null>(null);

  // --- param form ---
  const [params, setParams] = useState<ParamFormState>(DEFAULT_PARAMS);
  const [savingConfig, setSavingConfig] = useState(false);
  const [runningBacktest, setRunningBacktest] = useState(false);
  const [backtestVersion, setBacktestVersion] = useState('');
  const [backtestPeriodStart, setBacktestPeriodStart] = useState('');
  const [backtestPeriodEnd, setBacktestPeriodEnd] = useState('');

  // --- promote in-flight ---
  const [promotingId, setPromotingId] = useState<string | null>(null);

  // ── load strategy configs ─────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/strategy-config');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setConfigs(Array.isArray(data) ? data : data?.data ?? []);
      } catch (err) {
        if (!cancelled) {
          setConfigsError(err instanceof Error ? err.message : 'Failed to load configs');
          toast.error('Failed to load strategy configs');
        }
      } finally {
        if (!cancelled) setConfigsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── load backtests ────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/backtests');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) setBacktests(Array.isArray(data) ? data : data?.data ?? []);
      } catch (err) {
        if (!cancelled) {
          setBacktestsError(err instanceof Error ? err.message : 'Failed to load backtests');
          toast.error('Failed to load backtests');
        }
      } finally {
        if (!cancelled) setBacktestsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const reloadAll = async () => {
    try {
      const [cRes, bRes] = await Promise.all([
        fetch('/api/strategy-config'),
        fetch('/api/backtests'),
      ]);
      if (cRes.ok) {
        const data = await cRes.json();
        setConfigs(Array.isArray(data) ? data : data?.data ?? []);
        setConfigsError(null);
      }
      if (bRes.ok) {
        const data = await bRes.json();
        setBacktests(Array.isArray(data) ? data : data?.data ?? []);
        setBacktestsError(null);
      }
    } catch {
      // silent
    }
  };

  // ── promote config status ─────────────────────────────────────────────────

  const promoteStatus = async (item: StrategyConfigVersion) => {
    const nextStatus: Record<string, string> = {
      DRAFT: 'TESTING',
      TESTING: 'PAPER',
      PAPER: 'LIVE_APPROVED',
    };
    const newStatus = nextStatus[item.status];
    if (!newStatus) return;

    setPromotingId(item.id);
    try {
      const res = await fetch('/api/strategy-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: item.version, status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success(`Promoted to ${newStatus}`);
      await reloadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Promotion failed');
    } finally {
      setPromotingId(null);
    }
  };

  // ── save config ───────────────────────────────────────────────────────────

  const handleSaveConfig = async () => {
    setSavingConfig(true);
    try {
      const res = await fetch('/api/strategy-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Manual config ${new Date().toISOString().slice(0, 10)}`,
          config: {
            candidateScoreThreshold: parseFloat(params.candidateScoreThreshold),
            minAdjustedEdge: parseFloat(params.minAdjustedEdge),
            minLiquidity: parseFloat(params.minLiquidity),
            maxSpread: parseFloat(params.maxSpread),
            confidenceThreshold: parseFloat(params.confidenceThreshold),
            maxPositionSize: parseFloat(params.maxPositionSize),
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success('Strategy config saved');
      await reloadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setSavingConfig(false);
    }
  };

  // ── run backtest ──────────────────────────────────────────────────────────

  const handleRunBacktest = async () => {
    if (!backtestVersion) {
      toast.error('Select a strategy config version');
      return;
    }
    if (!backtestPeriodStart || !backtestPeriodEnd) {
      toast.error('Set period start and end dates');
      return;
    }

    setRunningBacktest(true);
    try {
      const res = await fetch('/api/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyConfigVersion: backtestVersion,
          mode: 'TEST',
          periodStart: new Date(backtestPeriodStart).toISOString(),
          periodEnd: new Date(backtestPeriodEnd).toISOString(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success('Backtest queued');
      setBacktestVersion('');
      setBacktestPeriodStart('');
      setBacktestPeriodEnd('');
      await reloadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start backtest');
    } finally {
      setRunningBacktest(false);
    }
  };

  // ── sorted backtests ─────────────────────────────────────────────────────

  const sortedBacktests = (() => {
    if (!roiSort) return backtests;
    return [...backtests].sort((a, b) => {
      const aRoi = a.roi ?? 0;
      const bRoi = b.roi ?? 0;
      return roiSort === 'asc' ? aRoi - bRoi : bRoi - aRoi;
    });
  })();

  const toggleRoiSort = () => {
    if (!roiSort) setRoiSort('desc');
    else if (roiSort === 'desc') setRoiSort('asc');
    else setRoiSort(null);
  };

  // ── loading skeleton ──────────────────────────────────────────────────────

  if (configsLoading || backtestsLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-64 animate-pulse rounded bg-gray-800" />
          <div className="h-9 w-32 animate-pulse rounded bg-gray-800" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-900" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-gray-900" />
        <div className="h-48 animate-pulse rounded-xl bg-gray-900" />
        <div className="h-64 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  // ── error state ───────────────────────────────────────────────────────────

  if (configsError && backtestsError) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Strategy Optimizer</h2>
        <Card className="border-red-500/30 bg-gray-900">
          <CardContent className="flex flex-col items-center py-12">
            <XCircle className="mb-3 h-10 w-10 text-red-400" />
            <p className="text-sm text-red-400">{configsError}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 border-gray-700 text-gray-300 hover:bg-gray-800"
              onClick={() => {
                setConfigsError(null);
                setConfigsLoading(true);
                setBacktestsError(null);
                setBacktestsLoading(true);
                window.location.reload();
              }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── stats ──
  const totalConfigs = configs.length;
  const liveConfigs = configs.filter((c) => c.status === 'LIVE_APPROVED').length;
  const totalBacktests = backtests.length;
  const completedBacktests = backtests.filter((b) => b.status === 'COMPLETED');
  const avgBacktestRoi =
    completedBacktests.length > 0
      ? completedBacktests.reduce((sum, b) => sum + (b.roi ?? 0), 0) / completedBacktests.length
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Strategy Optimizer</h2>
          <p className="mt-1 text-sm text-gray-500">
            Configure parameters, version strategies, and compare backtest results
          </p>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Config Versions</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{totalConfigs}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Live Configs</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">{liveConfigs}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Backtests</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{totalBacktests}</p>
          </CardContent>
        </Card>
        <Card
          className={cn(
            'bg-gray-900',
            avgBacktestRoi >= 0 ? 'border-emerald-500/20' : 'border-red-500/20',
          )}
        >
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Avg Backtest ROI</p>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', roiColor(avgBacktestRoi))}>
              {completedBacktests.length > 0 ? formatPct(avgBacktestRoi) : '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── SECTION 1: Strategy Config Versions ────────────────────────────── */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <Layers className="h-4 w-4 text-emerald-400" />
            Strategy Config Versions
            <span className="ml-1 text-xs font-normal text-gray-500">({totalConfigs})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {configs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                <Layers className="h-6 w-6 text-gray-500" />
              </div>
              <p className="text-xs font-medium text-gray-400">No config versions yet</p>
              <p className="mt-1 text-[11px] text-gray-600">
                Save a parameter config below to create your first version.
              </p>
            </div>
          ) : (
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-500">Version</TableHead>
                    <TableHead className="text-gray-500">Name</TableHead>
                    <TableHead className="text-gray-500">Status</TableHead>
                    <TableHead className="text-right text-gray-500">Sample</TableHead>
                    <TableHead className="text-right text-gray-500">A+ Win Rate</TableHead>
                    <TableHead className="text-right text-gray-500">A+ ROI</TableHead>
                    <TableHead className="text-right text-gray-500">Brier</TableHead>
                    <TableHead className="text-right text-gray-500">Drawdown</TableHead>
                    <TableHead className="text-gray-500">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {configs.map((c) => (
                    <TableRow
                      key={c.id}
                      className={cn(
                        'border-gray-800 transition-colors hover:bg-gray-800/50',
                        c.status === 'LIVE_APPROVED' && 'bg-emerald-500/5',
                      )}
                    >
                      <TableCell>
                        <span className="text-xs tabular-nums text-gray-200 font-mono">
                          v{c.version}
                        </span>
                      </TableCell>
                      <TableCell>
                        <p className="text-xs font-medium text-gray-200 max-w-[140px] truncate">
                          {c.name || '—'}
                        </p>
                      </TableCell>
                      <TableCell>{configStatusBadge(c.status)}</TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-400">
                          {c.sampleSize?.toLocaleString() ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            'text-xs font-medium tabular-nums',
                            c.aPlusWinRate !== null && c.aPlusWinRate >= 0.55
                              ? 'text-emerald-400'
                              : c.aPlusWinRate !== null && c.aPlusWinRate >= 0.50
                                ? 'text-amber-400'
                                : 'text-red-400',
                            c.aPlusWinRate === null && 'text-gray-600',
                          )}
                        >
                          {formatPct(c.aPlusWinRate)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            'text-xs font-medium tabular-nums',
                            roiColor(c.aPlusROI),
                            c.aPlusROI === null && 'text-gray-600',
                          )}
                        >
                          {formatPct(c.aPlusROI)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-400">
                          {formatBrier(c.brierScore)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            'text-xs tabular-nums',
                            c.drawdown !== null && Math.abs(c.drawdown) > 0.2
                              ? 'text-red-400'
                              : c.drawdown !== null && Math.abs(c.drawdown) > 0.1
                                ? 'text-amber-400'
                                : c.drawdown !== null
                                  ? 'text-emerald-400'
                                  : 'text-gray-600',
                          )}
                        >
                          {formatDrawdown(c.drawdown)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {['LIVE_APPROVED'].includes(c.status) ? (
                          <span className="text-[11px] text-gray-600">Max</span>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={promotingId === c.id}
                            className="h-7 border-gray-700 text-[11px] text-gray-300 hover:bg-gray-800 hover:text-white"
                            onClick={() => promoteStatus(c)}
                          >
                            {promotingId === c.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Rocket className="h-3 w-3" />
                            )}
                            <span className="ml-1">Promote</span>
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── SECTION 2: Parameter Configuration ─────────────────────────────── */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <Sliders className="h-4 w-4 text-emerald-400" />
            Parameter Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {([
              { key: 'candidateScoreThreshold' as const, label: 'Score Threshold', hint: '0–1' },
              { key: 'minAdjustedEdge' as const, label: 'Min Adjusted Edge', hint: 'e.g. 0.05' },
              { key: 'minLiquidity' as const, label: 'Min Liquidity ($)', hint: 'e.g. 1000' },
              { key: 'maxSpread' as const, label: 'Max Spread', hint: 'e.g. 0.05' },
              { key: 'confidenceThreshold' as const, label: 'Confidence Threshold', hint: '0–1' },
              { key: 'maxPositionSize' as const, label: 'Max Position Size ($)', hint: 'e.g. 5000' },
            ] as const).map(({ key, label, hint }) => (
              <div key={key} className="space-y-1.5">
                <Label className="text-xs text-gray-400">{label}</Label>
                <Input
                  type="text"
                  value={params[key]}
                  onChange={(e) => setParams((p) => ({ ...p, [key]: e.target.value }))}
                  placeholder={hint}
                  className="h-8 border-gray-700 bg-gray-800 text-xs text-gray-200 placeholder:text-gray-600 focus-visible:ring-emerald-500/30"
                />
              </div>
            ))}
          </div>

          {/* Backtest runner sub-form */}
          <div className="mt-5 grid gap-4 rounded-lg border border-gray-800 bg-gray-950 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-400">Config Version</Label>
              <Input
                type="text"
                value={backtestVersion}
                onChange={(e) => setBacktestVersion(e.target.value)}
                placeholder="e.g. v3"
                className="h-8 border-gray-700 bg-gray-800 text-xs text-gray-200 placeholder:text-gray-600 focus-visible:ring-emerald-500/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-400">Period Start</Label>
              <Input
                type="date"
                value={backtestPeriodStart}
                onChange={(e) => setBacktestPeriodStart(e.target.value)}
                className="h-8 border-gray-700 bg-gray-800 text-xs text-gray-200 focus-visible:ring-emerald-500/30"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-gray-400">Period End</Label>
              <Input
                type="date"
                value={backtestPeriodEnd}
                onChange={(e) => setBacktestPeriodEnd(e.target.value)}
                className="h-8 border-gray-700 bg-gray-800 text-xs text-gray-200 focus-visible:ring-emerald-500/30"
              />
            </div>
            <div className="flex items-end gap-2">
              <Button
                onClick={handleRunBacktest}
                disabled={runningBacktest}
                className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
              >
                {runningBacktest ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                {runningBacktest ? 'Queuing...' : 'Run Backtest'}
              </Button>
            </div>
          </div>

          <div className="mt-4 flex gap-3">
            <Button
              onClick={handleSaveConfig}
              disabled={savingConfig}
              className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
            >
              {savingConfig ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              {savingConfig ? 'Saving...' : 'Save Config'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── SECTION 3: Backtest Results ────────────────────────────────────── */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <History className="h-4 w-4 text-emerald-400" />
            Backtest Results
            <span className="ml-1 text-xs font-normal text-gray-500">({backtests.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {backtests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                <History className="h-6 w-6 text-gray-500" />
              </div>
              <p className="text-xs font-medium text-gray-400">No backtests yet</p>
              <p className="mt-1 text-[11px] text-gray-600">
                Save a config and click &quot;Run Backtest&quot; to start comparing strategies.
              </p>
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-500">Period</TableHead>
                    <TableHead className="text-gray-500">Mode</TableHead>
                    <TableHead className="text-right text-gray-500">Markets</TableHead>
                    <TableHead className="text-right text-gray-500">Bets</TableHead>
                    <TableHead className="text-right text-gray-500">Win Rate</TableHead>
                    <TableHead
                      className="cursor-pointer select-none text-right text-gray-500 hover:text-gray-300 transition-colors"
                      onClick={toggleRoiSort}
                    >
                      <span className="inline-flex items-center gap-1">
                        ROI
                        <ArrowUpDown
                          className={cn(
                            'h-3 w-3',
                            roiSort === 'desc' && 'text-emerald-400',
                            roiSort === 'asc' && 'text-amber-400',
                          )}
                        />
                      </span>
                    </TableHead>
                    <TableHead className="text-right text-gray-500">Brier</TableHead>
                    <TableHead className="text-right text-gray-500">Drawdown</TableHead>
                    <TableHead className="text-right text-gray-500">Sharpe</TableHead>
                    <TableHead className="text-gray-500">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedBacktests.map((b) => (
                    <TableRow
                      key={b.id}
                      className={cn(
                        'border-gray-800 transition-colors hover:bg-gray-800/50',
                        b.status === 'RUNNING' && 'bg-emerald-500/5',
                        b.status === 'FAILED' && 'bg-red-500/5',
                      )}
                    >
                      <TableCell>
                        <span className="text-xs text-gray-300">
                          {formatPeriod(b.periodStart, b.periodEnd)}
                        </span>
                      </TableCell>
                      <TableCell>{modeBadge(b.mode)}</TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-400">
                          {b.totalMarkets.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-300">
                          {b.totalBets.toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            'text-xs font-medium tabular-nums',
                            b.winRate !== null && b.winRate >= 0.55
                              ? 'text-emerald-400'
                              : b.winRate !== null && b.winRate >= 0.50
                                ? 'text-amber-400'
                                : 'text-red-400',
                            b.winRate === null && 'text-gray-600',
                          )}
                        >
                          {formatPct(b.winRate)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {(b.roi ?? 0) > 0 ? (
                            <TrendingUp className="h-3 w-3 text-emerald-400" />
                          ) : (b.roi ?? 0) < 0 ? (
                            <TrendingDown className="h-3 w-3 text-red-400" />
                          ) : null}
                          <span
                            className={cn(
                              'text-xs font-medium tabular-nums',
                              roiColor(b.roi),
                            )}
                          >
                            {formatPct(b.roi)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-400">
                          {formatBrier(b.brierScore)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            'text-xs tabular-nums',
                            b.drawdown !== null && Math.abs(b.drawdown) > 0.2
                              ? 'text-red-400'
                              : b.drawdown !== null && Math.abs(b.drawdown) > 0.1
                                ? 'text-amber-400'
                                : b.drawdown !== null
                                  ? 'text-emerald-400'
                                  : 'text-gray-600',
                          )}
                        >
                          {formatDrawdown(b.drawdown)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            'text-xs tabular-nums',
                            b.sharpeRatio !== null && b.sharpeRatio >= 2.0
                              ? 'text-emerald-400'
                              : b.sharpeRatio !== null && b.sharpeRatio >= 1.0
                                ? 'text-amber-400'
                                : b.sharpeRatio !== null
                                  ? 'text-red-400'
                                  : 'text-gray-600',
                          )}
                        >
                          {formatSharpe(b.sharpeRatio)}
                        </span>
                      </TableCell>
                      <TableCell>{backtestStatusBadge(b.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
