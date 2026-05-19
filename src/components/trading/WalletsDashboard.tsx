'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Wallet,
  Users,
  Signal,
  Search,
  Loader2,
  XCircle,
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
import { cn } from '@/lib/utils';
import { usePagination } from '@/hooks/use-pagination';
import { PaginationBar } from '@/components/trading/PaginationBar';
import type { PaginationParams, PaginatedResponse } from '@/lib/types';

// ── types ────────────────────────────────────────────────────────────────────

interface WalletRecord {
  id: string;
  address: string;
  winRate: number;
  profitFactor: number;
  realizedPnl: number;
  brierScore: number | null;
  categorySpecialization: string | null;
  rank: number;
  totalBets: number;
  lastActive: string | null;
}

interface ClusterActivity {
  id: string;
  marketId: string;
  marketTitle: string;
  walletCount: number;
  wallets: string[];
  detectedAt: string;
  action: string;
}

interface CopySignal {
  id: string;
  walletAddress: string;
  marketTitle: string;
  action: string;
  confidence: number;
  timestamp: string;
  pnl: number | null;
}

interface WalletsApiResponse extends PaginatedResponse<WalletRecord> {
  clusters?: ClusterActivity[];
  signals?: CopySignal[];
  totalWallets?: number;
  profitableCount?: number;
  avgWinRate?: number;
  activeClusters?: number;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function pnlColor(value: number): string {
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-red-400';
  return 'text-gray-400';
}

function winRateColor(value: number): string {
  if (value >= 0.65) return 'text-emerald-400';
  if (value >= 0.50) return 'text-amber-400';
  return 'text-red-400';
}

function formatPnl(value: number): string {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function truncateAddress(addr: string): string {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function rankBadge(rank: number) {
  if (rank === 1) return <Badge className="border-yellow-500/30 bg-yellow-500/10 text-yellow-400 text-[10px]">🥇 #{rank}</Badge>;
  if (rank === 2) return <Badge className="border-gray-400/30 bg-gray-400/10 text-gray-300 text-[10px]">🥈 #{rank}</Badge>;
  if (rank === 3) return <Badge className="border-amber-600/30 bg-amber-600/10 text-amber-500 text-[10px]">🥉 #{rank}</Badge>;
  return <Badge variant="outline" className="border-gray-700 text-gray-400 text-[10px]">#{rank}</Badge>;
}

// ── component ────────────────────────────────────────────────────────────────

export function WalletsDashboard() {
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<string>('ALL');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [clusters, setClusters] = useState<ClusterActivity[]>([]);
  const [signals, setSignals] = useState<CopySignal[]>([]);
  const [extraStats, setExtraStats] = useState<{
    totalWallets: number;
    profitableCount: number;
    avgWinRate: number;
    activeClusters: number;
  } | null>(null);

  // Fetch clusters and side stats (separate from paginated wallets)
  useEffect(() => {
    let cancelled = false;
    async function loadExtras() {
      try {
        const res = await fetch('/api/wallets?limit=5');
        if (!cancelled && res.ok) {
          const json = await res.json();
          setClusters(json.clusters ?? []);
          setSignals(json.signals ?? []);
          if (json.totalWallets != null) {
            setExtraStats({
              totalWallets: json.totalWallets,
              profitableCount: json.profitableCount ?? 0,
              avgWinRate: json.avgWinRate ?? 0,
              activeClusters: json.activeClusters ?? (json.clusters?.length ?? 0),
            });
          }
        }
      } catch { /* non-critical */ }
    }
    loadExtras();
    return () => { cancelled = true; };
  }, []);

  // Debounce search to avoid per-keystroke API calls
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const {
    data: wallets,
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
  } = usePagination<WalletRecord>(
    async (params: PaginationParams): Promise<PaginatedResponse<WalletRecord>> => {
      const query = new URLSearchParams({
        page: String(params.page),
        limit: String(params.limit),
        sortBy: params.sortBy ?? 'rank',
        sortOrder: params.sortOrder ?? 'asc',
      });
      if (debouncedSearch.trim()) query.set('search', debouncedSearch.trim());
      if (catFilter !== 'ALL') query.set('category', catFilter);

      const res = await fetch(`/api/wallets?${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    [debouncedSearch, catFilter],
    { defaultSortBy: 'rank', defaultSortOrder: 'asc' },
  );

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSort(field, sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      const defaultOrder = field === 'rank' ? 'asc' : 'desc';
      setSort(field, defaultOrder);
    }
  };

  const SortIcon = sortOrder === 'desc' ? ChevronDown : ChevronUp;

  // Categories for filter dropdown (from server or static)
  const categories = useMemo(() => {
    if (extraStats) return []; // categories come from server / full dataset
    return [];
  }, [extraStats]);

  // ── loading ──
  if (loading && wallets.length === 0) {
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
  if (error && wallets.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Wallets</h2>
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

  // ── stats ──
  const totalWallets = extraStats?.totalWallets ?? total;
  const profitableCount = extraStats?.profitableCount ?? 0;
  const avgWinRate = extraStats?.avgWinRate ?? 0;
  const activeClusters = extraStats?.activeClusters ?? clusters.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white">Wallets</h2>
        <p className="mt-1 text-sm text-gray-500">
          Top wallet rankings, cluster activity, and copy-signal history
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Tracked Wallets</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{totalWallets}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Profitable</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">{profitableCount}</p>
          </CardContent>
        </Card>
        <Card className="border-cyan-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Avg Win Rate</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-cyan-400">{formatPct(avgWinRate)}</p>
          </CardContent>
        </Card>
        <Card className="border-amber-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Active Clusters</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-amber-400">{activeClusters}</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Clusters */}
      {clusters.length > 0 && (
        <Card className="border-gray-800 bg-gray-900">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-white">
              <Users className="h-4 w-4 text-amber-400" />
              Recent Cluster Activity
              <span className="ml-1 text-xs font-normal text-gray-500">({clusters.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[300px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-500">Market</TableHead>
                    <TableHead className="text-gray-500">Wallets</TableHead>
                    <TableHead className="text-gray-500">Action</TableHead>
                    <TableHead className="text-right text-gray-500">Detected</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clusters.map((c) => (
                    <TableRow key={c.id} className="border-gray-800 transition-colors hover:bg-gray-800/50">
                      <TableCell>
                        <p className="max-w-[300px] truncate text-xs font-medium text-gray-200">
                          {c.marketTitle}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px]">
                            {c.walletCount} wallets
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={cn(
                          'border-transparent text-[10px] text-white',
                          c.action === 'BID' ? 'bg-emerald-600' : 'bg-red-600'
                        )}>
                          {c.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs text-gray-500">
                          {new Date(c.detectedAt).toLocaleDateString()}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input
            placeholder="Search by address or category..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border-gray-800 bg-gray-900 pl-10 text-sm text-white placeholder:text-gray-600"
          />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-[200px] border-gray-800 bg-gray-900 text-sm text-gray-300">
            <Filter className="mr-2 h-3.5 w-3.5 text-gray-500" />
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>
          <SelectContent className="border-gray-800 bg-gray-900 text-gray-300">
            <SelectItem value="ALL">All Categories</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Wallets table */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <Wallet className="h-4 w-4 text-emerald-400" />
            Wallet Rankings
            <span className="ml-1 text-xs font-normal text-gray-500">
              ({(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {wallets.length === 0 && !loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                <Wallet className="h-6 w-6 text-gray-500" />
              </div>
              <p className="text-xs font-medium text-gray-400">No wallets found</p>
              <p className="mt-1 text-[11px] text-gray-600">
                {search || catFilter !== 'ALL'
                  ? 'Try adjusting your filters.'
                  : 'Wallet data will appear as trading data is collected.'}
              </p>
            </div>
          ) : (
            <>
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-transparent">
                      <TableHead className="w-12 text-gray-500">#</TableHead>
                      <TableHead className="text-gray-500">Address</TableHead>
                      <TableHead className="text-gray-500">Category</TableHead>
                      <TableHead
                        className="cursor-pointer text-right text-gray-500 hover:text-gray-300 select-none"
                        onClick={() => handleSort('winRate')}
                      >
                        <span className="inline-flex items-center gap-1">
                          Win Rate {sortBy === 'winRate' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer text-right text-gray-500 hover:text-gray-300 select-none"
                        onClick={() => handleSort('profitFactor')}
                      >
                        <span className="inline-flex items-center gap-1">
                          Profit Factor {sortBy === 'profitFactor' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer text-right text-gray-500 hover:text-gray-300 select-none"
                        onClick={() => handleSort('realizedPnl')}
                      >
                        <span className="inline-flex items-center gap-1">
                          Realized PnL {sortBy === 'realizedPnl' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer text-right text-gray-500 hover:text-gray-300 select-none"
                        onClick={() => handleSort('brierScore')}
                      >
                        <span className="inline-flex items-center gap-1">
                          Brier {sortBy === 'brierScore' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
                      <TableHead className="text-right text-gray-500">Total Bets</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {wallets.map((w) => (
                      <TableRow key={w.id} className={cn(
                        'border-gray-800 transition-colors hover:bg-gray-800/50',
                        w.realizedPnl > 0 && 'bg-emerald-500/5',
                        w.realizedPnl < 0 && 'bg-red-500/5'
                      )}>
                        <TableCell>{rankBadge(w.rank)}</TableCell>
                        <TableCell>
                          <span className="font-mono text-xs text-gray-300">{truncateAddress(w.address)}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-gray-400">{w.categorySpecialization ?? '—'}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn('text-xs font-medium tabular-nums', winRateColor(w.winRate))}>
                            {formatPct(w.winRate)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs tabular-nums text-gray-300">
                            {w.profitFactor.toFixed(2)}x
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn('text-xs font-medium tabular-nums', pnlColor(w.realizedPnl))}>
                            {formatPnl(w.realizedPnl)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs tabular-nums text-gray-400">
                            {w.brierScore !== null ? w.brierScore.toFixed(4) : '—'}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs tabular-nums text-gray-400">{w.totalBets}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {/* Info bar + Pagination */}
              <div className="flex items-center justify-between border-t border-gray-800 px-4 py-3">
                <span className="text-xs text-gray-500">
                  Showing {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total} wallets
                </span>
                {loading && (
                  <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
                )}
                <PaginationBar page={page} totalPages={totalPages} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Copy Signals */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <Signal className="h-4 w-4 text-cyan-400" />
            Copy Signal History
            <span className="ml-1 text-xs font-normal text-gray-500">({signals.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {signals.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-800">
                <Signal className="h-5 w-5 text-gray-500" />
              </div>
              <p className="text-xs font-medium text-gray-400">No copy signals yet</p>
              <p className="mt-1 text-[11px] text-gray-600">Signals will appear as wallet activity is detected.</p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-500">Wallet</TableHead>
                    <TableHead className="text-gray-500">Market</TableHead>
                    <TableHead className="text-gray-500">Action</TableHead>
                    <TableHead className="text-right text-gray-500">Confidence</TableHead>
                    <TableHead className="text-right text-gray-500">PnL</TableHead>
                    <TableHead className="text-right text-gray-500">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {signals.map((s) => (
                    <TableRow key={s.id} className="border-gray-800 transition-colors hover:bg-gray-800/50">
                      <TableCell>
                        <span className="font-mono text-xs text-gray-300">{truncateAddress(s.walletAddress)}</span>
                      </TableCell>
                      <TableCell>
                        <p className="max-w-[200px] truncate text-xs text-gray-200">{s.marketTitle}</p>
                      </TableCell>
                      <TableCell>
                        <Badge className={cn(
                          'border-transparent text-[10px] text-white',
                          s.action === 'BID' ? 'bg-emerald-600' : s.action === 'SKIP' ? 'bg-gray-600' : 'bg-amber-600'
                        )}>
                          {s.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-300">{formatPct(s.confidence)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cn('text-xs font-medium tabular-nums', pnlColor(s.pnl ?? 0))}>
                          {s.pnl !== null ? formatPnl(s.pnl) : '—'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs text-gray-500">
                          {new Date(s.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
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
