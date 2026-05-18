'use client';

import { useEffect, useState } from 'react';
import {
  CheckCircle,
  Target,
  Award,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface OutcomeRecord {
  id: string;
  marketId: string;
  result: string;
  resolvedProb: number | null;
  resolvedAt: string;
  predictedProb: number | null;
  actualOutcome: string | null;
  brierScore: number | null;
  pnl: number | null;
  market: {
    id: string;
    title: string;
    venue: string;
    category: string;
  } | null;
}

interface OutcomeData {
  outcomes: OutcomeRecord[];
  summary: {
    total: number;
    correct: number;
    winRate: number;
    avgBrier: number;
    totalPnl: number;
  };
}

interface OutcomesApiResponse {
  outcomes?: OutcomeRecord[];
  summary?: Partial<OutcomeData['summary']>;
  resolved?: number;
  accuracy?: number | string | null;
  totalPnl?: number | null;
  recentResolved?: Array<{
    marketId?: string;
    title?: string;
    predictedProb?: number | null;
    actualOutcome?: string | null;
    correct?: boolean | null;
    createdAt?: string | Date | null;
  }>;
}

function outcomeBadge(result: string) {
  const isYes = result === 'YES';
  const isCancelled = result === 'CANCELLED';
  return (
    <Badge className={cn(
      'border-transparent text-[10px] text-white',
      isYes ? 'bg-emerald-600/70' : isCancelled ? 'bg-gray-600/70' : 'bg-red-600/70'
    )}>
      {result}
    </Badge>
  );
}

function correctBadge(correct: boolean | null) {
  if (correct === null) {
    return (
      <Badge variant="outline" className="border-gray-700 text-[10px] text-gray-500">—</Badge>
    );
  }
  return correct ? (
    <Badge className="border-transparent bg-emerald-600/20 text-[10px] text-emerald-400">Correct</Badge>
  ) : (
    <Badge className="border-transparent bg-red-600/20 text-[10px] text-red-400">Wrong</Badge>
  );
}

function brierColor(score: number | null): string {
  if (score === null) return 'text-gray-500';
  if (score <= 0.10) return 'text-emerald-400';
  if (score <= 0.20) return 'text-amber-400';
  return 'text-red-400';
}

function pnlColor(val: number | null): string {
  if (val === null) return 'text-gray-500';
  if (val > 0) return 'text-emerald-400';
  if (val < 0) return 'text-red-400';
  return 'text-gray-400';
}

function formatPct(val: number | null): string {
  if (val === null) return '—';
  return `${(val * 100).toFixed(1)}%`;
}

function formatCurrency(val: number): string {
  if (!Number.isFinite(val)) return '—';
  return val >= 1000 ? `$${(val / 1000).toFixed(1)}k` : `$${val.toFixed(2)}`;
}

function formatPnl(val: number | null): string {
  if (val === null) return '—';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${formatCurrency(val)}`;
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeOutcomesResponse(payload: OutcomesApiResponse): OutcomeData {
  const fallbackSummary: OutcomeData['summary'] = {
    total: 0,
    correct: 0,
    winRate: 0,
    avgBrier: 0,
    totalPnl: 0,
  };

  if (!payload || typeof payload !== 'object') {
    return {
      outcomes: [],
      summary: fallbackSummary,
    };
  }

  if (Array.isArray(payload.outcomes)) {
    const safeOutcomes = payload.outcomes.filter(Boolean);
    return {
      outcomes: safeOutcomes,
      summary: {
        total: typeof payload.summary?.total === 'number' ? payload.summary.total : safeOutcomes.length,
        correct: typeof payload.summary?.correct === 'number' ? payload.summary.correct : safeOutcomes.filter((outcome) => {
          if (outcome.predictedProb === null) return false;
          const predictedSide = outcome.predictedProb >= 0.5 ? 'YES' : 'NO';
          return predictedSide === outcome.result;
        }).length,
        winRate: typeof payload.summary?.winRate === 'number' ? payload.summary.winRate : 0,
        avgBrier: typeof payload.summary?.avgBrier === 'number' ? payload.summary.avgBrier : 0,
        totalPnl: typeof payload.summary?.totalPnl === 'number' ? payload.summary.totalPnl : 0,
      },
    };
  }

  const normalizedOutcomes: OutcomeRecord[] = Array.isArray(payload.recentResolved)
    ? payload.recentResolved.map((entry, index) => ({
        id: `${entry.marketId ?? 'resolved'}-${index}`,
        marketId: entry.marketId ?? `resolved-${index}`,
        result: entry.actualOutcome === 'YES' || entry.actualOutcome === 'NO' || entry.actualOutcome === 'CANCELLED'
          ? entry.actualOutcome
          : 'NO',
        resolvedProb: null,
        resolvedAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : new Date(0).toISOString(),
        predictedProb: toNullableNumber(entry.predictedProb),
        actualOutcome: entry.actualOutcome ?? null,
        brierScore: null,
        pnl: null,
        market: {
          id: entry.marketId ?? `resolved-${index}`,
          title: entry.title ?? 'Untitled market',
          venue: '—',
          category: '—',
        },
      }))
    : [];

  const total = typeof payload.resolved === 'number' ? payload.resolved : normalizedOutcomes.length;
  const correct = normalizedOutcomes.filter((outcome) => {
    if (outcome.predictedProb === null) return false;
    const predictedSide = outcome.predictedProb >= 0.5 ? 'YES' : 'NO';
    return predictedSide === outcome.result;
  }).length;
  const parsedAccuracy = typeof payload.accuracy === 'string'
    ? Number.parseFloat(payload.accuracy)
    : payload.accuracy;

  return {
    outcomes: normalizedOutcomes,
    summary: {
      total,
      correct,
      winRate: typeof parsedAccuracy === 'number' && Number.isFinite(parsedAccuracy)
        ? parsedAccuracy / 100
        : total > 0 ? correct / total : 0,
      avgBrier: 0,
      totalPnl: typeof payload.totalPnl === 'number' ? payload.totalPnl : 0,
    },
  };
}

export function OutcomesDashboard() {
  const [data, setData] = useState<OutcomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/outcomes');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(normalizeOutcomesResponse(json as OutcomesApiResponse));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load outcomes');
          toast.error('Failed to load outcomes');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-48 animate-pulse rounded bg-gray-800" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-900" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Outcomes</h2>
        <Card className="border-red-500/30 bg-gray-900">
          <CardContent className="flex flex-col items-center py-12">
            <XCircle className="mb-3 h-10 w-10 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <Button variant="outline" size="sm" className="mt-4 border-gray-700 text-gray-300 hover:bg-gray-800"
              onClick={() => { setError(null); setLoading(true); window.location.reload(); }}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const outcomes = Array.isArray(data?.outcomes) ? data.outcomes : [];
  const summary = data?.summary ?? {
    total: 0,
    correct: 0,
    winRate: 0,
    avgBrier: 0,
    totalPnl: 0,
  };

  if (!data || outcomes.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Outcomes</h2>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <CheckCircle className="mb-3 h-10 w-10 text-gray-500" />
            <p className="text-xs font-medium text-gray-400">No resolved outcomes yet</p>
            <p className="mt-1 text-[11px] text-gray-600">Outcomes appear after markets resolve.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const winRatePct = summary.winRate * 100;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Outcomes</h2>
        <p className="mt-1 text-sm text-gray-500">
          Resolved market outcomes with prediction accuracy and PnL
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total Resolved</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{summary.total}</p>
          </CardContent>
        </Card>
        <Card className={cn('border bg-gray-900', winRatePct >= 60 ? 'border-emerald-500/20' : winRatePct >= 50 ? 'border-amber-500/20' : 'border-red-500/20')}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Award className={cn('h-4 w-4', winRatePct >= 60 ? 'text-emerald-400' : winRatePct >= 50 ? 'text-amber-400' : 'text-red-400')} />
              <p className="text-xs text-gray-500">Win Rate</p>
            </div>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums',
              winRatePct >= 60 ? 'text-emerald-400' : winRatePct >= 50 ? 'text-amber-400' : 'text-red-400'
            )}>
              {winRatePct.toFixed(1)}%
            </p>
            <p className="text-[10px] text-gray-600">{summary.correct} of {summary.total} correct</p>
            <Progress value={winRatePct} className={cn(
              'mt-1.5 h-1.5 bg-gray-800',
              winRatePct >= 60 ? '[&>div]:bg-emerald-500' : winRatePct >= 50 ? '[&>div]:bg-amber-500' : '[&>div]:bg-red-500'
            )} />
          </CardContent>
        </Card>
        <Card className={cn('border bg-gray-900', (summary.avgBrier ?? 1) <= 0.10 ? 'border-emerald-500/20' : (summary.avgBrier ?? 1) <= 0.20 ? 'border-amber-500/20' : 'border-red-500/20')}>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Avg Brier</p>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', brierColor(summary.avgBrier))}>
              {summary.avgBrier?.toFixed(4) ?? '—'}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Correct</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-400">{summary.correct}</p>
          </CardContent>
        </Card>
        <Card className={cn('border bg-gray-900', (summary.totalPnl ?? 0) >= 0 ? 'border-emerald-500/20' : 'border-red-500/20')}>
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total PnL</p>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', pnlColor(summary.totalPnl))}>
              {formatPnl(summary.totalPnl)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <Target className="h-4 w-4 text-emerald-400" />
            Resolved Markets
            <span className="ml-1 text-xs font-normal text-gray-500">({outcomes.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[600px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800 hover:bg-transparent">
                  <TableHead className="text-gray-500">Market</TableHead>
                  <TableHead className="text-right text-gray-500">Predicted</TableHead>
                  <TableHead className="text-gray-500">Result</TableHead>
                  <TableHead className="text-right text-gray-500">Brier</TableHead>
                  <TableHead className="text-gray-500">Correct</TableHead>
                  <TableHead className="text-right text-gray-500">PnL</TableHead>
                  <TableHead className="text-right text-gray-500">Resolved</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {outcomes.map((o) => {
                  const predictedSide = o.predictedProb !== null ? (o.predictedProb >= 0.5 ? 'YES' : 'NO') : null;
                  const correct = predictedSide ? predictedSide === o.result : null;
                  return (
                    <TableRow key={o.id} className="border-gray-800 transition-colors hover:bg-gray-800/50">
                      <TableCell>
                        <p className="max-w-[240px] truncate text-xs font-medium text-gray-200">
                          {o.market?.title ?? '—'}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-300">{formatPct(o.predictedProb)}</span>
                      </TableCell>
                      <TableCell>{outcomeBadge(o.result)}</TableCell>
                      <TableCell className="text-right">
                        <span className={cn('text-xs font-medium tabular-nums', brierColor(o.brierScore))}>
                          {o.brierScore?.toFixed(4) ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell>{correctBadge(correct)}</TableCell>
                      <TableCell className="text-right">
                        <span className={cn('text-xs font-medium tabular-nums', pnlColor(o.pnl))}>
                          {formatPnl(o.pnl)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-500">
                          {new Date(o.resolvedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
