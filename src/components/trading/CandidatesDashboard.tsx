'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Search,
  ChevronUp,
  ChevronDown,
  Target,
  Filter,
  Loader2,
  ArrowUpDown,
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
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { STAGE_COLORS } from '@/lib/constants';
import type { CandidateStage } from '@/lib/types';

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

type SortField = 'candidateScore' | 'biasAdjustedProb' | 'adjustedEdge' | 'createdAt';
type SortDir = 'asc' | 'desc';

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

// ── component ────────────────────────────────────────────────────────────────

export function CandidatesDashboard() {
  const [candidates, setCandidates] = useState<CandidateRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState<string>('ALL');
  const [sortField, setSortField] = useState<SortField>('candidateScore');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/trading/candidates');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setCandidates(data.candidates ?? data ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load candidates');
          toast.error('Failed to load candidates');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const stages = useMemo(() => {
    const set = new Set(candidates.map((c) => c.stage));
    return Array.from(set).sort();
  }, [candidates]);

  const filtered = useMemo(() => {
    let list = candidates;
    if (stageFilter !== 'ALL') {
      list = list.filter((c) => c.stage === stageFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          c.market?.title?.toLowerCase().includes(q) ||
          c.market?.category?.toLowerCase().includes(q) ||
          c.market?.venue?.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      const aNum = av === null ? -Infinity : (typeof av === 'number' ? av : 0);
      const bNum = bv === null ? -Infinity : (typeof bv === 'number' ? bv : 0);
      return sortDir === 'desc' ? bNum - aNum : aNum - bNum;
    });
  }, [candidates, search, stageFilter, sortField, sortDir]);

  const SortIcon = sortDir === 'desc' ? ChevronDown : ChevronUp;

  // ── loading ──
  if (loading) {
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

  // ── error ──
  if (error) {
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
  const totalCount = candidates.length;
  const highScoreCount = candidates.filter((c) => (c.candidateScore ?? 0) >= 90).length;
  const positiveEdgeCount = candidates.filter((c) => (c.adjustedEdge ?? 0) > 0).length;
  const skippedCount = candidates.filter((c) => c.skipReason).length;

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
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{totalCount}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">A+ Score (≥90)</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">{highScoreCount}</p>
          </CardContent>
        </Card>
        <Card className="border-cyan-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Positive Edge</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-cyan-400">{positiveEdgeCount}</p>
          </CardContent>
        </Card>
        <Card className="border-red-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Skipped</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-red-400">{skippedCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input
            placeholder="Search by market title, category, or venue..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-gray-800 bg-gray-900 pl-10 text-sm text-white placeholder:text-gray-600"
          />
        </div>
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-[180px] border-gray-800 bg-gray-900 text-sm text-gray-300">
            <Filter className="mr-2 h-3.5 w-3.5 text-gray-500" />
            <SelectValue placeholder="All Stages" />
          </SelectTrigger>
          <SelectContent className="border-gray-800 bg-gray-900 text-gray-300">
            <SelectItem value="ALL">All Stages</SelectItem>
            {stages.map((s) => (
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
              ({filtered.length} of {totalCount})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                <Target className="h-6 w-6 text-gray-500" />
              </div>
              <p className="text-xs font-medium text-gray-400">No candidates found</p>
              <p className="mt-1 text-[11px] text-gray-600">
                {search || stageFilter !== 'ALL'
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
                    <TableHead className="cursor-pointer text-gray-500 hover:text-gray-300" onClick={() => handleSort('candidateScore')}>
                      <span className="inline-flex items-center gap-1">
                        Score {sortField === 'candidateScore' && <SortIcon className="h-3 w-3" />}
                      </span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('biasAdjustedProb')}>
                      <span className="inline-flex items-center gap-1">
                        Adj Prob {sortField === 'biasAdjustedProb' && <SortIcon className="h-3 w-3" />}
                      </span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('adjustedEdge')}>
                      <span className="inline-flex items-center gap-1">
                        Edge {sortField === 'adjustedEdge' && <SortIcon className="h-3 w-3" />}
                      </span>
                    </TableHead>
                    <TableHead className="text-right text-gray-500">Wallet</TableHead>
                    <TableHead className="text-right text-gray-500">Skip Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((c) => (
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
    </div>
  );
}
