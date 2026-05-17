'use client';

import { useEffect, useState, useMemo } from 'react';
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

// ── types ────────────────────────────────────────────────────────────────────

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
type SortDir = 'asc' | 'desc';

// ── helpers ──────────────────────────────────────────────────────────────────

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

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatPnl(value: number | null): string {
  if (value === null) return '—';
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatScore(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(4);
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

// ── component ────────────────────────────────────────────────────────────────

export function PaperBetsDashboard() {
  const [bets, setBets] = useState<PaperBet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [sortField, setSortField] = useState<SortField>('createdAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/paper-bets');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setBets(data.bets ?? data ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load paper bets');
          toast.error('Failed to load paper bets');
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

  const filtered = useMemo(() => {
    let list = bets;
    if (typeFilter !== 'ALL') {
      list = list.filter((b) => b.predictionType === typeFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (b) =>
          b.marketTitle?.toLowerCase().includes(q) ||
          b.market?.toLowerCase().includes(q) ||
          b.venue?.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const aNum = typeof av === 'number' ? av : new Date(av).getTime();
      const bNum = typeof bv === 'number' ? bv : new Date(bv).getTime();
      return sortDir === 'desc' ? bNum - aNum : aNum - bNum;
    });
  }, [bets, search, typeFilter, sortField, sortDir]);

  const SortIcon = sortDir === 'desc' ? ChevronDown : ChevronUp;

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
  const totalBets = bets.length;
  const settledBets = bets.filter((b) => b.actualOutcome !== null);
  const winCount = settledBets.filter((b) => b.actualOutcome === 'WIN').length;
  const winRate = settledBets.length > 0 ? winCount / settledBets.length : 0;
  const totalPnl = bets.reduce((sum, b) => sum + (b.pnl ?? 0), 0);
  const avgBrier = bets.length > 0
    ? bets.reduce((sum, b) => sum + (b.brierScore ?? 0), 0) / bets.filter((b) => b.brierScore !== null).length || 0
    : 0;
  const positiveEdgeCount = bets.filter((b) => b.edge > 0).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white">Paper Bets</h2>
        <p className="mt-1 text-sm text-gray-500">
          Paper trading bet history with probability calibration and P&L tracking
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total Bets</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{totalBets}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Win Rate</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">
              {settledBets.length > 0 ? formatPct(winRate) : '—'}
            </p>
          </CardContent>
        </Card>
        <Card className={cn(
          'bg-gray-900',
          totalPnl >= 0 ? 'border-emerald-500/20' : 'border-red-500/20'
        )}>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total P&L</p>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', pnlColor(totalPnl))}>
              {formatPnl(totalPnl)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-cyan-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Avg Brier</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-cyan-400">
              {bets.some((b) => b.brierScore !== null) ? avgBrier.toFixed(4) : '—'}
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
              ({filtered.length} of {totalBets})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
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
                        Edge {sortField === 'edge' && <SortIcon className="h-3 w-3" />}
                      </span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('confidence')}>
                      <span className="inline-flex items-center gap-1">
                        Conf {sortField === 'confidence' && <SortIcon className="h-3 w-3" />}
                      </span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('brierScore')}>
                      <span className="inline-flex items-center gap-1">
                        Brier {sortField === 'brierScore' && <SortIcon className="h-3 w-3" />}
                      </span>
                    </TableHead>
                    <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('pnl')}>
                      <span className="inline-flex items-center gap-1">
                        P&L {sortField === 'pnl' && <SortIcon className="h-3 w-3" />}
                      </span>
                    </TableHead>
                    <TableHead className="text-right text-gray-500">Outcome</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((b) => (
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
          )}
        </CardContent>
      </Card>
    </div>
  );
}
