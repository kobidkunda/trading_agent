'use client';

import { useEffect, useState } from 'react';
import {
  History,
  Play,
  Loader2,
  XCircle,
  CheckCircle,
  Clock,
  TrendingUp,
  TrendingDown,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

interface BacktestRun {
  id: string;
  name: string;
  period: string;
  totalBets: number;
  winRate: number;
  roi: number;
  brierScore: number | null;
  drawdown: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
  config: Record<string, unknown> | null;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: string) {
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
          <Clock className="h-2.5 w-2.5" />
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

function roiColor(roi: number): string {
  if (roi > 0) return 'text-emerald-400';
  if (roi < 0) return 'text-red-400';
  return 'text-gray-400';
}

function formatPct(value: number): string {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${(value * 100).toFixed(1)}%`;
}

function formatDrawdown(value: number): string {
  return `${(Math.abs(value) * 100).toFixed(1)}%`;
}

function formatScore(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(4);
}

function formatDuration(started: string, completed: string | null): string {
  if (!completed) return '—';
  const ms = new Date(completed).getTime() - new Date(started).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

// ── component ────────────────────────────────────────────────────────────────

export function BacktestsDashboard() {
  const [runs, setRuns] = useState<BacktestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/backtests');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setRuns(data.runs ?? data ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load backtests');
          toast.error('Failed to load backtests');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const handleStartBacktest = async () => {
    setStarting(true);
    try {
      const res = await fetch('/api/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast.success('Backtest started');
      // Reload
      const reloadRes = await fetch('/api/backtests');
      if (reloadRes.ok) {
        const data = await reloadRes.json();
        setRuns(data.runs ?? data ?? []);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start backtest');
    } finally {
      setStarting(false);
    }
  };

  // ── loading ──
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-40 animate-pulse rounded bg-gray-800" />
          <div className="h-9 w-32 animate-pulse rounded bg-gray-800" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-900" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  // ── error ──
  if (error) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Backtests</h2>
        <Card className="border-red-500/30 bg-gray-900">
          <CardContent className="flex flex-col items-center py-12">
            <XCircle className="mb-3 h-10 w-10 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 border-gray-700 text-gray-300 hover:bg-gray-800"
              onClick={() => { setError(null); setLoading(true); window.location.reload(); }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── stats ──
  const totalRuns = runs.length;
  const completedRuns = runs.filter((r) => r.status === 'COMPLETED');
  const runningCount = runs.filter((r) => r.status === 'RUNNING').length;
  const failedCount = runs.filter((r) => r.status === 'FAILED').length;
  const avgRoi = completedRuns.length > 0
    ? completedRuns.reduce((sum, r) => sum + r.roi, 0) / completedRuns.length
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Backtests</h2>
          <p className="mt-1 text-sm text-gray-500">
            Historical strategy backtests with performance metrics
          </p>
        </div>
        <Button
          onClick={handleStartBacktest}
          disabled={starting || runningCount > 0}
          className="gap-2 bg-emerald-600 text-sm text-white hover:bg-emerald-700"
        >
          {starting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {starting ? 'Starting...' : 'Run Backtest'}
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total Runs</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{totalRuns}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Completed</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">{completedRuns.length}</p>
          </CardContent>
        </Card>
        <Card className={cn(
          'bg-gray-900',
          avgRoi >= 0 ? 'border-emerald-500/20' : 'border-red-500/20'
        )}>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Avg ROI</p>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', roiColor(avgRoi))}>
              {completedRuns.length > 0 ? formatPct(avgRoi) : '—'}
            </p>
          </CardContent>
        </Card>
        <Card className={cn(
          'bg-gray-900',
          runningCount > 0 ? 'border-emerald-500/30' : 'border-gray-800'
        )}>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Running</p>
            <p className={cn(
              'mt-1 text-2xl font-bold tabular-nums',
              runningCount > 0 ? 'text-emerald-400' : 'text-gray-400'
            )}>
              {runningCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Backtest runs table */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <History className="h-4 w-4 text-emerald-400" />
            Backtest Runs
            <span className="ml-1 text-xs font-normal text-gray-500">({totalRuns})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                <History className="h-6 w-6 text-gray-500" />
              </div>
              <p className="text-xs font-medium text-gray-400">No backtests yet</p>
              <p className="mt-1 text-[11px] text-gray-600">Click &quot;Run Backtest&quot; to start your first backtest.</p>
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-500">Name</TableHead>
                    <TableHead className="text-gray-500">Period</TableHead>
                    <TableHead className="text-right text-gray-500">Bets</TableHead>
                    <TableHead className="text-right text-gray-500">Win Rate</TableHead>
                    <TableHead className="text-right text-gray-500">ROI</TableHead>
                    <TableHead className="text-right text-gray-500">Brier</TableHead>
                    <TableHead className="text-right text-gray-500">Drawdown</TableHead>
                    <TableHead className="text-gray-500">Status</TableHead>
                    <TableHead className="text-right text-gray-500">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => (
                    <TableRow
                      key={r.id}
                      className={cn(
                        'border-gray-800 transition-colors hover:bg-gray-800/50',
                        r.status === 'RUNNING' && 'bg-emerald-500/5',
                        r.status === 'FAILED' && 'bg-red-500/5'
                      )}
                    >
                      <TableCell>
                        <p className="text-xs font-medium text-gray-200">{r.name}</p>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-gray-400">{r.period}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-300">{r.totalBets.toLocaleString()}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cn(
                          'text-xs font-medium tabular-nums',
                          r.winRate >= 0.55 ? 'text-emerald-400' : r.winRate >= 0.50 ? 'text-amber-400' : 'text-red-400'
                        )}>
                          {formatPct(r.winRate)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {r.roi > 0 ? (
                            <TrendingUp className="h-3 w-3 text-emerald-400" />
                          ) : r.roi < 0 ? (
                            <TrendingDown className="h-3 w-3 text-red-400" />
                          ) : null}
                          <span className={cn('text-xs font-medium tabular-nums', roiColor(r.roi))}>
                            {formatPct(r.roi)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-400">{formatScore(r.brierScore)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cn(
                          'text-xs tabular-nums',
                          Math.abs(r.drawdown) > 0.2 ? 'text-red-400' : Math.abs(r.drawdown) > 0.1 ? 'text-amber-400' : 'text-emerald-400'
                        )}>
                          {formatDrawdown(r.drawdown)}
                        </span>
                      </TableCell>
                      <TableCell>{statusBadge(r.status)}</TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs text-gray-500">
                          {formatDuration(r.startedAt, r.completedAt)}
                        </span>
                      </TableCell>
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
