'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Gauge,
  XCircle,
  TrendingUp,
  TrendingDown,
  Anchor,
  ShieldAlert,
  Search,
  ChevronUp,
  ChevronDown,
  Activity,
  RefreshCw,
  Waves,
  Database,
  Clock3,
  ExternalLink,
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
import { cn } from '@/lib/utils';
import { usePagination } from '@/hooks/use-pagination';
import { PaginationBar } from '@/components/trading/PaginationBar';
import type { PaginationParams, PaginatedResponse } from '@/lib/types';

interface OrderbookMarket {
  id: string;
  marketId: string;
  marketTitle: string;
  venue: string;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  bidDepth: number | null;
  askDepth: number | null;
  depthImbalance: number | null;
  largeBidWall: number | null;
  largeAskWall: number | null;
  fillProbability: number | null;
  thinBookWarning: boolean;
  dataQuality?: string;
  lastUpdated: string;
  tentativeSettlementAt: string | null;
  settlementStatus: 'SETTLED' | 'DUE' | 'PENDING';
}

interface OrderbookLevel {
  price: number;
  size: number;
  side?: 'BID' | 'ASK';
}

function SortIndicator({ active, order }: { active: boolean; order: 'asc' | 'desc' }) {
  if (!active) return <ChevronDown className="ml-1 h-3 w-3 text-gray-600" />;
  return order === 'desc' ? <ChevronDown className="ml-1 h-3 w-3" /> : <ChevronUp className="ml-1 h-3 w-3" />;
}

