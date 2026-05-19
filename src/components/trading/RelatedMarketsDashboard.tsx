'use client';

import { useState } from 'react';
import {
  GitCompare,
  AlertTriangle,
  Search,
  XCircle,
  Filter,
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
import { cn } from '@/lib/utils';
import { usePagination } from '@/hooks/use-pagination';
import { PaginationBar } from '@/components/trading/PaginationBar';
import type { PaginationParams, PaginatedResponse } from '@/lib/types';

// ── types ────────────────────────────────────────────────────────────────────

interface RelatedMarketPair {
  id: string;
  marketA: { id: string; title: string; venue: string; category: string };
  marketB: { id: string; title: string; venue: string; category: string };
  relationshipType: string;
  contradictionScore: number | null;
  priceInconsistency: number | null;
  alertText: string | null;
  detectedAt: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function relationshipBadge(type: string) {
  const colors: Record<string, string> = {
    CORRELATED: 'border-blue-500/30 bg-blue-500/10 text-blue-400',
    CONTRADICTORY: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    NEGATED: 'border-red-500/30 bg-red-500/10 text-red-400',
    PARENT_CHILD: 'border-purple-500/30 bg-purple-500/10 text-purple-400',
    SAME_EVENT: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
    ARBITRAGEABLE: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
  };
  return (
    <Badge variant="outline" className={cn('text-[10px]', colors[type] ?? 'border-gray-700 text-gray-400')}>
      {type.replace(/_/g, ' ')}
    </Badge>
  );
}

function contradictionLevel(score: number | null): { label: string; color: string } {
  if (score === null) return { label: '—', color: 'text-gray-500' };
  if (score >= 0.8) return { label: 'Critical', color: 'text-red-400' };
  if (score >= 0.5) return { label: 'High', color: 'text-amber-400' };
  if (score >= 0.2) return { label: 'Moderate', color: 'text-cyan-400' };
  return { label: 'Low', color: 'text-gray-400' };
}

function formatPct(value: number | null): string {
  if (value === null) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

function formatScore(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(3);
}

const RELATIONSHIP_TYPES = ['CORRELATED', 'CONTRADICTORY', 'NEGATED', 'PARENT_CHILD', 'SAME_EVENT', 'ARBITRAGEABLE'] as const;

// ── component ────────────────────────────────────────────────────────────────

export function RelatedMarketsDashboard() {
  const [search, setSearch] = useState('');
  const [relFilter, setRelFilter] = useState<string>('ALL');

  const {
    data: pairs,
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
  } = usePagination<RelatedMarketPair>(
    async (params: PaginationParams): Promise<PaginatedResponse<RelatedMarketPair>> => {
      const query = new URLSearchParams({
        page: String(params.page),
        limit: String(params.limit),
        sortBy: params.sortBy || 'contradictionScore',
        sortOrder: params.sortOrder || 'desc',
      });
      if (search.trim()) query.set('search', search.trim());
      if (relFilter !== 'ALL') query.set('relationshipType', relFilter);
      const res = await fetch(`/api/related-markets?${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    [search, relFilter],
    { defaultSortBy: 'contradictionScore', defaultSortOrder: 'desc' },
  );

  const handleSort = (field: string) => {
    const newOrder = sortBy === field && sortOrder === 'desc' ? 'asc' : 'desc';
    setSort(field, newOrder);
  };

  const SortIcon = sortOrder === 'desc' ? ChevronDown : ChevronUp;

  const startIndex = total === 0 ? 0 : (page - 1) * limit + 1;
  const endIndex = Math.min(page * limit, total);

  // ── error ──
  if (error) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Related Markets</h2>
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

  if (loading && pairs.length === 0) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-56 animate-pulse rounded bg-gray-800" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-900" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white">Related Markets</h2>
        <p className="mt-1 text-sm text-gray-500">
          Cross-market relationships, contradictions, and arbitrage opportunities
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total Pairs</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{total}</p>
          </CardContent>
        </Card>
        <Card className="border-amber-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Contradictory</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-amber-400">
              {pairs.filter((p) => p.relationshipType === 'CONTRADICTORY' || p.relationshipType === 'NEGATED').length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-red-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">High Contradiction</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-red-400">
              {pairs.filter((p) => (p.contradictionScore ?? 0) >= 0.5).length}
            </p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Arbitrageable</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">
              {pairs.filter((p) => p.relationshipType === 'ARBITRAGEABLE').length}
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
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            className="border-gray-800 bg-gray-900 pl-10 text-sm text-white placeholder:text-gray-600"
          />
        </div>
        <Select value={relFilter} onValueChange={setRelFilter}>
          <SelectTrigger className="w-[200px] border-gray-800 bg-gray-900 text-sm text-gray-300">
            <Filter className="mr-2 h-3.5 w-3.5 text-gray-500" />
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent className="border-gray-800 bg-gray-900 text-gray-300">
            <SelectItem value="ALL">All Types</SelectItem>
            {RELATIONSHIP_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Pairs table */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <GitCompare className="h-4 w-4 text-cyan-400" />
            Market Pairs
            <span className="ml-1 text-xs font-normal text-gray-500">
              (Showing {startIndex}–{endIndex} of {total})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {pairs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                <GitCompare className="h-6 w-6 text-gray-500" />
              </div>
              <p className="text-xs font-medium text-gray-400">No related markets found</p>
              <p className="mt-1 text-[11px] text-gray-600">
                {search || relFilter !== 'ALL'
                  ? 'Try adjusting your filters.'
                  : 'Related markets will appear as the system discovers connections.'}
              </p>
            </div>
          ) : (
            <>
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-transparent">
                      <TableHead className="text-gray-500">Market A</TableHead>
                      <TableHead className="text-gray-500">Market B</TableHead>
                      <TableHead className="text-gray-500">Relationship</TableHead>
                      <TableHead
                        className="cursor-pointer text-right text-gray-500 hover:text-gray-300"
                        onClick={() => handleSort('contradictionScore')}
                      >
                        <span className="inline-flex items-center gap-1">
                          Contradiction {sortBy === 'contradictionScore' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer text-right text-gray-500 hover:text-gray-300"
                        onClick={() => handleSort('priceInconsistency')}
                      >
                        <span className="inline-flex items-center gap-1">
                          Inconsistency {sortBy === 'priceInconsistency' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
                      <TableHead className="text-gray-500">Alert</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pairs.map((p) => {
                      const cl = contradictionLevel(p.contradictionScore);
                      const isContradiction = p.relationshipType === 'CONTRADICTORY' || p.relationshipType === 'NEGATED';
                      return (
                        <TableRow
                          key={p.id}
                          className={cn(
                            'border-gray-800 transition-colors hover:bg-gray-800/50',
                            isContradiction && 'bg-amber-500/5'
                          )}
                        >
                          <TableCell>
                            <div>
                              <p className="max-w-[200px] truncate text-xs font-medium text-gray-200">
                                {p.marketA.title}
                              </p>
                              <p className="mt-0.5 text-[10px] text-gray-600">
                                {p.marketA.venue} · {p.marketA.category}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div>
                              <p className="max-w-[200px] truncate text-xs font-medium text-gray-200">
                                {p.marketB.title}
                              </p>
                              <p className="mt-0.5 text-[10px] text-gray-600">
                                {p.marketB.venue} · {p.marketB.category}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>{relationshipBadge(p.relationshipType)}</TableCell>
                          <TableCell className="text-right">
                            <span className={cn('text-xs font-medium tabular-nums', cl.color)}>
                              {cl.label}
                            </span>
                            <span className="ml-1 text-[10px] text-gray-600">
                              ({formatScore(p.contradictionScore)})
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className={cn(
                              'text-xs tabular-nums',
                              (p.priceInconsistency ?? 0) >= 0.1 ? 'text-amber-400' : 'text-gray-400'
                            )}>
                              {formatPct(p.priceInconsistency)}
                            </span>
                          </TableCell>
                          <TableCell>
                            {p.alertText ? (
                              <div className="flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
                                <span className="max-w-[160px] truncate text-xs text-amber-400/80" title={p.alertText}>
                                  {p.alertText}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-gray-600">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
