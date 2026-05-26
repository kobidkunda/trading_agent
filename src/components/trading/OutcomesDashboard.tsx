'use client';

import { useState } from 'react';
import {
  CheckCircle,
  Target,
  Award,
  XCircle,
  Search,
  ChevronUp,
  ChevronDown,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { usePagination } from '@/hooks/use-pagination';
import { PaginationBar } from '@/components/trading/PaginationBar';
import type { PaginationParams, PaginatedResponse } from '@/lib/types';

interface OutcomeRecord {
  id: string;
  marketId: string;
  result: string;
  resolvedProb: number | null;
  resolvedAt: string;
  predictedProb: number | null;
  actualOutcome: string | null;
  brierScore: number | null;
  pnl: number | null;
  market: {
    id: string;
    title: string;
    venue: string;
    category: string;
  } | null;
}

interface OutcomeMeta {
  totalDecisions: number;
  resolved: number;
  unresolved: number;
  dueForResolution: number;
  pendingFuture: number;
  nextResolutionAt: string | null;
  nextResolutionMarket: { id: string; title: string } | null;
  profitEvidence: {
    status: string;
    canEvaluateProfit: boolean;
    reason: string;
    resolvedPaperBets: number;
    executedUnresolvedPaperBets: number;
    historicalResolvedWithPredictions: number;
  } | null;
  settlementReadiness: {
    executedUnresolvedPaperBets: number;
    executedUnresolvedWithArchivedPrediction: number;
    missingArchivedPrediction: number;
    executedUnresolvedPaperBetMarkets: number;
    activeResolutionJobMarkets: number;
    missingResolutionJobs: number;
    dueResolutionJobs: number;
    nextResolutionAt: string | null;
    nextResolutionMarket: { id: string; title: string } | null;
  } | null;
}

interface PaperBetMeta {
  totalBets: number;
  resolvedBets: number;
  pendingBets: number;
  directionAccuracy: number | null;
  avgBrierScore: number | null;
  totalPnl: number | null;
}

type SortField = 'predictedProb' | 'brierScore' | 'pnl' | 'resolvedAt';

function SortIndicator({ active, order }: { active: boolean; order: 'asc' | 'desc' }) {
  if (!active) return <ChevronDown className="ml-1 h-3 w-3 text-gray-600" />;
  return order === 'desc' ? <ChevronDown className="ml-1 h-3 w-3" /> : <ChevronUp className="ml-1 h-3 w-3" />;
}

function outcomeBadge(result: string) {
  const isYes = result === 'YES';
  const isCancelled = result === 'CANCELLED';
  return (
    <Badge className={cn(
      'border-transparent text-[10px] text-white',
      isYes ? 'bg-emerald-600/70' : isCancelled ? 'bg-gray-600/70' : 'bg-red-600/70'
    )}>
      {result}
    </Badge>
  );
}

function correctBadge(correct: boolean | null) {
  if (correct === null) {
    return (
      <Badge variant="outline" className="border-gray-700 text-[10px] text-gray-500">&mdash;</Badge>
    );
  }
  return correct ? (
    <Badge className="border-transparent bg-emerald-600/20 text-[10px] text-emerald-400">Correct</Badge>
  ) : (
    <Badge className="border-transparent bg-red-600/20 text-[10px] text-red-400">Wrong</Badge>
  );
}

function brierColor(score: number | null): string {
  if (score === null) return 'text-gray-500';
  if (score <= 0.10) return 'text-emerald-400';
  if (score <= 0.20) return 'text-amber-400';
  return 'text-red-400';
}

function pnlColor(val: number | null): string {
  if (val === null) return 'text-gray-500';
  if (val > 0) return 'text-emerald-400';
  if (val < 0) return 'text-red-400';
  return 'text-gray-400';
}

function formatPct(val: number | null): string {
  if (val === null) return '\u2014';
  return `${(val * 100).toFixed(1)}%`;
}

function formatCurrency(val: number): string {
  if (!Number.isFinite(val)) return '\u2014';
  return val >= 1000 ? `$${(val / 1000).toFixed(1)}k` : `$${val.toFixed(2)}`;
}

function formatPnl(val: number | null): string {
  if (val === null) return '\u2014';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${formatCurrency(val)}`;
}

export function OutcomesDashboard() {
  const [searchTerm, setSearchTerm] = useState('');
  const [meta, setMeta] = useState<OutcomeMeta | null>(null);
  const [paperBetMeta, setPaperBetMeta] = useState<PaperBetMeta | null>(null);

  const {
    data: outcomes,
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
  } = usePagination<OutcomeRecord>(
    async (params: PaginationParams): Promise<PaginatedResponse<OutcomeRecord>> => {
      const query = new URLSearchParams({
        page: String(params.page),
        limit: String(params.limit),
        sortBy: params.sortBy || 'resolvedAt',
        sortOrder: params.sortOrder || 'desc',
      });
      if (searchTerm.trim()) query.set('search', searchTerm.trim());
      const res = await fetch(`/api/outcomes?${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setMeta({
        totalDecisions: Number(json.totalDecisions ?? 0),
        resolved: Number(json.resolved ?? 0),
        unresolved: Number(json.unresolved ?? 0),
        dueForResolution: Number(json.dueForResolution ?? 0),
        pendingFuture: Number(json.pendingFuture ?? 0),
        nextResolutionAt: typeof json.nextResolutionAt === 'string' ? json.nextResolutionAt : null,
        nextResolutionMarket: json.nextResolutionMarket && typeof json.nextResolutionMarket === 'object'
          ? {
              id: String(json.nextResolutionMarket.id ?? ''),
              title: String(json.nextResolutionMarket.title ?? ''),
            }
          : null,
        profitEvidence: json.profitEvidence && typeof json.profitEvidence === 'object'
          ? {
              status: String(json.profitEvidence.status ?? 'UNAVAILABLE'),
              canEvaluateProfit: Boolean(json.profitEvidence.canEvaluateProfit),
              reason: String(json.profitEvidence.reason ?? ''),
              resolvedPaperBets: Number(json.profitEvidence.resolvedPaperBets ?? 0),
              executedUnresolvedPaperBets: Number(json.profitEvidence.executedUnresolvedPaperBets ?? 0),
              historicalResolvedWithPredictions: Number(json.profitEvidence.historicalResolvedWithPredictions ?? 0),
            }
          : null,
        settlementReadiness: json.settlementReadiness && typeof json.settlementReadiness === 'object'
          ? {
              executedUnresolvedPaperBets: Number(json.settlementReadiness.executedUnresolvedPaperBets ?? 0),
              executedUnresolvedWithArchivedPrediction: Number(json.settlementReadiness.executedUnresolvedWithArchivedPrediction ?? 0),
              missingArchivedPrediction: Number(json.settlementReadiness.missingArchivedPrediction ?? 0),
              executedUnresolvedPaperBetMarkets: Number(json.settlementReadiness.executedUnresolvedPaperBetMarkets ?? 0),
              activeResolutionJobMarkets: Number(json.settlementReadiness.activeResolutionJobMarkets ?? 0),
              missingResolutionJobs: Number(json.settlementReadiness.missingResolutionJobs ?? 0),
              dueResolutionJobs: Number(json.settlementReadiness.dueResolutionJobs ?? 0),
              nextResolutionAt: typeof json.settlementReadiness.nextResolutionAt === 'string' ? json.settlementReadiness.nextResolutionAt : null,
              nextResolutionMarket: json.settlementReadiness.nextResolutionMarket && typeof json.settlementReadiness.nextResolutionMarket === 'object'
                ? {
                    id: String(json.settlementReadiness.nextResolutionMarket.id ?? ''),
                    title: String(json.settlementReadiness.nextResolutionMarket.title ?? ''),
                  }
                : null,
            }
          : null,
      });
      const paperBets = json.paperBets && typeof json.paperBets === 'object'
        ? json.paperBets as Record<string, unknown>
        : null;
      setPaperBetMeta(paperBets ? {
        totalBets: Number(paperBets.totalBets ?? 0),
        resolvedBets: Number(paperBets.resolvedBets ?? 0),
        pendingBets: Number(paperBets.pendingBets ?? 0),
        directionAccuracy: typeof paperBets.directionAccuracy === 'number' ? paperBets.directionAccuracy : null,
        avgBrierScore: typeof paperBets.avgBrierScore === 'number' ? paperBets.avgBrierScore : null,
        totalPnl: typeof paperBets.totalPnl === 'number' ? paperBets.totalPnl : null,
      } : null);
      const rawList = json.data ?? json.outcomes ?? json.recentResolved ?? json;
      const list = Array.isArray(rawList) ? rawList : [];
      const normalized = list.map((entry: Record<string, unknown>, index: number) => ({
        id: String(entry.id ?? `${entry.marketId ?? 'resolved'}-${index}`),
        marketId: String(entry.marketId ?? `resolved-${index}`),
        result: String(entry.result ?? entry.actualOutcome ?? 'NO'),
        resolvedProb: typeof entry.resolvedProb === 'number' ? entry.resolvedProb : null,
        resolvedAt: entry.resolvedAt ? String(entry.resolvedAt) : (entry.createdAt ? new Date(entry.createdAt as string | number | Date).toISOString() : new Date(0).toISOString()),
        predictedProb: typeof entry.predictedProb === 'number' ? entry.predictedProb : null,
        actualOutcome: typeof entry.actualOutcome === 'string' ? entry.actualOutcome : null,
        brierScore: typeof entry.brierScore === 'number' ? entry.brierScore : null,
        pnl: typeof entry.pnl === 'number' ? entry.pnl : null,
        market: entry.market && typeof entry.market === 'object' ? {
          id: String((entry.market as Record<string, unknown>).id ?? entry.marketId ?? `resolved-${index}`),
          title: String((entry.market as Record<string, unknown>).title ?? entry.title ?? 'Untitled market'),
          venue: String((entry.market as Record<string, unknown>).venue ?? ''),
          category: String((entry.market as Record<string, unknown>).category ?? ''),
        } : {
          id: String(entry.marketId ?? `resolved-${index}`),
          title: String(entry.title ?? 'Untitled market'),
          venue: '',
          category: '',
        },
      }));
      return { ...json, data: normalized };
    },
    [searchTerm],
  );

  function handleSort(field: SortField) {
    const dir = sortBy === field && sortOrder === 'desc' ? 'asc' : 'desc';
    setSort(field, dir);
  }


  // ── loading ──
  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-800" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-900" />
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
        <h2 className="text-xl font-semibold text-white">Outcomes</h2>
        <Card className="border-red-500/30 bg-gray-900">
          <CardContent className="flex flex-col items-center py-12">
            <XCircle className="mb-3 h-10 w-10 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <Button variant="outline" size="sm" className="mt-4 border-gray-700 text-gray-300 hover:bg-gray-800"
              onClick={() => { fetchData(); }}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── stats ──
  const correctCount = outcomes.filter((o) => {
    if (o.predictedProb === null) return false;
    const predictedSide = o.predictedProb >= 0.5 ? 'YES' : 'NO';
    return predictedSide === o.result;
  }).length;
  const winRate = outcomes.length > 0 ? correctCount / outcomes.length : 0;
  const winRatePct = winRate * 100;
  const totalPnl = outcomes.reduce((sum, o) => sum + (o.pnl ?? 0), 0);
  const avgBrier = outcomes.length > 0
    ? outcomes.reduce((sum, o) => sum + (o.brierScore ?? 0), 0) / Math.max(1, outcomes.filter((o) => o.brierScore !== null).length)
    : 0;
  const hasResolvedOutcomes = outcomes.length > 0;
  const nextSettlementAt = meta?.settlementReadiness?.nextResolutionAt ?? meta?.nextResolutionAt ?? null;
  const nextSettlementMarket = meta?.settlementReadiness?.nextResolutionMarket ?? meta?.nextResolutionMarket ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Outcomes</h2>
        <p className="mt-1 text-sm text-gray-500">
          Resolved market outcomes with prediction accuracy and PnL
        </p>
        {meta && meta.resolved === 0 && (
          <p className="mt-2 text-xs text-amber-300">
            {meta.settlementReadiness && meta.settlementReadiness.dueResolutionJobs > 0
              ? `${meta.settlementReadiness.dueResolutionJobs} paper resolution job${meta.settlementReadiness.dueResolutionJobs === 1 ? '' : 's'} are due now.`
              : `No paper bet is due to settle yet. Next scheduled check: ${nextSettlementAt ? new Date(nextSettlementAt).toLocaleString() : 'not scheduled'}.`}
          </p>
        )}
        {meta?.profitEvidence && !meta.profitEvidence.canEvaluateProfit && (
          <p className="mt-1 text-xs text-amber-300">
            {meta.profitEvidence.reason}
          </p>
        )}
        {meta?.settlementReadiness && (
          <p className="mt-1 text-xs text-gray-500">
            Settlement readiness: {meta.settlementReadiness.executedUnresolvedWithArchivedPrediction}/{meta.settlementReadiness.executedUnresolvedPaperBets} bets have archived predictions, {meta.settlementReadiness.activeResolutionJobMarkets}/{meta.settlementReadiness.executedUnresolvedPaperBetMarkets} markets have resolution jobs, {meta.settlementReadiness.dueResolutionJobs} due now.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total Resolved</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{meta?.resolved ?? total}</p>
            {meta && (
              <p className="text-[10px] text-gray-600">{meta.dueForResolution} due · {meta.pendingFuture} future</p>
            )}
          </CardContent>
        </Card>
        <Card className={cn('border bg-gray-900', !hasResolvedOutcomes ? 'border-gray-800' : winRatePct >= 60 ? 'border-emerald-500/20' : winRatePct >= 50 ? 'border-amber-500/20' : 'border-red-500/20')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Award className={cn('h-4 w-4', !hasResolvedOutcomes ? 'text-gray-500' : winRatePct >= 60 ? 'text-emerald-400' : winRatePct >= 50 ? 'text-amber-400' : 'text-red-400')} />
              <p className="text-xs text-gray-500">Win Rate</p>
            </div>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums',
              !hasResolvedOutcomes ? 'text-gray-400' : winRatePct >= 60 ? 'text-emerald-400' : winRatePct >= 50 ? 'text-amber-400' : 'text-red-400'
            )}>
              {hasResolvedOutcomes ? `${winRatePct.toFixed(1)}%` : '\u2014'}
            </p>
            <p className="text-[10px] text-gray-600">
              {hasResolvedOutcomes ? `${correctCount} of ${outcomes.length} correct` : 'waiting for first settlement'}
            </p>
            <Progress value={winRatePct} className={cn(
              'mt-1.5 h-1.5 bg-gray-800',
              winRatePct >= 60 ? '[&>div]:bg-emerald-500' : winRatePct >= 50 ? '[&>div]:bg-amber-500' : '[&>div]:bg-red-500'
            )} />
          </CardContent>
        </Card>
        <Card className={cn('border bg-gray-900', avgBrier <= 0.10 ? 'border-emerald-500/20' : avgBrier <= 0.20 ? 'border-amber-500/20' : 'border-red-500/20')}>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Avg Brier</p>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', brierColor(avgBrier))}>
              {outcomes.some((o) => o.brierScore !== null) ? avgBrier.toFixed(4) : '\u2014'}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Pending Bets</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-amber-400">{paperBetMeta?.pendingBets ?? 0}</p>
            <p className="text-[10px] text-gray-600">{paperBetMeta?.totalBets ?? 0} filled tracked</p>
          </CardContent>
        </Card>
        <Card className={cn('border bg-gray-900', totalPnl >= 0 ? 'border-emerald-500/20' : 'border-red-500/20')}>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total PnL</p>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', pnlColor(totalPnl))}>
              {hasResolvedOutcomes ? formatPnl(totalPnl) : '\u2014'}
            </p>
            {meta?.profitEvidence && !meta.profitEvidence.canEvaluateProfit && (
              <p className="text-[10px] text-gray-600">{meta.profitEvidence.status.toLowerCase().replace('_', ' ')}</p>
            )}
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Settlement Ready</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-cyan-400">
              {meta?.settlementReadiness
                ? `${meta.settlementReadiness.activeResolutionJobMarkets}/${meta.settlementReadiness.executedUnresolvedPaperBetMarkets}`
                : '\u2014'}
            </p>
            <p className="text-[10px] text-gray-600">
              {meta?.settlementReadiness
                ? `${meta.settlementReadiness.missingResolutionJobs} missing jobs · ${meta.settlementReadiness.missingArchivedPrediction} missing predictions`
                : 'waiting for settlement audit'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
        <Input
          placeholder="Search by market title..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="border-gray-800 bg-gray-900 pl-10 text-sm text-white placeholder:text-gray-600"
        />
      </div>

      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <Target className="h-4 w-4 text-emerald-400" />
            Resolved Markets
            <span className="ml-1 text-xs font-normal text-gray-500">({total})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {outcomes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                <CheckCircle className="h-6 w-6 text-gray-500" />
              </div>
              <p className="text-xs font-medium text-gray-400">No resolved outcomes yet</p>
              <p className="mt-1 max-w-md text-center text-[11px] text-gray-600">
                {meta?.dueForResolution
                  ? 'Resolution polling is due for one or more markets. Run the settlement cycle to score filled paper bets.'
                  : `Outcomes appear after traded markets settle and the scheduled paper resolution check runs${nextSettlementAt ? `; next check is ${new Date(nextSettlementAt).toLocaleString()}` : ''}.`}
              </p>
              {nextSettlementMarket && (
                <p className="mt-2 max-w-md truncate text-center text-[11px] text-gray-500">
                  {nextSettlementMarket.title}
                </p>
              )}
            </div>
          ) : (
            <>
              <p className="px-6 pb-2 text-xs text-gray-600">
                Showing {((page - 1) * limit) + 1}&ndash;{Math.min(page * limit, total)} of {total}
              </p>
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-transparent">
                      <TableHead className="text-gray-500">Market</TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('predictedProb')}>
                        <span className="inline-flex items-center gap-1">Predicted <SortIndicator active={sortBy === "predictedProb"} order={sortOrder} /></span>
                      </TableHead>
                      <TableHead className="text-gray-500">Result</TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('brierScore')}>
                        <span className="inline-flex items-center gap-1">Brier <SortIndicator active={sortBy === "brierScore"} order={sortOrder} /></span>
                      </TableHead>
                      <TableHead className="text-gray-500">Correct</TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('pnl')}>
                        <span className="inline-flex items-center gap-1">PnL <SortIndicator active={sortBy === "pnl"} order={sortOrder} /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('resolvedAt')}>
                        <span className="inline-flex items-center gap-1">Resolved <SortIndicator active={sortBy === "resolvedAt"} order={sortOrder} /></span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {outcomes.map((o) => {
                      const predictedSide = o.predictedProb !== null ? (o.predictedProb >= 0.5 ? 'YES' : 'NO') : null;
                      const correct = predictedSide ? predictedSide === o.result : null;
                      return (
                        <TableRow key={o.id} className="border-gray-800 transition-colors hover:bg-gray-800/50">
                          <TableCell>
                            <p className="max-w-[240px] truncate text-xs font-medium text-gray-200">
                              {o.market?.title ?? '\u2014'}
                            </p>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs tabular-nums text-gray-300">{formatPct(o.predictedProb)}</span>
                          </TableCell>
                          <TableCell>{outcomeBadge(o.result)}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn('text-xs font-medium tabular-nums', brierColor(o.brierScore))}>
                              {o.brierScore?.toFixed(4) ?? '\u2014'}
                            </span>
                          </TableCell>
                          <TableCell>{correctBadge(correct)}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn('text-xs font-medium tabular-nums', pnlColor(o.pnl))}>
                              {formatPnl(o.pnl)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs tabular-nums text-gray-500">
                              {new Date(o.resolvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
