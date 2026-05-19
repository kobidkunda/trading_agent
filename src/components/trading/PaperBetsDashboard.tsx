'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Search,
  Loader2,
  XCircle,
  Filter,
  TrendingUp,
  TrendingDown,
  Target,
  CheckCircle,
  XOctagon,
  ChevronUp,
  ChevronDown,
  Play,
  Pause,
  Square,
  RefreshCw,
  Activity,
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
import { cn } from '@/lib/utils';
import { usePagination } from '@/hooks/use-pagination';
import { PaginationBar } from '@/components/trading/PaginationBar';
import type { PaginationParams, PaginatedResponse } from '@/lib/types';

interface PaperBet {
  id: string;
  market: string;
  marketTitle: string;
  venue: string;
  predictedProb: number;
  impliedProb: number;
  edge: number;
  confidence: number;
  brierScore: number | null;
  pnl: number | null;
  actualOutcome: string | null;
  predictionType: string;
  createdAt: string;
}

type SortField = 'edge' | 'confidence' | 'brierScore' | 'pnl' | 'createdAt';

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatPnl(value: number | null): string {
  if (value === null) return '\u2014';
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatScore(value: number | null): string {
  if (value === null) return '\u2014';
  return value.toFixed(4);
}

function pnlColor(value: number | null): string {
  if (value === null) return 'text-gray-500';
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-red-400';
  return 'text-gray-400';
}

function edgeColor(edge: number): string {
  if (edge >= 0.1) return 'text-emerald-400';
  if (edge >= 0.05) return 'text-cyan-400';
  if (edge >= 0) return 'text-amber-400';
  return 'text-red-400';
}

function outcomeBadge(outcome: string | null) {
  if (!outcome) return <span className="text-xs text-gray-600">Pending</span>;
  if (outcome === 'WIN') {
    return <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px]">WIN</Badge>;
  }
  if (outcome === 'LOSS') {
    return <Badge className="border-red-500/30 bg-red-500/10 text-red-400 text-[10px]">LOSS</Badge>;
  }
  return <Badge variant="outline" className="border-gray-700 text-gray-400 text-[10px]">{outcome}</Badge>;
}

function typeBadge(type: string) {
  if (type === 'BID') {
    return <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px]">BID</Badge>;
  }
  return <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px]">WATCH</Badge>;
}