interface OrderbookDetail {
  market: {
    id: string;
    title: string;
    venue: string;
    category: string;
    externalId: string;
    status: string;
    latestPrice: number | null;
    latestSpread: number | null;
    latestLiquidity: number | null;
    lastSnapshotAt: string | null;
    isResolved: boolean;
    resolutionTime: string | null;
  } | null;
  snapshot: {
    id: string;
    marketId: string;
    orderbookSource: string | null;
    spreadSource: string | null;
    bestBid: number | null;
    bestAsk: number | null;
    spread: number | null;
    bidDepth: number | null;
    askDepth: number | null;
    depthImbalance: number | null;
    largeBidWall: number | null;
    largeAskWall: number | null;
    thinBookDanger: boolean;
    priceImpact: number | null;
    fillProbability: number | null;
    recentMovement: number | null;
    depthDecay: number | null;
    capturedAt: string;
    dataQuality?: string;
  };
  recentSnapshots: Array<{
    id: string;
    capturedAt: string;
    bestBid: number | null;
    bestAsk: number | null;
    spread: number | null;
    bidDepth: number | null;
    askDepth: number | null;
    depthImbalance: number | null;
    thinBookDanger: boolean;
    largeBidWall: number | null;
    largeAskWall: number | null;
    fillProbability: number | null;
    recentMovement: number | null;
    depthDecay: number | null;
  }>;
  analysis: {
    depthImbalance?: { imbalance?: number | null } | null;
    whaleWalls?: {
      bidWalls?: Array<{ price: number; size: number }>;
      askWalls?: Array<{ price: number; size: number }>;
    } | null;
    thinBookDanger?: boolean;
    priceImpact?: number | null;
    fillProbability?: number | null;
    recentMovement?: number | null;
    depthDecay?: number | null;
    levels?: OrderbookLevel[] | null;
    orderbookQualityScore?: number | null;
  };
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

function formatPctNullable(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  return formatPct(value);
}

function formatWholePctNullable(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  const pct = value * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${pct.toFixed(0)}%`;
}

function formatPriceNullable(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  return formatPrice(value);
}

function formatDepthNullable(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  return formatDepth(value);
}

function formatSignedPct(value: number | null | undefined): string {
  if (typeof value !== 'number') return '—';
  const pct = value * 100;
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function formatTentativeSettlement(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function deriveSettlementStatus(input: {
  settlementStatus?: string | null;
  isResolved?: boolean | null;
  status?: string | null;
  resolutionTime?: string | null;
}): 'SETTLED' | 'DUE' | 'PENDING' {
  if (input.settlementStatus === 'SETTLED' || input.isResolved || input.status === 'RESOLVED') return 'SETTLED';
  if (!input.resolutionTime) return 'PENDING';
  const date = new Date(input.resolutionTime);
  if (!Number.isNaN(date.getTime()) && date.getTime() <= Date.now()) return 'DUE';
  return 'PENDING';
}

function settlementStatusBadge(status: 'SETTLED' | 'DUE' | 'PENDING') {
  const styles = {
    SETTLED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    DUE: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    PENDING: 'border-gray-600/30 bg-gray-700/20 text-gray-400',
  };
  return (
    <Badge variant="outline" className={cn('text-[10px]', styles[status])}>
      {status === 'SETTLED' ? 'Done' : status === 'DUE' ? 'Due' : 'Not done'}
    </Badge>
  );
}

function spreadColor(spread: number): string {
  if (spread <= 0.01) return 'text-emerald-400';
  if (spread <= 0.03) return 'text-cyan-400';
  if (spread <= 0.05) return 'text-amber-400';
  return 'text-red-400';
}

function spreadColorNullable(spread: number | null | undefined): string {
  if (typeof spread !== 'number') return 'text-gray-500';
  return spreadColor(spread);
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
  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderbookDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

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
        // Use null for degenerate 0/$1 books — only trust real positive values under $1
        bestBid: (s.bestBid != null && Number(s.bestBid) > 0) ? Number(s.bestBid) : null,
        bestAsk: (s.bestAsk != null && Number(s.bestAsk) > 0 && Number(s.bestAsk) < 1) ? Number(s.bestAsk) : null,
        spread: s.spread != null ? Number(s.spread) : null,
        bidDepth: s.bidDepth != null ? Number(s.bidDepth) : null,
        askDepth: s.askDepth != null ? Number(s.askDepth) : null,
        depthImbalance: s.depthImbalance != null ? Number(s.depthImbalance) : null,
        largeBidWall: s.largeBidWall != null ? Number(s.largeBidWall) : null,
        largeAskWall: s.largeAskWall != null ? Number(s.largeAskWall) : null,
        fillProbability: s.fillProbability != null ? Number(s.fillProbability) : null,
        thinBookWarning: Boolean(s.thinBookWarning ?? s.thinBookDanger ?? false),
        dataQuality: String(s.dataQuality ?? ''),
        lastUpdated: String(s.lastUpdated ?? s.capturedAt ?? ''),
        tentativeSettlementAt: s.tentativeSettlementAt ? String(s.tentativeSettlementAt) : (s.resolutionTime ? String(s.resolutionTime) : null),
        settlementStatus: deriveSettlementStatus({
          settlementStatus: s.settlementStatus,
          isResolved: Boolean(s.isResolved ?? s.market?.isResolved ?? false),
          status: s.status ?? s.market?.status,
          resolutionTime: s.tentativeSettlementAt ?? s.resolutionTime ?? null,
        }),
      }));
      return { ...raw, data: mapped };
    },
    [searchTerm],
  );

  useEffect(() => {
    if (markets.length === 0) {
      setSelectedMarketId(null);
      setDetail(null);
      return;
    }

    if (!selectedMarketId || !markets.some((market) => market.marketId === selectedMarketId)) {
      setSelectedMarketId(markets[0].marketId);
    }
  }, [markets, selectedMarketId]);

  useEffect(() => {
    if (!selectedMarketId) return;
    const marketId = selectedMarketId;

    let cancelled = false;

    async function loadDetail(showSpinner: boolean) {
      if (showSpinner) setDetailLoading(true);
      setDetailError(null);

      try {
        const res = await fetch(`/api/orderbook?marketId=${encodeURIComponent(marketId)}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as OrderbookDetail;
        if (!cancelled) {
          setDetail(data);
        }
      } catch (error) {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : 'Failed to load orderbook detail');
        }
      } finally {
        if (!cancelled && showSpinner) {
          setDetailLoading(false);
        }
      }
    }

    void loadDetail(true);
    const interval = window.setInterval(() => {
      void loadDetail(false);
    }, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [selectedMarketId]);

  const selectedMarket = useMemo(
    () => markets.find((market) => market.marketId === selectedMarketId) ?? null,
    [markets, selectedMarketId],
  );

  function handleSort(field: SortField) {
    const dir = sortBy === field && sortOrder === 'desc' ? 'asc' : 'desc';
    setSort(field, dir);
  }

  function openMarketDetail(marketId: string) {
    router.push(`/market/${marketId}?tab=orderbook`);
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
    ? (() => {
        const spreads = markets.map((m) => m.spread).filter((value): value is number => typeof value === 'number');
        return spreads.length > 0 ? spreads.reduce((sum, value) => sum + value, 0) / spreads.length : null;
      })()
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
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', spreadColorNullable(avgSpread))}>
              {formatPctNullable(avgSpread)}
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
                Showing {((page - 1) * limit) + 1}&ndash;{Math.min(page * limit, total)} of {total}
              </p>
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-transparent">
                      <TableHead className="text-gray-500">Market</TableHead>
                      <TableHead className="text-gray-500">Venue</TableHead>
                      <TableHead className="text-right text-gray-500">Tentative Settlement</TableHead>
                      <TableHead className="text-right text-gray-500">Settlement Done</TableHead>
                      <TableHead className="text-right text-gray-500">Best Bid</TableHead>
                      <TableHead className="text-right text-gray-500">Best Ask</TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('spread')}>
                        <span className="inline-flex items-center gap-1">Spread <SortIndicator active={sortBy === "spread"} order={sortOrder} /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('bidDepth')}>
                        <span className="inline-flex items-center gap-1">Bid Depth <SortIndicator active={sortBy === "bidDepth"} order={sortOrder} /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('askDepth')}>
                        <span className="inline-flex items-center gap-1">Ask Depth <SortIndicator active={sortBy === "askDepth"} order={sortOrder} /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-right text-gray-500 hover:text-gray-300" onClick={() => handleSort('depthImbalance')}>
                        <span className="inline-flex items-center gap-1">Imbalance <SortIndicator active={sortBy === "depthImbalance"} order={sortOrder} /></span>
                      </TableHead>
                      <TableHead className="cursor-pointer text-center text-gray-500 hover:text-gray-300" onClick={() => handleSort('fillProbability')}>
                        <span className="inline-flex items-center gap-1">Fill Prob <SortIndicator active={sortBy === "fillProbability"} order={sortOrder} /></span>
                      </TableHead>
                      <TableHead className="text-gray-500">Warnings</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
	                    {markets.map((m) => {
	                      const gauge = fillProbGauge(m.fillProbability);
	                      const isSelected = m.marketId === selectedMarketId;
	                      const missingBook = m.dataQuality === 'MISSING_ORDERBOOK' || m.dataQuality === 'INCOMPLETE_ORDERBOOK' || (m.bestBid == null && m.bestAsk == null && m.fillProbability == null);
	                      return (
                        <TableRow
                          key={m.id}
                          className={cn(
	                            'cursor-pointer border-gray-800 transition-colors hover:bg-gray-800/50',
	                            isSelected && 'bg-cyan-500/10 ring-1 ring-inset ring-cyan-500/30',
	                            m.thinBookWarning && 'bg-red-500/5',
	                            missingBook && 'opacity-75'
	                          )}
                          onClick={() => setSelectedMarketId(m.marketId)}
                        >
                          <TableCell>
                            <button
                              type="button"
                              className="max-w-[200px] truncate text-left text-xs font-medium text-cyan-300 hover:text-cyan-200 hover:underline"
                              onClick={(event) => {
                                event.stopPropagation();
                                openMarketDetail(m.marketId);
                              }}
	                            >
	                              {m.marketTitle}
	                            </button>
	                            {missingBook && (
	                              <p className="mt-1 text-[10px] text-amber-400">No executable book captured</p>
	                            )}
                          </TableCell>
                          <TableCell>{venueBadge(m.venue)}</TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs tabular-nums text-gray-400">
                              {formatTentativeSettlement(m.tentativeSettlementAt)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            {settlementStatusBadge(m.settlementStatus)}
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs tabular-nums text-emerald-400">{formatPriceNullable(m.bestBid)}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs tabular-nums text-red-400">{formatPriceNullable(m.bestAsk)}</span>
                          </TableCell>
	                          <TableCell className="text-right">
	                            <span className={cn('text-xs font-medium tabular-nums', spreadColorNullable(m.spread))}>
	                              {missingBook ? '—' : formatPctNullable(m.spread)}
	                            </span>
	                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs tabular-nums text-gray-300">{formatDepthNullable(m.bidDepth)}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-xs tabular-nums text-gray-300">{formatDepthNullable(m.askDepth)}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {(m.depthImbalance ?? 0) > 0.1 ? (
                                <TrendingUp className="h-3 w-3 text-emerald-400" />
                              ) : (m.depthImbalance ?? 0) < -0.1 ? (
                                <TrendingDown className="h-3 w-3 text-red-400" />
                              ) : null}
                              <span className={cn('text-xs tabular-nums', typeof m.depthImbalance === 'number' ? imbalanceColor(m.depthImbalance) : 'text-gray-500')}>
                                {typeof m.depthImbalance === 'number' ? `${m.depthImbalance > 0 ? '+' : ''}${(m.depthImbalance * 100).toFixed(0)}%` : '—'}
                              </span>
                            </div>
                          </TableCell>
	                          <TableCell className="w-28">
	                            {!missingBook && (
	                              <div className="mx-auto h-2 w-20 overflow-hidden rounded-full bg-gray-800">
	                                <div
	                                  className={cn('h-full rounded-full transition-all', gauge.color)}
	                                  style={{ width: gauge.width }}
	                                />
	                              </div>
	                            )}
	                            <p className="mt-1 text-center text-[10px] text-gray-500">
	                              {!missingBook ? formatWholePctNullable(m.fillProbability) : '\u2014'}
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
                                <span className="text-xs text-gray-600">&mdash;</span>
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

      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm text-white">
                <Activity className="h-4 w-4 text-emerald-400" />
                Exchange Orderbook Detail
              </CardTitle>
              <p className="mt-1 text-xs text-gray-500">
                Live detail panel for selected market. Auto-refresh every 15s.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-gray-700 bg-transparent text-gray-300 hover:bg-gray-800"
              onClick={() => {
                const marketId = selectedMarketId;
                if (!marketId) return;
                setDetailLoading(true);
                fetch(`/api/orderbook?marketId=${encodeURIComponent(marketId)}`, { cache: 'no-store' })
                  .then(async (res) => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return res.json() as Promise<OrderbookDetail>;
                  })
                  .then((data) => {
                    setDetail(data);
                    setDetailError(null);
                  })
                  .catch((error: unknown) => {
                    setDetailError(error instanceof Error ? error.message : 'Failed to load orderbook detail');
                  })
                  .finally(() => {
                    setDetailLoading(false);
                  });
              }}
            >
              <RefreshCw className={cn('mr-2 h-3.5 w-3.5', detailLoading && 'animate-spin')} />
              Refresh
            </Button>
            {selectedMarketId && (
              <Button
                variant="outline"
                size="sm"
                className="border-cyan-500/30 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20"
                onClick={() => openMarketDetail(selectedMarketId)}
              >
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                Open Detail Page
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {!selectedMarketId || !selectedMarket ? (
            <div className="rounded-xl border border-dashed border-gray-800 bg-gray-950/60 p-8 text-center text-sm text-gray-500">
              Select market from table to inspect exchange orderbook details.
            </div>
          ) : detailError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-300">
              {detailError}
            </div>
          ) : detailLoading && !detail ? (
            <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-8 text-center text-sm text-gray-500">
              Loading live orderbook detail...
            </div>
          ) : detail ? (
            <>
              <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
                <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {venueBadge(detail.market?.venue ?? selectedMarket.venue)}
                        <Badge variant="outline" className="border-gray-700 text-[10px] text-gray-400">
                          {detail.market?.category ?? 'uncategorized'}
                        </Badge>
                        <Badge variant="outline" className="border-gray-700 text-[10px] text-gray-400">
                          {detail.snapshot.orderbookSource ?? 'unknown source'}
                        </Badge>
                      </div>
                      <h3 className="max-w-3xl text-lg font-semibold text-white">
                        {detail.market?.title ?? selectedMarket.marketTitle}
                      </h3>
                      <div className="flex flex-wrap gap-4 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          <Database className="h-3.5 w-3.5" />
                          External ID: {detail.market?.externalId ?? '—'}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          Snapshot: {new Date(detail.snapshot.capturedAt).toLocaleString()}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          Tentative settlement: {formatTentativeSettlement(detail.market?.resolutionTime)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          Settlement done: {settlementStatusBadge(deriveSettlementStatus(detail.market ?? {}))}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-right">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/70">Orderbook Quality</p>
                      <p className="mt-1 text-3xl font-semibold text-cyan-300">
                        {typeof detail.analysis.orderbookQualityScore === 'number'
                          ? detail.analysis.orderbookQualityScore.toFixed(1)
                          : '—'}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-emerald-300/70">Best Bid</p>
                      <p className="mt-2 text-2xl font-semibold text-emerald-300">{formatPriceNullable(detail.snapshot.bestBid)}</p>
                      <p className="mt-1 text-xs text-emerald-200/60">Depth {formatDepthNullable(detail.snapshot.bidDepth)}</p>
                    </div>
                    <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-red-300/70">Best Ask</p>
                      <p className="mt-2 text-2xl font-semibold text-red-300">{formatPriceNullable(detail.snapshot.bestAsk)}</p>
                      <p className="mt-1 text-xs text-red-200/60">Depth {formatDepthNullable(detail.snapshot.askDepth)}</p>
                    </div>
                    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-amber-300/70">Spread</p>
                      <p className={cn('mt-2 text-2xl font-semibold', spreadColorNullable(detail.snapshot.spread))}>
                        {formatPctNullable(detail.snapshot.spread)}
                      </p>
                      <p className="mt-1 text-xs text-amber-200/60">{detail.snapshot.spreadSource ?? 'spread source unknown'}</p>
                    </div>
                    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-cyan-300/70">Fill Probability</p>
                      <p className="mt-2 text-2xl font-semibold text-cyan-300">{formatPctNullable(detail.snapshot.fillProbability)}</p>
                      <p className="mt-1 text-xs text-cyan-200/60">Impact {formatPctNullable(detail.snapshot.priceImpact)}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-5">
                  <h4 className="text-sm font-semibold text-white">Live Signal State</h4>
                  <div className="mt-4 space-y-3 text-sm">
                    <div className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/70 px-3 py-2">
                      <span className="text-gray-400">Depth imbalance</span>
                      <span className={cn('font-medium', imbalanceColor(detail.snapshot.depthImbalance ?? 0))}>
                        {formatSignedPct(detail.snapshot.depthImbalance)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/70 px-3 py-2">
                      <span className="text-gray-400">Recent movement</span>
                      <span className={cn('font-medium', Math.abs(detail.snapshot.recentMovement ?? 0) > 0.03 ? 'text-amber-300' : 'text-gray-200')}>
                        {formatSignedPct(detail.snapshot.recentMovement)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/70 px-3 py-2">
                      <span className="text-gray-400">Depth decay</span>
                      <span className="font-medium text-gray-200">{formatPctNullable(detail.snapshot.depthDecay)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/70 px-3 py-2">
                      <span className="text-gray-400">Latest market price</span>
                      <span className="font-medium text-gray-200">{formatPriceNullable(detail.market?.latestPrice)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/70 px-3 py-2">
                      <span className="text-gray-400">Market liquidity</span>
                      <span className="font-medium text-gray-200">{formatDepthNullable(detail.market?.latestLiquidity)}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl border border-gray-800 bg-gray-900/70 px-3 py-2">
                      <span className="text-gray-400">Book health</span>
                      <span className={cn('font-medium', detail.snapshot.thinBookDanger ? 'text-red-300' : 'text-emerald-300')}>
                        {detail.snapshot.thinBookDanger ? 'Thin book warning' : 'Healthy'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-5">
                  <div className="flex items-center gap-2">
                    <Waves className="h-4 w-4 text-cyan-400" />
                    <h4 className="text-sm font-semibold text-white">Recent Snapshot Feed</h4>
                  </div>
                  <div className="mt-4 space-y-2">
                    {detail.recentSnapshots.length === 0 ? (
                      <p className="text-sm text-gray-500">No recent snapshots.</p>
                    ) : (
                      detail.recentSnapshots.map((item) => (
                        <div key={item.id} className="grid grid-cols-[1.2fr_repeat(5,minmax(0,1fr))] gap-2 rounded-xl border border-gray-800 bg-gray-900/70 px-3 py-2 text-xs">
                          <div className="text-gray-400">{new Date(item.capturedAt).toLocaleTimeString()}</div>
                          <div className="text-emerald-300">{formatPriceNullable(item.bestBid)}</div>
                          <div className="text-red-300">{formatPriceNullable(item.bestAsk)}</div>
                          <div className={spreadColorNullable(item.spread)}>{formatPctNullable(item.spread)}</div>
                          <div className={cn((item.depthImbalance ?? 0) > 0 ? 'text-emerald-300' : 'text-red-300')}>
                            {formatSignedPct(item.depthImbalance)}
                          </div>
                          <div className="text-cyan-300">{formatPctNullable(item.fillProbability)}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-800 bg-gray-950/70 p-5">
                  <h4 className="text-sm font-semibold text-white">Raw Book Levels</h4>
                  <div className="mt-4 max-h-[360px] space-y-2 overflow-y-auto">
                    {(detail.analysis.levels ?? []).length === 0 ? (
                      <p className="text-sm text-gray-500">No level payload stored for this snapshot.</p>
                    ) : (
                      (detail.analysis.levels ?? []).slice(0, 30).map((level, index) => (
                        <div key={`${level.side ?? 'UNK'}-${level.price}-${index}`} className="grid grid-cols-[72px_1fr_1fr] gap-3 rounded-xl border border-gray-800 bg-gray-900/70 px-3 py-2 text-xs">
                          <div className={cn(
                            'font-medium',
                            level.side === 'BID' ? 'text-emerald-300' : level.side === 'ASK' ? 'text-red-300' : 'text-gray-400',
                          )}>
                            {level.side ?? 'LEVEL'}
                          </div>
                          <div className="text-gray-200">{formatPrice(level.price)}</div>
                          <div className="text-gray-400">{formatDepth(level.size)}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : null}
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
                          <span className="text-xs text-gray-600">&mdash;</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {m.largeAskWall ? (
                          <Badge className="border-red-500/30 bg-red-500/10 text-red-400 text-[10px]">
                            {formatDepth(m.largeAskWall)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-gray-600">&mdash;</span>
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
