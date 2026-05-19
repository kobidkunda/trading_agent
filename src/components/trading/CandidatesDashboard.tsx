'use client';

import { useState } from 'react';
import {
  Search,
  ChevronUp,
  ChevronDown,
  Target,
  Filter,
  Loader2,
  XCircle,
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
import { STAGE_COLORS } from '@/lib/constants';
import { usePagination } from '@/hooks/use-pagination';
import { PaginationBar } from '@/components/trading/PaginationBar';
import type { PaginatedResponse, PaginationParams } from '@/lib/types';

// ── types ────────────────────────────────────────────────────────────────────

interface CandidateRecord {
  id: string;
  marketId: string;
  stage: string;
  triageStatus: string | null;
  candidateScore: number | null;
  biasAdjustedProb: number | null;
  adjustedEdge: number | null;
  walletSignalScore: number | null;
  skipReason: string | null;
  acceptedCriteria: string | null;
  rejectedCriteria: string | null;
  rawEdge: number | null;
  createdAt: string;
  market: {
    id: string;
    title: string;
    venue: string;
    category: string;
    status: string;
  } | null;
}

const KNOWN_STAGES = [
  'SCANNED', 'SCORED', 'DEDUPED', 'TRIAGED',
  'DEERFLOW_RESEARCHED', 'FULL_RESEARCHED', 'DEBATED',
  'POST_DEBATE_PREDICTED', 'ENSEMBLED', 'BIAS_CORRECTED',
  'RISK_CHECKED', 'PAPER_EXECUTED', 'EXECUTED', 'SETTLED',
];

// ── helpers ──────────────────────────────────────────────────────────────────

function stageBadge(stage: string) {
  const colorClass = STAGE_COLORS[stage] ?? 'bg-gray-500';
  return (
    <Badge className={cn('border-transparent text-[10px] text-white', colorClass)}>
      {stage}
    </Badge>
  );
}

function scoreColor(score: number | null): string {
  if (score === null) return 'text-gray-500';
  if (score >= 90) return 'text-emerald-400';
  if (score >= 70) return 'text-cyan-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}

function edgeColor(edge: number | null): string {
  if (edge === null) return 'text-gray-500';
  if (edge >= 0.1) return 'text-emerald-400';
  if (edge >= 0.05) return 'text-cyan-400';
  if (edge >= 0) return 'text-amber-400';
  return 'text-red-400';
}

function venueBadge(venue: string) {
  const colors: Record<string, string> = {
    POLYMARKET: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
    KALSHI: 'border-purple-500/30 bg-purple-500/10 text-purple-400',
    SX_BET: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    MANIFOLD: 'border-orange-500/30 bg-orange-500/10 text-orange-400',
  };
  return (
    <Badge variant="outline" className={cn('text-[10px]', colors[venue] ?? 'border-gray-700 text-gray-400')}>
      {venue}
    </Badge>
  );
}

function formatPct(value: number | null): string {
  if (value === null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function formatScore(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(1);
}

const SORT_LABELS: Record<string, string> = {
  candidateScore: 'Score',
  biasAdjustedProb: 'Adj Prob',
  adjustedEdge: 'Edge',
  createdAt: 'Created',
};

// ── component ────────────────────────────────────────────────────────────────

export function CandidatesDashboard() {
  const [searchTerm, setSearchTerm] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('ALL');

  const {
    data: candidates,
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
  } = usePagination<CandidateRecord>(
    async (params: PaginationParams): Promise<PaginatedResponse<CandidateRecord>> => {
      const query = new URLSearchParams({
        page: String(params.page),
        limit: String(params.limit),
        sortBy: params.sortBy || 'candidateScore',
        sortOrder: params.sortOrder || 'desc',
      });
      if (searchTerm.trim()) query.set('search', searchTerm.trim());
      if (stageFilter !== 'ALL') query.set('stage', stageFilter);
      const res = await fetch(`/api/trading/candidates?${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    [searchTerm, stageFilter],
    { defaultSortBy: 'candidateScore', defaultSortOrder: 'desc' },
  );

  const handleSearch = () => {
    fetchData();
  };

  const SortIcon = sortOrder === 'desc' ? ChevronDown : ChevronUp;

  // ── loading (initial only — no data yet) ──
  if (loading && candidates.length === 0) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-800" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-900" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  // ── error (initial — no data yet) ──
  if (error && candidates.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Trade Candidates</h2>
        <Card className="border-red-500/30 bg-gray-900">
          <CardContent className="flex flex-col items-center py-12">
            <XCircle className="mb-3 h-10 w-10 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-4 border-gray-700 text-gray-300 hover:bg-gray-800"
              onClick={() => fetchData()}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Trade Candidates</h2>
          <p className="mt-1 text-sm text-gray-500">
            Pipeline candidates with scoring, edge estimates, and wallet signals
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total Candidates</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{total}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Page</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">
              {page} / {totalPages || 1}
            </p>
          </CardContent>
        </Card>
        <Card className="border-cyan-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Sort</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-cyan-400">
              {SORT_LABELS[sortBy ?? ''] ?? sortBy ?? 'Score'}
            </p>
          </CardContent>
        </Card>
        <Card className="border-amber-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Per Page</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-amber-400">{limit}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input
            placeholder="Search by market title, category, or venue..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="border-gray-800 bg-gray-900 pl-10 text-sm text-white placeholder:text-gray-600"
          />
        </div>
        <Select value={stageFilter} onValueChange={(v) => setStageFilter(v)}>
          <SelectTrigger className="w-[180px] border-gray-800 bg-gray-900 text-sm text-gray-300">
            <Filter className="mr-2 h-3.5 w-3.5 text-gray-500" />
            <SelectValue placeholder="All Stages" />
          </SelectTrigger>
          <SelectContent className="border-gray-800 bg-gray-900 text-gray-300">
            <SelectItem value="ALL">All Stages</SelectItem>
            {KNOWN_STAGES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Candidates table */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <Target className="h-4 w-4 text-emerald-400" />
            Candidates
            <span className="ml-1 text-xs font-normal text-gray-500">
              ({candidates.length} of {total})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="relative p-0">
          {loading && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-b-xl bg-gray-900/60">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-400" />
            </div>
          )}
          {candidates.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                <Target className="h-6 w-6 text-gray-500" />
              </div>
              <p className="text-xs font-medium text-gray-400">No candidates found</p>
              <p className="mt-1 text-[11px] text-gray-600">
                {searchTerm || stageFilter !== 'ALL'
                  ? 'Try adjusting your filters.'
                  : 'Candidates will appear as markets are scanned.'}
              </p>
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-500">Market</TableHead>
                    <TableHead className="text-gray-500">Venue</TableHead>
                    <TableHead className="text-gray-500">Category</TableHead>
                    <TableHead className="text-gray-500">Stage</TableHead>
                    <TableHead className="cursor-pointer text-gray-500 hover:text-gray-300" onClick={() => setSort('candidateScore')}>
                      <span className="inline-flex items-center gap-1">
                        Score {sortBy === 'candidateScore' && <SortIcon className="h-3 w-3" />}
                      </span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => setSort('biasAdjustedProb')}>
                      <span className="inline-flex items-center gap-1">
                        Adj Prob {sortBy === 'biasAdjustedProb' && <SortIcon className="h-3 w-3" />}
                      </span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => setSort('adjustedEdge')}>
                      <span className="inline-flex items-center gap-1">
                        Edge {sortBy === 'adjustedEdge' && <SortIcon className="h-3 w-3" />}
                      </span>
                    </TableHead>
                    <TableHead className="text-right text-gray-500">Wallet</TableHead>
                    <TableHead className="text-right text-gray-500">Skip Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {candidates.map((c) => (
                    <TableRow key={c.id} className="border-gray-800 transition-colors hover:bg-gray-800/50">
                      <TableCell>
                        <p className="max-w-[220px] truncate text-xs font-medium text-gray-200">
                          {c.market?.title ?? '—'}
                        </p>
                      </TableCell>
                      <TableCell>{venueBadge(c.market?.venue ?? '')}</TableCell>
                      <TableCell>
                        <span className="text-xs text-gray-400">{c.market?.category ?? '—'}</span>
                      </TableCell>
                      <TableCell>{stageBadge(c.stage)}</TableCell>
                      <TableCell>
                        <span className={cn('text-xs font-bold tabular-nums', scoreColor(c.candidateScore))}>
                          {formatScore(c.candidateScore)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-300">{formatPct(c.biasAdjustedProb)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cn('text-xs font-medium tabular-nums', edgeColor(c.adjustedEdge))}>
                          {formatPct(c.adjustedEdge)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cn('text-xs tabular-nums', scoreColor(c.walletSignalScore))}>
                          {formatScore(c.walletSignalScore)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {c.skipReason ? (
                          <span className="max-w-[140px] truncate text-xs text-red-400/80" title={c.skipReason}>
                            {c.skipReason}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-600">—</span>
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

      {/* Pagination bar */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">
          Showing {candidates.length > 0 ? (page - 1) * limit + 1 : 0}&ndash;{Math.min(page * limit, total)} of {total}
        </span>
        <PaginationBar page={page} totalPages={totalPages} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>
    </div>
  );
}
