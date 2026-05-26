'use client';

import { useState } from 'react';
import {
  History,
  Play,
  Loader2,
  XCircle,
  CheckCircle,
  Clock,
  TrendingUp,
  TrendingDown,
  Search,
  ChevronUp,
  ChevronDown,
  Filter,
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
import { usePagination } from '@/hooks/use-pagination';
import { PaginationBar } from '@/components/trading/PaginationBar';
import type { PaginationParams, PaginatedResponse } from '@/lib/types';

// ── types ────────────────────────────────────────────────────────────────────

interface BacktestRun {
  id: string;
  name?: string | null;
  period?: string | null;
  mode?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  totalBets: number;
  winRate: number | null;
  roi: number | null;
  brierScore: number | null;
  drawdown: number | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
  config: Record<string, unknown> | null;
  result?: string | null;
  profitEvidence?: {
    canEvaluateProfit: boolean;
    reason: string;
  } | null;
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

function roiColor(roi: number | null): string {
  if (roi === null) return 'text-gray-500';
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

function formatRunPeriod(run: BacktestRun): string {
  if (run.period) return run.period;
  if (!run.periodStart || !run.periodEnd) return '—';
  return `${new Date(run.periodStart).toLocaleDateString()} – ${new Date(run.periodEnd).toLocaleDateString()}`;
}

function getRunError(run: BacktestRun): string | null {
  if (!run.result) return null;
  try {
    const parsed = JSON.parse(run.result) as { error?: string };
    return parsed.error || null;
  } catch {
    return null;
  }
}

function getRunProfitEvidenceReason(run: BacktestRun): string | null {
  if (run.profitEvidence?.canEvaluateProfit === false) return run.profitEvidence.reason;
  if (run.status === 'COMPLETED' && run.totalBets === 0) {
    return 'No historical bets qualified; ROI is unavailable, not 0%.';
  }
  if (!run.result) return null;
  try {
    const parsed = JSON.parse(run.result) as { profitEvidence?: { canEvaluateProfit?: boolean; reason?: string } };
    if (parsed.profitEvidence?.canEvaluateProfit === false) return parsed.profitEvidence.reason ?? null;
  } catch {
    return null;
  }
  return null;
}

function hasCompletedMetrics(run: BacktestRun): boolean {
  return run.status === 'COMPLETED' && run.totalBets > 0 && run.profitEvidence?.canEvaluateProfit !== false;
}

// ── component ────────────────────────────────────────────────────────────────

const BACKTEST_STATUSES = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED'] as const;

export function BacktestsDashboard() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [starting, setStarting] = useState(false);

  const {
    data: runs,
    page,
    limit,
    total,
    totalPages,
    sortBy,
    sortOrder,
    loading,
    error,
    setPage,
    setLimit,
    setSort,
    fetchData,
  } = usePagination<BacktestRun>(
    async (params: PaginationParams): Promise<PaginatedResponse<BacktestRun>> => {
      const query = new URLSearchParams({
        page: String(params.page),
        limit: String(params.limit),
        sortBy: params.sortBy || 'createdAt',
        sortOrder: params.sortOrder || 'desc',
      });
      if (search.trim()) query.set('search', search.trim());
      if (statusFilter !== 'ALL') query.set('status', statusFilter);
      const res = await fetch(`/api/backtests?${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    [search, statusFilter],
    { defaultSortBy: 'startedAt', defaultSortOrder: 'desc' },
  );

  const handleSort = (field: string) => {
    const newOrder = sortBy === field && sortOrder === 'desc' ? 'asc' : 'desc';
    setSort(field, newOrder);
  };

  const SortIcon = sortOrder === 'desc' ? ChevronDown : ChevronUp;

  const startIndex = total === 0 ? 0 : (page - 1) * limit + 1;
  const endIndex = Math.min(page * limit, total);

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
      await fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start backtest');
      await fetchData();
    } finally {
      setStarting(false);
    }
  };

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
              onClick={() => window.location.reload()}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading && runs.length === 0) {
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

  const completedRuns = runs.filter(hasCompletedMetrics);
  const completedNoEvidenceRuns = runs.filter((r) => r.status === 'COMPLETED' && r.totalBets === 0).length;
  const runningCount = runs.filter((r) => r.status === 'RUNNING').length;
  const avgRoi = completedRuns.length > 0
    ? completedRuns.reduce((sum, r) => sum + (r.roi ?? 0), 0) / completedRuns.length
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
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{total}</p>
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
            {completedNoEvidenceRuns > 0 && (
              <p className="text-[10px] text-amber-300">{completedNoEvidenceRuns} run{completedNoEvidenceRuns === 1 ? '' : 's'} lack trade evidence</p>
            )}
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

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input
            placeholder="Search by name..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-gray-800 bg-gray-900 pl-10 text-sm text-white placeholder:text-gray-600"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px] border-gray-800 bg-gray-900 text-sm text-gray-300">
            <Filter className="mr-2 h-3.5 w-3.5 text-gray-500" />
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent className="border-gray-800 bg-gray-900 text-gray-300">
            <SelectItem value="ALL">All Statuses</SelectItem>
            {BACKTEST_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Backtest runs table */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <History className="h-4 w-4 text-emerald-400" />
            Backtest Runs
            <span className="ml-1 text-xs font-normal text-gray-500">
              (Showing {startIndex}–{endIndex} of {total})
            </span>
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
            <>
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-transparent">
                      <TableHead className="cursor-pointer text-gray-500 hover:text-gray-300" onClick={() => handleSort('name')}>
                        <span className="inline-flex items-center gap-1">
                          Name {sortBy === 'name' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
                      <TableHead className="text-gray-500">Period</TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('totalBets')}>
                        <span className="inline-flex items-center gap-1">
                          Bets {sortBy === 'totalBets' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('winRate')}>
                        <span className="inline-flex items-center gap-1">
                          Win Rate {sortBy === 'winRate' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('roi')}>
                        <span className="inline-flex items-center gap-1">
                          ROI {sortBy === 'roi' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('brierScore')}>
                        <span className="inline-flex items-center gap-1">
                          Brier {sortBy === 'brierScore' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('drawdown')}>
                        <span className="inline-flex items-center gap-1">
                          Drawdown {sortBy === 'drawdown' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
                      <TableHead className="text-gray-500">Status</TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('startedAt')}>
                        <span className="inline-flex items-center gap-1">
                          Duration {sortBy === 'startedAt' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
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
                          <p className="text-xs font-medium text-gray-200">{r.name || r.mode || 'Deterministic backtest'}</p>
                          {getRunError(r) && (
                            <p className="mt-1 max-w-xs text-[11px] text-red-300">{getRunError(r)}</p>
                          )}
                          {getRunProfitEvidenceReason(r) && (
                            <p className="mt-1 max-w-xs text-[11px] text-amber-300">{getRunProfitEvidenceReason(r)}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-gray-400">{formatRunPeriod(r)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs tabular-nums text-gray-300">{r.totalBets.toLocaleString()}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          {hasCompletedMetrics(r) && r.winRate !== null ? (
                            <span className={cn(
                              'text-xs font-medium tabular-nums',
                              r.winRate >= 0.55 ? 'text-emerald-400' : r.winRate >= 0.50 ? 'text-amber-400' : 'text-red-400'
                            )}>
                              {formatPct(r.winRate)}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-500">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {hasCompletedMetrics(r) && r.roi !== null && r.roi > 0 ? (
                              <TrendingUp className="h-3 w-3 text-emerald-400" />
                            ) : hasCompletedMetrics(r) && r.roi !== null && r.roi < 0 ? (
                              <TrendingDown className="h-3 w-3 text-red-400" />
                            ) : null}
                            <span className={cn('text-xs font-medium tabular-nums', roiColor(r.roi))}>
                              {hasCompletedMetrics(r) && r.roi !== null ? formatPct(r.roi) : '—'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs tabular-nums text-gray-400">{formatScore(r.brierScore)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          {hasCompletedMetrics(r) && r.drawdown !== null ? (
                            <span className={cn(
                              'text-xs tabular-nums',
                              Math.abs(r.drawdown) > 0.2 ? 'text-red-400' : Math.abs(r.drawdown) > 0.1 ? 'text-amber-400' : 'text-emerald-400'
                            )}>
                              {formatDrawdown(r.drawdown)}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-500">—</span>
                          )}
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
              <div className="border-t border-gray-800 px-4 py-3">
                <PaginationBar page={page} totalPages={totalPages} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
