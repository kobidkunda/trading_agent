'use client';

import { useState } from 'react';
import {
  Gauge,
  Loader2,
  XCircle,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Anchor,
  ShieldAlert,
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
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { usePagination } from '@/hooks/use-pagination';
import { PaginationBar } from '@/components/trading/PaginationBar';
import type { PaginationParams, PaginatedResponse } from '@/lib/types';

interface OrderbookMarket {
  id: string;
  marketId: string;
  marketTitle: string;
  venue: string;
  bestBid: number;
  bestAsk: number;
  spread: number;
  bidDepth: number;
  askDepth: number;
  depthImbalance: number;
  largeBidWall: number | null;
  largeAskWall: number | null;
  fillProbability: number | null;
  thinBookWarning: boolean;
  lastUpdated: string;
}

type SortField = 'spread' | 'bidDepth' | 'askDepth' | 'depthImbalance' | 'fillProbability' | 'capturedAt';

function formatPrice(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatDepth(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function spreadColor(spread: number): string {
  if (spread <= 0.01) return 'text-emerald-400';
  if (spread <= 0.03) return 'text-cyan-400';
  if (spread <= 0.05) return 'text-amber-400';
  return 'text-red-400';
}

function imbalanceColor(imbalance: number): string {
  if (Math.abs(imbalance) > 0.3) return 'text-amber-400';
  return 'text-gray-400';
}

function fillProbGauge(prob: number | null) {
  if (prob === null) return { width: '0%', color: 'bg-gray-700' };
  const pct = Math.min(Math.max(prob * 100, 0), 100);
  let color = 'bg-red-500';
  if (prob >= 0.8) color = 'bg-emerald-500';
  else if (prob >= 0.5) color = 'bg-cyan-500';
  else if (prob >= 0.3) color = 'bg-amber-500';
  return { width: `${pct}%`, color };
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

export function OrderbookDashboard() {
  const [searchTerm, setSearchTerm] = useState('');

  const {
    data: markets,
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
  } = usePagination<OrderbookMarket>(
    async (params: PaginationParams): Promise<PaginatedResponse<OrderbookMarket>> => {
      const query = new URLSearchParams({
        page: String(params.page),
        limit: String(params.limit),
        sortBy: params.sortBy || 'capturedAt',
        sortOrder: params.sortOrder || 'desc',
      });
      if (searchTerm.trim()) query.set('search', searchTerm.trim());
      const res = await fetch(`/api/orderbook?${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const rawList = raw.data ?? raw.markets ?? raw.snapshots ?? raw;
      const list = Array.isArray(rawList) ? rawList : [];
      const mapped = list.map((s: any) => ({
        id: String(s.id ?? ''),
        marketId: String(s.marketId ?? ''),
        marketTitle: String(s.marketTitle ?? s.market?.title ?? s.title ?? ''),
        venue: String(s.venue ?? s.market?.venue ?? ''),
        bestBid: Number(s.bestBid ?? 0),
        bestAsk: Number(s.bestAsk ?? 0),
        spread: Number(s.spread ?? 0),
        bidDepth: Number(s.bidDepth ?? 0),
        askDepth: Number(s.askDepth ?? 0),
        depthImbalance: Number(s.depthImbalance ?? 0),
        largeBidWall: s.largeBidWall != null ? Number(s.largeBidWall) : null,
        largeAskWall: s.largeAskWall != null ? Number(s.largeAskWall) : null,
        fillProbability: s.fillProbability != null ? Number(s.fillProbability) : null,
        thinBookWarning: Boolean(s.thinBookWarning ?? s.thinBookDanger ?? false),
        lastUpdated: String(s.lastUpdated ?? s.capturedAt ?? ''),
      }));
      return { ...raw, data: mapped };
    },
    [searchTerm],
  );

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
        <h2 className="text-xl font-semibold text-white">Orderbook</h2>
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
  const thinBookCount = markets.filter((m) => m.thinBookWarning).length;
  const whaleWallCount = markets.filter((m) => m.largeBidWall || m.largeAskWall).length;
  const avgSpread = markets.length > 0
    ? markets.reduce((sum, m) => sum + m.spread, 0) / markets.length
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white">Orderbook</h2>
        <p className="mt-1 text-sm text-gray-500">
          Depth view, whale wall detection, and fill probability analysis
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Markets Tracked</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{total}</p>
          </CardContent>
        </Card>
        <Card className={cn(
          'bg-gray-900',
          thinBookCount > 0 ? 'border-red-500/30' : 'border-gray-800'
        )}>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Thin Book Warnings</p>
            <p className={cn(
              'mt-1 text-2xl font-bold tabular-nums',
              thinBookCount > 0 ? 'text-red-400' : 'text-emerald-400'
            )}>
              {thinBookCount}
            </p>
          </CardContent>
        </Card>
        <Card className="border-amber-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Anchor Walls</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-amber-400">{whaleWallCount}</p>
          </CardContent>
        </Card>
        <Card className="border-cyan-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Avg Spread</p>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', spreadColor(avgSpread))}>
              {formatPct(avgSpread)}
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

      {/* Orderbook depth table */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <Gauge className="h-4 w-4 text-cyan-400" />
            Orderbook Depth
            <span className="ml-1 text-xs font-normal text-gray-500">({total})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {markets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                <Gauge className="h-6 w-6 text-gray-500" />
              </div>
              <p className="text-xs font-medium text-gray-400">No orderbook data</p>
              <p className="mt-1 text-[11px] text-gray-600">Orderbook data will appear as markets are tracked.</p>
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
                      <TableHead className="text-gray-500">Venue</TableHead>
                      <TableHead className="text-right text-gray-500">Best Bid</TableHead>
                      <TableHead className="text-right text-gray-500">Best Ask</TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('spread')}>
                        <span className="inline-flex items-center gap-1">Spread <SortIcon field="spread" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('bidDepth')}>
                        <span className="inline-flex items-center gap-1">Bid Depth <SortIcon field="bidDepth" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('askDepth')}>
                        <span className="inline-flex items-center gap-1">Ask Depth <SortIcon field="askDepth" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('depthImbalance')}>
                        <span className="inline-flex items-center gap-1">Imbalance <SortIcon field="depthImbalance" /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-center text-gray-500 hover:text-gray-300" onClick={() => handleSort('fillProbability')}>
                        <span className="inline-flex items-center gap-1">Fill Prob <SortIcon field="fillProbability" /></span>
                      </TableHead>
                      <TableHead className="text-gray-500">Warnings</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {markets.map((m) => {
                      const gauge = fillProbGauge(m.fillProbability);
                      return (
                        <TableRow
                          key={m.id}
                          className={cn(
                            'border-gray-800 transition-colors hover:bg-gray-800/50',
                            m.thinBookWarning && 'bg-red-500/5'
                          )}
                        >
                          <TableCell>
                            <p className="max-w-[200px] truncate text-xs font-medium text-gray-200">
                              {m.marketTitle}
                            </p>
                          </TableCell>
                          <TableCell>{venueBadge(m.venue)}</TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs tabular-nums text-emerald-400">{formatPrice(m.bestBid)}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs tabular-nums text-red-400">{formatPrice(m.bestAsk)}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={cn('text-xs font-medium tabular-nums', spreadColor(m.spread))}>
                              {formatPct(m.spread)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs tabular-nums text-gray-300">{formatDepth(m.bidDepth)}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs tabular-nums text-gray-300">{formatDepth(m.askDepth)}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {m.depthImbalance > 0.1 ? (
                                <TrendingUp className="h-3 w-3 text-emerald-400" />
                              ) : m.depthImbalance < -0.1 ? (
                                <TrendingDown className="h-3 w-3 text-red-400" />
                              ) : null}
                              <span className={cn('text-xs tabular-nums', imbalanceColor(m.depthImbalance))}>
                                {m.depthImbalance > 0 ? '+' : ''}{(m.depthImbalance * 100).toFixed(0)}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="w-28">
                            <div className="mx-auto h-2 w-20 overflow-hidden rounded-full bg-gray-800">
                              <div
                                className={cn('h-full rounded-full transition-all', gauge.color)}
                                style={{ width: gauge.width }}
                              />
                            </div>
                            <p className="mt-1 text-center text-[10px] text-gray-500">
                              {m.fillProbability !== null ? `${(m.fillProbability * 100).toFixed(0)}%` : '\u2014'}
                            </p>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1">
                              {m.thinBookWarning && (
                                <span title="Thin book warning">
                                  <ShieldAlert className="h-3.5 w-3.5 text-red-400" />
                                </span>
                              )}
                              {(m.largeBidWall || m.largeAskWall) && (
                                <span title="Anchor wall detected">
                                  <Anchor className="h-3.5 w-3.5 text-amber-400" />
                                </span>
                              )}
                              {!m.thinBookWarning && !m.largeBidWall && !m.largeAskWall && (
                                <span className="text-xs text-gray-600">\u2014</span>
                              )}
                            </div>
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

      {/* Anchor Walls detail */}
      {whaleWallCount > 0 && (
        <Card className="border-amber-500/20 bg-gray-900">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-white">
              <Anchor className="h-4 w-4 text-amber-400" />
              Anchor Walls Detected
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[300px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-500">Market</TableHead>
                    <TableHead className="text-right text-gray-500">Bid Wall</TableHead>
                    <TableHead className="text-right text-gray-500">Ask Wall</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {markets.filter((m) => m.largeBidWall || m.largeAskWall).map((m) => (
                    <TableRow key={m.id} className="border-gray-800 transition-colors hover:bg-gray-800/50">
                      <TableCell>
                        <p className="max-w-[300px] truncate text-xs font-medium text-gray-200">{m.marketTitle}</p>
                      </TableCell>
                      <TableCell className="text-right">
                        {m.largeBidWall ? (
                          <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-[10px]">
                            {formatDepth(m.largeBidWall)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-gray-600">\u2014</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.largeAskWall ? (
                          <Badge className="border-red-500/30 bg-red-500/10 text-red-400 text-[10px]">
                            {formatDepth(m.largeAskWall)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-gray-600">\u2014</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