export function PaperBetsDashboard() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [loopState, setLoopState] = useState<{
    status: string;
    ordersProcessed: number;
    ordersFilled: number;
    ordersFailed: number;
    currentCycle: number;
    lastCycleAt: string | null;
    errors: number;
  } | null>(null);
  const [loopLoading, setLoopLoading] = useState(false);

  const fetchLoopState = useCallback(async () => {
    try {
      const res = await fetch('/api/trading/paper-loop');
      if (res.ok) setLoopState(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchLoopState();
    const i = setInterval(fetchLoopState, 5000);
    return () => clearInterval(i);
  }, [fetchLoopState]);

  const {
    data: bets,
    page,
    limit,
    total,
    totalPages,
    loading,
    error,
    setPage,
    setLimit,
    setSort,
    sortBy,
    sortOrder,
    fetchData,
  } = usePagination<PaperBet>(
    async (params: PaginationParams): Promise<PaginatedResponse<PaperBet>> => {
      const query = new URLSearchParams({
        page: String(params.page),
        limit: String(params.limit),
        sortBy: params.sortBy || 'createdAt',
        sortOrder: params.sortOrder || 'desc',
      });
      if (search.trim()) query.set('search', search.trim());
      if (typeFilter !== 'ALL') query.set('type', typeFilter);
      const res = await fetch(`/api/paper-bets?${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const list = Array.isArray(raw.data) ? raw.data : (Array.isArray(raw.bets) ? raw.bets : (Array.isArray(raw.results) ? raw.results : (Array.isArray(raw) ? raw : [])));
      return { ...raw, data: list };
    },
    [search, typeFilter],
  );
  const controlLoop = useCallback(async (action: string) => {
    setLoopLoading(true);
    try {
      await fetch('/api/trading/paper-loop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, intervalMs: 3000 }),
      });
      await fetchLoopState();
      if (action === 'fill-all') fetchData();
    } finally {
      setLoopLoading(false);
    }
  }, [fetchLoopState, fetchData]);

  function handleSort(field: SortField) {
    const dir = sortBy === field && sortOrder === 'desc' ? 'asc' : 'desc';
    setSort(field, dir);
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortBy !== field) return <ChevronDown className="ml-1 h-3 w-3 text-gray-600" />;
    return sortOrder === 'desc' ? <ChevronDown className="ml-1 h-3 w-3" /> : <ChevronUp className="ml-1 h-3 w-3" />;
  }

  // ── loading ──
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-40 animate-pulse rounded bg-gray-800" />
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
        <h2 className="text-xl font-semibold text-white">Paper Bets</h2>
        <Card className="border-red-500/30 bg-gray-900">
          <CardContent className="flex flex-col items-center py-12">
            <XCircle className="mb-3 h-10 w-10 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 border-gray-700 text-gray-300 hover:bg-gray-800"
              onClick={() => { fetchData(); }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── stats ──
  const settledBets = bets.filter((b) => b.actualOutcome !== null);
  const winCount = settledBets.filter((b) => b.actualOutcome === 'WIN').length;
  const winRate = settledBets.length > 0 ? winCount / settledBets.length : 0;
  const totalPnl = bets.reduce((sum, b) => sum + (b.pnl ?? 0), 0);
  const avgBrier = bets.length > 0
    ? bets.reduce((sum, b) => sum + (b.brierScore ?? 0), 0) / Math.max(1, bets.filter((b) => b.brierScore !== null).length)
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white">Paper Bets</h2>
        <p className="mt-1 text-sm text-gray-500">
          Paper trading bet history with probability calibration and P&amp;L tracking
        </p>
      </div>

      {/* Paper Loop Controls */}
      {loopState && (
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Activity className={cn(
                  'h-4 w-4',
                  loopState.status === 'RUNNING' ? 'text-emerald-400' :
                  loopState.status === 'PAUSED' ? 'text-amber-400' : 'text-gray-600'
                )} />
                <span className="text-sm text-gray-300">
                  Loop: <span className={cn(
                    'font-medium',
                    loopState.status === 'RUNNING' ? 'text-emerald-400' :
                    loopState.status === 'PAUSED' ? 'text-amber-400' : 'text-gray-500'
                  )}>{loopState.status}</span>
                </span>
              </div>
              <span className="text-xs text-gray-600">
                Cycle {loopState.currentCycle}
                {' | '}
                {loopState.ordersProcessed} processed
                {' | '}
                {loopState.ordersFilled} filled
                {loopState.ordersFailed > 0 && ` | ${loopState.ordersFailed} failed`}
                {loopState.errors > 0 && ` | ⚠ ${loopState.errors}`}
              </span>
            </div>
            <div className="flex gap-2">
              {loopState.status !== 'RUNNING' ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 text-xs h-8"
                  onClick={() => controlLoop('start')}
                  disabled={loopLoading}
                >
                  {loopLoading ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />}
                  Start
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-xs h-8"
                    onClick={() => controlLoop('pause')}
                    disabled={loopLoading}
                  >
                    <Pause className="mr-1 h-3 w-3" />
                    Pause
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/20 text-xs h-8"
                    onClick={() => controlLoop('stop')}
                    disabled={loopLoading}
                  >
                    <Square className="mr-1 h-3 w-3" />
                    Stop
                  </Button>
                </>
              )}
              <Button
                size="sm"
                variant="outline"
                className="border-cyan-500/30 bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 text-xs h-8"
                onClick={() => controlLoop('fill-all')}
                disabled={loopLoading}
              >
                <RefreshCw className={cn('mr-1 h-3 w-3', loopLoading && 'animate-spin')} />
                Fill All
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total Bets</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{total}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Win Rate</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">
              {settledBets.length > 0 ? formatPct(winRate) : '\u2014'}
            </p>
          </CardContent>
        </Card>
        <Card className={cn(
          'bg-gray-900',
          totalPnl >= 0 ? 'border-emerald-500/20' : 'border-red-500/20'
        )}>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total P&amp;L</p>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', pnlColor(totalPnl))}>
              {formatPnl(totalPnl)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-cyan-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Avg Brier</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-cyan-400">
              {bets.some((b) => b.brierScore !== null) ? avgBrier.toFixed(4) : '\u2014'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input
            placeholder="Search by market title or venue..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-gray-800 bg-gray-900 pl-10 text-sm text-white placeholder:text-gray-600"
          />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[160px] border-gray-800 bg-gray-900 text-sm text-gray-300">
            <Filter className="mr-2 h-3.5 w-3.5 text-gray-500" />
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent className="border-gray-800 bg-gray-900 text-gray-300">
            <SelectItem value="ALL">All Types</SelectItem>
            <SelectItem value="BID">BID</SelectItem>
            <SelectItem value="WATCH">WATCH</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Bets table */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <BarChart3 className="h-4 w-4 text-emerald-400" />
            Paper Bet History
            <span className="ml-1 text-xs font-normal text-gray-500">
              ({total})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {bets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                <BarChart3 className="h-6 w-6 text-gray-500" />
              </div>
              <p className="text-xs font-medium text-gray-400">No paper bets found</p>
              <p className="mt-1 text-[11px] text-gray-600">
                {search || typeFilter !== 'ALL'
                  ? 'Try adjusting your filters.'
                  : 'Paper bets will appear as research produces probability estimates.'}
              </p>
            </div>
          ) : (
            <>
              <p className="px-6 pb-2 text-xs text-gray-600">
                Showing {((page - 1) * limit) + 1}\u2013{Math.min(page * limit, total)} of {total}
              </p>
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-transparent">
                      <TableHead className="text-gray-500">Market</TableHead>
                      <TableHead className="text-gray-500">Type</TableHead>
                      <TableHead className="text-right text-gray-500">Predicted</TableHead>
                      <TableHead className="text-right text-gray-500">Implied</TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('edge')}>
                        <span className="inline-flex items-center gap-1">
                          Edge <SortIcon field="edge" />
                        </span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('confidence')}>
                        <span className="inline-flex items-center gap-1">
                          Conf <SortIcon field="confidence" />
                        </span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('brierScore')}>
                        <span className="inline-flex items-center gap-1">
                          Brier <SortIcon field="brierScore" />
                        </span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('pnl')}>
                        <span className="inline-flex items-center gap-1">
                          P&amp;L <SortIcon field="pnl" />
                        </span>
                      </TableHead>
                      <TableHead className="text-right text-gray-500">Outcome</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bets.map((b) => (
                      <TableRow
                        key={b.id}
                        className={cn(
                          'border-gray-800 transition-colors hover:bg-gray-800/50',
                          b.actualOutcome === 'WIN' && 'bg-emerald-500/5',
                          b.actualOutcome === 'LOSS' && 'bg-red-500/5'
                        )}
                      >
                        <TableCell>
                          <p className="max-w-[200px] truncate text-xs font-medium text-gray-200">
                            {b.marketTitle || b.market}
                          </p>
                        </TableCell>
                        <TableCell>{typeBadge(b.predictionType)}</TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs tabular-nums text-gray-300">{formatPct(b.predictedProb)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs tabular-nums text-gray-500">{formatPct(b.impliedProb)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {b.edge > 0 ? (
                              <TrendingUp className="h-3 w-3 text-emerald-400" />
                            ) : (
                              <TrendingDown className="h-3 w-3 text-red-400" />
                            )}
                            <span className={cn('text-xs font-medium tabular-nums', edgeColor(b.edge))}>
                              {b.edge >= 0 ? '+' : ''}{formatPct(b.edge)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs tabular-nums text-gray-300">{formatPct(b.confidence)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs tabular-nums text-gray-400">{formatScore(b.brierScore)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn('text-xs font-medium tabular-nums', pnlColor(b.pnl))}>
                            {formatPnl(b.pnl)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">{outcomeBadge(b.actualOutcome)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="border-t border-gray-800 px-6 py-4">
                <PaginationBar page={page} totalPages={totalPages} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
