'use client';

import { useState } from 'react';
import {
  TrendingUp,
  Award,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Target,
  ExternalLink,
  Search,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardHeader,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { REASON_CODE_DESCRIPTIONS } from '@/lib/constants';
import { parseCriteriaValue } from '@/lib/engine/candidate-criteria';
import { usePagination } from '@/hooks/use-pagination';
import { PaginationBar } from '@/components/trading/PaginationBar';
import type { PaginationParams, PaginatedResponse } from '@/lib/types';

interface APlusRecord {
  id: string;
  marketId: string;
  candidateScore: number;
  acceptedCriteria: string;
  rejectedCriteria: string;
  modelDisagreement: number | null;
  riskFlags: string[];
  biasAdjustedProb: number | null;
  adjustedEdge: number | null;
  market: {
    id: string;
    title: string;
    venue: string;
    category: string;
    status: string;
  } | null;
}

function venueBadgeLabel(venue: string): string {
  const map: Record<string, string> = {
    POLYMARKET: 'Polymarket',
    KALSHI: 'Kalshi',
    SX_BET: 'SX Bet',
    MANIFOLD: 'Manifold',
  };
  return map[venue] ?? venue;
}

function formatPct(val: number | null): string {
  if (val === null) return '\u2014';
  return `${(val * 100).toFixed(1)}%`;
}

export function APlusSignalsDashboard() {
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const {
    data: signals,
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
  } = usePagination<APlusRecord>(
    async (params: PaginationParams): Promise<PaginatedResponse<APlusRecord>> => {
      const query = new URLSearchParams({
        aplus: 'true',
        page: String(params.page),
        limit: String(params.limit),
        sortBy: params.sortBy || 'candidateScore',
        sortOrder: params.sortOrder || 'desc',
      });
      if (searchTerm.trim()) query.set('search', searchTerm.trim());
      const res = await fetch(`/api/trading/candidates?${query}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json();
      const list: APlusRecord[] = (raw.data ?? []).map((c: APlusRecord) => ({
        ...c,
        riskFlags: Array.isArray(c.riskFlags) ? c.riskFlags : [],
      }));
      return { ...raw, data: list };
    },
    [searchTerm],
  );

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
        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-gray-900" />
          ))}
        </div>
      </div>
    );
  }

  // ── error ──
  if (error) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">A+ Signals</h2>
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

  // ── stats (from paginated data) ──
  const avgScore = signals.length > 0
    ? (signals.reduce((s, c) => s + (c.candidateScore ?? 0), 0) / signals.length).toFixed(1)
    : '\u2014';
  const riskFlagCount = signals.reduce((s, c) => s + c.riskFlags.length, 0);
  const avgEdge = signals.length > 0
    ? `${((signals.reduce((s, c) => s + (c.adjustedEdge ?? 0), 0) / signals.length) * 100).toFixed(1)}%`
    : '\u2014';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">A+ Signals</h2>
        <p className="mt-1 text-sm text-gray-500">
          Elite candidates scoring \u226590 with full criteria analysis
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-emerald-500/20 bg-gray-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Award className="h-4 w-4 text-emerald-400" />
              <p className="text-xs text-gray-500">A+ Candidates</p>
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-400">{total}</p>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/20 bg-gray-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              <p className="text-xs text-gray-500">Avg Score</p>
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-emerald-400">{avgScore}</p>
          </CardContent>
        </Card>
        <Card className="border-amber-500/20 bg-gray-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              <p className="text-xs text-gray-500">Risk Flags</p>
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-amber-400">{riskFlagCount}</p>
          </CardContent>
        </Card>
        <Card className="border-cyan-500/20 bg-gray-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-cyan-400" />
              <p className="text-xs text-gray-500">Avg Edge</p>
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-cyan-400">{avgEdge}</p>
          </CardContent>
        </Card>
      </div>

      {/* Search + sort */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          <Input
            placeholder="Search by market title..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="border-gray-800 bg-gray-900 pl-10 text-sm text-white placeholder:text-gray-600"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-xs text-gray-400 hover:text-gray-200"
          onClick={() => {
            const dir = sortBy === 'candidateScore' && sortOrder === 'desc' ? 'asc' : 'desc';
            setSort('candidateScore', dir);
          }}
        >
          Score
          {sortBy === 'candidateScore' && (
            sortOrder === 'desc' ? <ChevronDown className="ml-1 h-3 w-3" /> : <ChevronUp className="ml-1 h-3 w-3" />
          )}
        </Button>
      </div>

      {signals.length === 0 ? (
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
              <Award className="h-6 w-6 text-gray-500" />
            </div>
            <p className="text-xs font-medium text-gray-400">No A+ candidates yet</p>
            <p className="mt-1 text-[11px] text-gray-600">
              A+ candidates appear when market scoring reaches 90+ threshold.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-xs text-gray-600">
            Showing {((page - 1) * limit) + 1}&ndash;{Math.min(page * limit, total)} of {total}
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {signals.map((s) => {
              const accepted = parseCriteriaValue(s.acceptedCriteria);
              const rejected = parseCriteriaValue(s.rejectedCriteria);
              const isExpanded = expandedId === s.id;

              return (
                <Card key={s.id} className="border-emerald-500/20 bg-gray-900 transition-colors hover:border-emerald-500/40">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 space-y-1">
                        <p className="text-sm font-semibold text-white leading-snug">
                          {s.market?.title ?? 'Unknown Market'}
                        </p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="border-gray-700 text-[10px] text-gray-400">
                            {venueBadgeLabel(s.market?.venue ?? '')}
                          </Badge>
                          <Badge className="border-transparent bg-emerald-600/20 text-[10px] text-emerald-400">
                            A+ {s.candidateScore?.toFixed(1)}
                          </Badge>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-gray-500 hover:text-gray-300"
                        onClick={() => setExpandedId(isExpanded ? null : s.id)}>
                        {isExpanded ? <CheckCircle2 className="h-4 w-4" /> : <ExternalLink className="h-4 w-4" />}
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div className="rounded-lg bg-gray-800/60 px-3 py-2">
                        <p className="text-[10px] text-gray-500">Adj Probability</p>
                        <p className="text-sm font-bold tabular-nums text-emerald-400">{formatPct(s.biasAdjustedProb)}</p>
                      </div>
                      <div className="rounded-lg bg-gray-800/60 px-3 py-2">
                        <p className="text-[10px] text-gray-500">Edge</p>
                        <p className="text-sm font-bold tabular-nums text-emerald-400">{formatPct(s.adjustedEdge)}</p>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="space-y-3 pt-2 border-t border-gray-800">
                        <div>
                          <p className="mb-1.5 text-[11px] font-medium text-emerald-400/80">
                            <CheckCircle2 className="mr-1 inline h-3 w-3" />
                            Accepted Criteria
                          </p>
                          {accepted.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {accepted.map((c, i) => (
                                <Badge key={i} variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400">
                                  {c}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-gray-600">None listed</p>
                          )}
                        </div>

                        <div>
                          <p className="mb-1.5 text-[11px] font-medium text-red-400/80">
                            <XCircle className="mr-1 inline h-3 w-3" />
                            Rejected Criteria
                          </p>
                          {rejected.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {rejected.map((c, i) => (
                                <Badge key={i} variant="outline" className="border-red-500/30 bg-red-500/10 text-[10px] text-red-400">
                                  {c}
                                </Badge>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-gray-600">None rejected</p>
                          )}
                        </div>

                        {s.modelDisagreement !== null && s.modelDisagreement !== undefined && (
                          <div>
                            <p className="mb-1.5 text-[11px] font-medium text-amber-400/80">
                              Model Disagreement: {(s.modelDisagreement * 100).toFixed(1)}%
                            </p>
                          </div>
                        )}

                        {s.riskFlags.length > 0 && (
                          <div>
                            <p className="mb-1.5 text-[11px] font-medium text-amber-400/80">
                              <AlertTriangle className="mr-1 inline h-3 w-3" />
                              Risk Flags
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {s.riskFlags.map((flag, i) => (
                                <Badge key={i} variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-400"
                                  title={REASON_CODE_DESCRIPTIONS[flag] ?? flag}>
                                  {flag}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          <PaginationBar page={page} totalPages={totalPages} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
        </>
      )}
    </div>
  );
}
