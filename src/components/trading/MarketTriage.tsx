'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Search,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
  Filter,
  Clock,
  DollarSign,
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
import type { Venue, TriageStatus, CandidateStage } from '@/lib/types';
import { VENUE_OPTIONS, STAGE_COLORS } from '@/lib/constants';

// ── types ────────────────────────────────────────────────────────────────────

interface MarketRow {
  id: string;
  title: string;
  venue: Venue;
  liquidity: number;
  spread: number;
  impliedProb: number;
  triageStatus: TriageStatus;
  triageReason: string;
  researchQueued: boolean;
  stage: CandidateStage;
  description: string;
  snapshotAt: string;
  category: string;
}

// ── mock data ────────────────────────────────────────────────────────────────

const MOCK_MARKETS: MarketRow[] = [
  {
    id: 'poly-001',
    title: 'Will Bitcoin exceed $150K by Dec 2025?',
    venue: 'POLYMARKET',
    liquidity: 245000,
    spread: 0.018,
    impliedProb: 0.42,
    triageStatus: 'RELEVANT',
    triageReason: 'High liquidity crypto market with clear resolution criteria',
    researchQueued: true,
    stage: 'RESEARCHING',
    description:
      'This market resolves YES if Bitcoin reaches a price of $150,000 or higher at any point before December 31, 2025 11:59 PM ET based on CoinGecko data.',
    snapshotAt: '2025-01-15T10:30:00Z',
    category: 'crypto',
  },
  {
    id: 'poly-002',
    title: 'Fed rate cut in March 2025 meeting?',
    venue: 'POLYMARKET',
    liquidity: 189000,
    spread: 0.025,
    impliedProb: 0.67,
    triageStatus: 'RELEVANT',
    triageReason: 'Economic policy market with measurable outcome',
    researchQueued: true,
    stage: 'TRIAGED',
    description:
      'Resolves YES if the Federal Reserve announces a rate cut at the March 2025 FOMC meeting.',
    snapshotAt: '2025-01-15T10:25:00Z',
    category: 'economics',
  },
  {
    id: 'kalshi-001',
    title: 'Will the S&P 500 close above 6,000 on Friday?',
    venue: 'KALSHI',
    liquidity: 52000,
    spread: 0.032,
    impliedProb: 0.55,
    triageStatus: 'RELEVANT',
    triageReason: 'Short-term financial market with upcoming resolution',
    researchQueued: false,
    stage: 'JUDGED',
    description:
      'Resolves YES if the S&P 500 index closes at or above 6,000.00 on the upcoming Friday trading session.',
    snapshotAt: '2025-01-15T10:20:00Z',
    category: 'economics',
  },
  {
    id: 'poly-003',
    title: 'Next NFL MVP: Patrick Mahomes?',
    venue: 'POLYMARKET',
    liquidity: 78000,
    spread: 0.042,
    impliedProb: 0.31,
    triageStatus: 'AMBIGUOUS',
    triageReason: 'Sports market with moderate liquidity, complex multi-factor analysis needed',
    researchQueued: false,
    stage: 'SCANNED',
    description:
      'Resolves YES if Patrick Mahomes is awarded the NFL MVP for the 2024-2025 season.',
    snapshotAt: '2025-01-15T10:15:00Z',
    category: 'sports',
  },
  {
    id: 'sx-001',
    title: 'US GDP growth Q1 2025 above 2.5%?',
    venue: 'SX_BET',
    liquidity: 31000,
    spread: 0.015,
    impliedProb: 0.48,
    triageStatus: 'RELEVANT',
    triageReason: 'Economic indicator with government data resolution',
    researchQueued: true,
    stage: 'RESEARCHING',
    description:
      'Resolves YES if the real GDP growth rate for Q1 2025 exceeds 2.5% annualized.',
    snapshotAt: '2025-01-15T10:10:00Z',
    category: 'economics',
  },
  {
    id: 'poly-004',
    title: 'Will TikTok be banned in the US by July 2025?',
    venue: 'POLYMARKET',
    liquidity: 312000,
    spread: 0.022,
    impliedProb: 0.38,
    triageStatus: 'RELEVANT',
    triageReason: 'High-profile regulatory event with significant market interest',
    researchQueued: true,
    stage: 'DECIDED',
    description:
      'Resolves YES if TikTok is legally banned or made inaccessible to US users before July 1, 2025.',
    snapshotAt: '2025-01-15T10:05:00Z',
    category: 'politics',
  },
  {
    id: 'manifold-001',
    title: 'AGI achieved before 2030?',
    venue: 'MANIFOLD',
    liquidity: 12400,
    spread: 0.065,
    impliedProb: 0.15,
    triageStatus: 'IRRELEVANT',
    triageReason: 'Too far in the future, highly speculative, no actionable edge',
    researchQueued: false,
    stage: 'SCANNED',
    description:
      'Resolves YES if Artificial General Intelligence is widely agreed to be achieved before January 1, 2030.',
    snapshotAt: '2025-01-15T10:00:00Z',
    category: 'technology',
  },
  {
    id: 'kalshi-002',
    title: 'Will it snow in NYC on Jan 20th?',
    venue: 'KALSHI',
    liquidity: 8900,
    spread: 0.055,
    impliedProb: 0.22,
    triageStatus: 'IRRELEVANT',
    triageReason: 'Low liquidity weather market, poor risk/reward ratio',
    researchQueued: false,
    stage: 'SCANNED',
    description:
      'Resolves YES if measurable snowfall (≥1 inch) occurs at Central Park, NYC on January 20, 2025.',
    snapshotAt: '2025-01-15T09:55:00Z',
    category: 'weather',
  },
  {
    id: 'poly-005',
    title: 'Academy Award Best Picture: The Brutalist?',
    venue: 'POLYMARKET',
    liquidity: 156000,
    spread: 0.028,
    impliedProb: 0.29,
    triageStatus: 'AMBIGUOUS',
    triageReason: 'Entertainment market with subjective criteria, analysis quality uncertain',
    researchQueued: false,
    stage: 'TRIAGED',
    description:
      'Resolves YES if "The Brutalist" wins the Academy Award for Best Picture at the 97th Academy Awards.',
    snapshotAt: '2025-01-15T09:50:00Z',
    category: 'entertainment',
  },
  {
    id: 'sx-002',
    title: 'Ethereum ETF net inflows positive in January?',
    venue: 'SX_BET',
    liquidity: 45000,
    spread: 0.019,
    impliedProb: 0.61,
    triageStatus: 'RELEVANT',
    triageReason: 'Crypto ETF market with measurable on-chain data available',
    researchQueued: true,
    stage: 'EXECUTED',
    description:
      'Resolves YES if total net inflows into Ethereum spot ETFs are positive for the month of January 2025.',
    snapshotAt: '2025-01-15T09:45:00Z',
    category: 'crypto',
  },
];

// ── helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function triageBadge(status: TriageStatus) {
  const styles: Record<TriageStatus, string> = {
    RELEVANT: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    IRRELEVANT: 'border-gray-500/30 bg-gray-500/10 text-gray-500',
    AMBIGUOUS: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  };
  return (
    <Badge className={cn('text-[10px]', styles[status])}>{status}</Badge>
  );
}

function stageBadge(stage: CandidateStage) {
  return (
    <Badge className="gap-1 text-[10px]">
      <span
        className={cn(
          'inline-block h-2 w-2 rounded-full',
          STAGE_COLORS[stage] ?? 'bg-gray-500'
        )}
      />
      {stage}
    </Badge>
  );
}

function venueLabel(v: Venue): string {
  return VENUE_OPTIONS.find((o) => o.value === v)?.label ?? v;
}

function venueColor(v: Venue): string {
  return VENUE_OPTIONS.find((o) => o.value === v)?.color ?? '#888';
}

// ── component ────────────────────────────────────────────────────────────────

export function MarketTriage() {
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [venueFilter, setVenueFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchMarkets() {
      try {
        const res = await fetch('/api/markets');
        if (res.ok && !cancelled) {
          const data = await res.json();
          setMarkets(data);
        }
      } catch {
        // fallback
      } finally {
        if (!cancelled) {
          setMarkets(MOCK_MARKETS);
          setLoading(false);
        }
      }
    }
    fetchMarkets();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/markets');
      if (res.ok) {
        const data = await res.json();
        setMarkets(data);
      }
    } catch {
      // keep existing data
    } finally {
      setTimeout(() => setRefreshing(false), 800);
    }
  }, []);

  const filtered = useMemo(() => {
    return markets.filter((m) => {
      if (search && !m.title.toLowerCase().includes(search.toLowerCase()))
        return false;
      if (venueFilter !== 'ALL' && m.venue !== venueFilter) return false;
      if (statusFilter !== 'ALL' && m.triageStatus !== statusFilter) return false;
      return true;
    });
  }, [markets, search, venueFilter, statusFilter]);

  const summaryStats = useMemo(() => {
    const total = markets.length;
    const relevant = markets.filter((m) => m.triageStatus === 'RELEVANT').length;
    const queued = markets.filter((m) => m.researchQueued).length;
    const totalLiq = markets.reduce((s, m) => s + m.liquidity, 0);
    return { total, relevant, queued, totalLiq };
  }, [markets]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Market Triage</h2>
        <div className="h-64 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Market Triage</h2>
          <p className="mt-1 text-sm text-gray-500">
            Live market scanning and triage pipeline
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
          onClick={refresh}
          disabled={refreshing}
        >
          <RefreshCw
            className={cn('h-4 w-4', refreshing && 'animate-spin')}
          />
          Refresh
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          {
            label: 'Total Markets',
            value: summaryStats.total,
            color: 'text-white',
          },
          {
            label: 'Relevant',
            value: summaryStats.relevant,
            color: 'text-emerald-400',
          },
          {
            label: 'Research Queued',
            value: summaryStats.queued,
            color: 'text-amber-400',
          },
          {
            label: 'Total Liquidity',
            value: formatCurrency(summaryStats.totalLiq),
            color: 'text-cyan-400',
          },
        ].map((s) => (
          <Card
            key={s.label}
            className="border-gray-800 bg-gray-900"
          >
            <CardContent className="p-4">
              <p className="text-xs text-gray-500">{s.label}</p>
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
                placeholder="Search markets..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="border-gray-700 bg-gray-800 pl-9 text-white placeholder:text-gray-600"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-gray-500" />
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
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36 border-gray-700 bg-gray-800 text-gray-300">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-gray-700 bg-gray-900">
                  <SelectItem value="ALL">All Status</SelectItem>
                  <SelectItem value="RELEVANT">Relevant</SelectItem>
                  <SelectItem value="IRRELEVANT">Irrelevant</SelectItem>
                  <SelectItem value="AMBIGUOUS">Ambiguous</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Table */}
      <Card className="border-gray-800 bg-gray-900">
        <CardContent className="p-0">
          <div className="max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800 hover:bg-transparent">
                  <TableHead className="w-8" />
                  <TableHead className="text-gray-500">Market</TableHead>
                  <TableHead className="text-gray-500">Venue</TableHead>
                  <TableHead className="text-right text-gray-500">
                    Liquidity
                  </TableHead>
                  <TableHead className="text-right text-gray-500">
                    Spread
                  </TableHead>
                  <TableHead className="text-right text-gray-500">
                    Imp. Prob
                  </TableHead>
                  <TableHead className="text-gray-500">Triage</TableHead>
                  <TableHead className="text-gray-500">Stage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow className="border-gray-800">
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-sm text-gray-600"
                    >
                      No markets match the current filters
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((m) => (
                    <TableRow
                      key={m.id}
                      className="cursor-pointer border-gray-800 transition-colors hover:bg-gray-800/50"
                      onClick={() =>
                        setExpandedId(expandedId === m.id ? null : m.id)
                      }
                    >
                      <TableCell className="w-8 px-3">
                        {expandedId === m.id ? (
                          <ChevronDown className="h-4 w-4 text-gray-500" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-gray-600" />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-xs">
                          <p className="truncate text-sm font-medium text-gray-200">
                            {m.title}
                          </p>
                          <div className="flex items-center gap-2">
                            {m.researchQueued && (
                              <span className="text-[10px] text-amber-400">
                                ⏳ Research
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className="text-xs font-medium"
                          style={{ color: venueColor(m.venue) }}
                        >
                          {venueLabel(m.venue)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-sm tabular-nums text-gray-300">
                          {formatCurrency(m.liquidity)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={cn(
                            'text-sm tabular-nums',
                            m.spread > 0.04
                              ? 'text-red-400'
                              : m.spread > 0.02
                                ? 'text-amber-400'
                                : 'text-emerald-400'
                          )}
                        >
                          {(m.spread * 100).toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-sm tabular-nums text-gray-300">
                          {(m.impliedProb * 100).toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell>{triageBadge(m.triageStatus)}</TableCell>
                      <TableCell>{stageBadge(m.stage)}</TableCell>
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
        const m = markets.find((x) => x.id === expandedId);
        if (!m) return null;
        return (
          <Card className="border-gray-800 bg-gray-900">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-sm text-white">
                    {m.title}
                  </CardTitle>
                  <div className="mt-1 flex items-center gap-2">
                    {triageBadge(m.triageStatus)}
                    {stageBadge(m.stage)}
                    <span className="text-xs text-gray-600">
                      {m.category}
                    </span>
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
              <div>
                <p className="mb-1 text-xs font-medium text-gray-500">
                  Description
                </p>
                <p className="text-sm leading-relaxed text-gray-300">
                  {m.description}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
                  <p className="text-[11px] text-gray-500">
                    <DollarSign className="mr-1 inline h-3 w-3" />
                    Liquidity
                  </p>
                  <p className="mt-1 text-sm font-bold text-gray-200">
                    {formatCurrency(m.liquidity)}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
                  <p className="text-[11px] text-gray-500">Spread</p>
                  <p className="mt-1 text-sm font-bold text-gray-200">
                    {(m.spread * 100).toFixed(2)}%
                  </p>
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
                  <p className="text-[11px] text-gray-500">
                    Implied Probability
                  </p>
                  <p className="mt-1 text-sm font-bold text-gray-200">
                    {(m.impliedProb * 100).toFixed(1)}%
                  </p>
                </div>
                <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
                  <p className="text-[11px] text-gray-500">
                    <Clock className="mr-1 inline h-3 w-3" />
                    Last Snapshot
                  </p>
                  <p className="mt-1 text-sm font-bold text-gray-200">
                    {new Date(m.snapshotAt).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-gray-500">
                  Triage Reason
                </p>
                <p className="text-sm text-gray-400">{m.triageReason}</p>
              </div>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
