'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  Search,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Target,
  ClipboardList,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { Venue, DecisionAction, RiskReasonCode } from '@/lib/types';
import { VENUE_OPTIONS, REASON_CODE_DESCRIPTIONS } from '@/lib/constants';

// ── types ────────────────────────────────────────────────────────────────────

interface DecisionRow {
  id: string;
  marketId: string;
  marketTitle: string;
  venue: Venue;
  predictedProb: number;
  impliedProb: number;
  edge: number;
  action: DecisionAction;
  reasonCode: RiskReasonCode | null;
  reasonCodeLabel: string;
  positionSize: number;
  outcome: 'WIN' | 'LOSS' | 'PENDING' | null;
  pnl: number | null;
  bullOutput: string;
  bearOutput: string;
  judgeOutput: string;
  sources: string[];
  executionLog: string;
  postmortem: string;
  decidedAt: string;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function venueLabel(v: Venue): string {
  return VENUE_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

function venueColor(v: Venue): string {
  return VENUE_OPTIONS.find((o) => o.value === v)?.color ?? '#888';
}

function formatCurrency(n: number): string {
  return `$${n.toLocaleString()}`;
}

// ── component ────────────────────────────────────────────────────────────────

export function ResearchLedger() {
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [venueFilter, setVenueFilter] = useState<string>('ALL');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchDecisions() {
      try {
        const res = await fetch('/api/decisions');
        if (res.ok && !cancelled) {
          const data = await res.json();
          setDecisions(data.decisions ?? []);
        }
      } catch {
        // failed to load
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    fetchDecisions();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    return decisions.filter((d) => {
      if (
        search &&
        !d.marketTitle.toLowerCase().includes(search.toLowerCase())
      )
        return false;
      if (venueFilter !== 'ALL' && d.venue !== venueFilter) return false;
      if (actionFilter !== 'ALL' && d.action !== actionFilter) return false;
      return true;
    });
  }, [decisions, search, venueFilter, actionFilter]);

  const summaryStats = useMemo(() => {
    const total = decisions.length;
    const buys = decisions.filter((d) => d.action === 'BUY').length;
    const resolved = decisions.filter(
      (d) => d.outcome === 'WIN' || d.outcome === 'LOSS'
    );
    const wins = resolved.filter((d) => d.outcome === 'WIN').length;
    const winRate = resolved.length > 0 ? wins / resolved.length : 0;
    const totalPnl = resolved.reduce(
      (s, d) => s + (d.pnl ?? 0),
      0
    );
    const avgEdge =
      decisions.length > 0
        ? decisions.reduce((s, d) => s + d.edge, 0) / decisions.length
        : 0;
    return { total, buys, resolved: resolved.length, winRate, totalPnl, avgEdge };
  }, [decisions]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Research Ledger</h2>
        <div className="h-64 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-white">Research Ledger</h2>
        <p className="mt-1 text-sm text-gray-500">
          Trading decisions, research outputs, and performance tracking
        </p>
      </div>

      {/* Empty state when no decisions at all */}
      {decisions.length === 0 ? (
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-800">
              <ClipboardList className="h-7 w-7 text-gray-500" />
            </div>
            <p className="text-sm font-medium text-gray-400">
              No trading decisions yet
            </p>
            <p className="mt-1 text-xs text-gray-600">
              Decisions will appear after markets complete the research pipeline.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[
              {
                label: 'Total Trades',
                value: summaryStats.total,
                icon: BarChart3,
                color: 'text-white',
              },
              {
                label: 'Win Rate',
                value: `${(summaryStats.winRate * 100).toFixed(0)}%`,
                icon: Target,
                color: 'text-emerald-400',
              },
              {
                label: 'Buy Actions',
                value: summaryStats.buys,
                icon: TrendingUp,
                color: 'text-cyan-400',
              },
              {
                label: 'Avg Edge',
                value: `${(summaryStats.avgEdge * 100).toFixed(1)}%`,
                icon: TrendingUp,
                color: 'text-amber-400',
              },
              {
                label: 'Total PnL',
                value: formatCurrency(summaryStats.totalPnl),
                icon: summaryStats.totalPnl >= 0 ? TrendingUp : TrendingDown,
                color:
                  summaryStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
              },
            ].map((s) => (
              <Card
                key={s.label}
                className="border-gray-800 bg-gray-900"
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500">{s.label}</p>
                    <s.icon className={cn('h-4 w-4', s.color, 'opacity-40')} />
                  </div>
                  <p className={cn('mt-1 text-xl font-bold', s.color)}>
                    {s.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Filters */}
          <Card className="border-gray-800 bg-gray-900">
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <Input
                    placeholder="Search by market title..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="border-gray-700 bg-gray-800 pl-9 text-white placeholder:text-gray-600"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Select value={venueFilter} onValueChange={setVenueFilter}>
                    <SelectTrigger className="w-36 border-gray-700 bg-gray-800 text-gray-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-gray-700 bg-gray-900">
                      <SelectItem value="ALL">All Venues</SelectItem>
                      {VENUE_OPTIONS.map((v) => (
                        <SelectItem key={v.value} value={v.value}>
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={actionFilter} onValueChange={setActionFilter}>
                    <SelectTrigger className="w-36 border-gray-700 bg-gray-800 text-gray-300">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="border-gray-700 bg-gray-900">
                      <SelectItem value="ALL">All Actions</SelectItem>
                      <SelectItem value="BUY">BUY</SelectItem>
                      <SelectItem value="SKIP">SKIP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Data Table */}
          <Card className="border-gray-800 bg-gray-900">
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-transparent">
                      <TableHead className="w-8" />
                      <TableHead className="text-gray-500">Market</TableHead>
                      <TableHead className="text-gray-500">Venue</TableHead>
                      <TableHead className="text-right text-gray-500">
                        Predicted
                      </TableHead>
                      <TableHead className="text-right text-gray-500">
                        Implied
                      </TableHead>
                      <TableHead className="text-right text-gray-500">Edge</TableHead>
                      <TableHead className="text-gray-500">Action</TableHead>
                      <TableHead className="text-right text-gray-500">PnL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow className="border-gray-800">
                        <TableCell
                          colSpan={8}
                          className="py-8 text-center text-sm text-gray-600"
                        >
                          No decisions match the current filters
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((d) => (
                        <TableRow
                          key={d.id}
                          className="cursor-pointer border-gray-800 transition-colors hover:bg-gray-800/50"
                          onClick={() =>
                            setExpandedId(
                              expandedId === d.id ? null : d.id
                            )
                          }
                        >
                          <TableCell className="w-8 px-3">
                            {expandedId === d.id ? (
                              <ChevronDown className="h-4 w-4 text-gray-500" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-gray-600" />
                            )}
                          </TableCell>
                          <TableCell>
                            <p className="max-w-[200px] truncate text-sm text-gray-200">
                              {d.marketTitle}
                            </p>
                          </TableCell>
                          <TableCell>
                            <span
                              className="text-xs font-medium"
                              style={{ color: venueColor(d.venue) }}
                            >
                              {venueLabel(d.venue)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-sm tabular-nums text-gray-300">
                              {(d.predictedProb * 100).toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span className="text-sm tabular-nums text-gray-300">
                              {(d.impliedProb * 100).toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <span
                              className={cn(
                                'text-sm font-medium tabular-nums',
                                d.edge >= 0.05
                                  ? 'text-emerald-400'
                                  : d.edge >= 0
                                    ? 'text-amber-400'
                                    : 'text-red-400'
                              )}
                            >
                              {d.edge >= 0 ? '+' : ''}
                              {(d.edge * 100).toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell>
                            {d.action === 'BUY' ? (
                              <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
                                BUY
                              </Badge>
                            ) : (
                              <Badge className="border-gray-500/30 bg-gray-500/10 text-gray-500">
                                SKIP
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {d.pnl !== null ? (
                              <span
                                className={cn(
                                  'text-sm font-medium tabular-nums',
                                  d.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'
                                )}
                              >
                                {d.pnl >= 0 ? '+' : ''}
                                {formatCurrency(d.pnl)}
                              </span>
                            ) : d.outcome === 'PENDING' ? (
                              <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px]">
                                PENDING
                              </Badge>
                            ) : (
                              <span className="text-sm text-gray-600">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Expanded detail */}
          {expandedId && (() => {
            const d = decisions.find((x) => x.id === expandedId);
            if (!d) return null;
            return (
              <Card className="border-gray-800 bg-gray-900">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-sm text-white">
                        {d.marketTitle}
                      </CardTitle>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge
                          className={cn(
                            d.action === 'BUY'
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                              : 'border-gray-500/30 bg-gray-500/10 text-gray-500'
                          )}
                        >
                          {d.action}
                        </Badge>
                        {d.reasonCode && (
                          <Badge className="border-amber-500/30 bg-amber-500/10 text-amber-400 text-[10px]">
                            {d.reasonCode}
                          </Badge>
                        )}
                        {d.outcome && (
                          <Badge
                            className={cn(
                              'text-[10px]',
                              d.outcome === 'WIN'
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                : d.outcome === 'LOSS'
                                  ? 'border-red-500/30 bg-red-500/10 text-red-400'
                                  : 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                            )}
                          >
                            {d.outcome}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedId(null)}
                      className="text-gray-500"
                    >
                      Close
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Agent outputs */}
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                      <p className="mb-1 text-xs font-semibold text-emerald-400">
                        🐂 Bull Case
                      </p>
                      <p className="text-xs leading-relaxed text-gray-400">
                        {d.bullOutput || 'No output available'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                      <p className="mb-1 text-xs font-semibold text-red-400">
                        🐻 Bear Case
                      </p>
                      <p className="text-xs leading-relaxed text-gray-400">
                        {d.bearOutput || 'No output available'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-3">
                      <p className="mb-1 text-xs font-semibold text-purple-400">
                        ⚖️ Judge
                      </p>
                      <p className="text-xs leading-relaxed text-gray-400">
                        {d.judgeOutput || 'No output available'}
                      </p>
                    </div>
                  </div>

                  {/* Sources */}
                  <div>
                    <p className="mb-2 text-xs font-medium text-gray-500">
                      Sources
                    </p>
                    {d.sources && d.sources.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {d.sources.map((s) => (
                          <Badge
                            key={s}
                            variant="outline"
                            className="border-gray-700 text-xs text-gray-400"
                          >
                            {s}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-600">No sources available</p>
                    )}
                  </div>

                  {/* Execution log */}
                  <div>
                    <p className="mb-2 text-xs font-medium text-gray-500">
                      Execution Log
                    </p>
                    <pre className="max-h-32 overflow-y-auto rounded-lg border border-gray-800 bg-gray-800/60 p-3 text-xs text-gray-400">
                      {d.executionLog || 'No execution log available'}
                    </pre>
                  </div>

                  {/* Postmortem */}
                  {d.postmortem && (
                    <div>
                      <p className="mb-2 text-xs font-medium text-gray-500">
                        Postmortem
                      </p>
                      <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
                        <p className="text-xs leading-relaxed text-gray-400">
                          {d.postmortem}
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}
        </>
      )}
    </div>
  );
}
