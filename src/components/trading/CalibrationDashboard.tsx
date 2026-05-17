'use client';

import { useEffect, useState } from 'react';
import {
  BarChart3,
  Target,
  Gauge,
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
import { Progress } from '@/components/ui/progress';
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

interface CalibrationBucket {
  label: string;
  range: [number, number];
  count: number;
  meanPrediction: number;
  meanOutcome: number;
  brierScore: number;
}

interface CategoryBrier {
  category: string;
  brierScore: number;
  count: number;
}

interface CalibrationData {
  currentBrier: number;
  rollingBrier50: number;
  rollingBrier100: number;
  totalPredictions: number;
  buckets: CalibrationBucket[];
  categoryBreakdown: CategoryBrier[];
}

function brierColor(score: number): string {
  if (score <= 0.05) return 'text-emerald-400';
  if (score <= 0.10) return 'text-cyan-400';
  if (score <= 0.20) return 'text-amber-400';
  return 'text-red-400';
}

export function CalibrationDashboard() {
  const [data, setData] = useState<CalibrationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/calibration');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load calibration');
          toast.error('Failed to load calibration data');
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
        <div className="h-8 w-56 animate-pulse rounded bg-gray-800" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-900" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-xl bg-gray-900" />
        <div className="h-48 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Calibration</h2>
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

  if (!data) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Calibration</h2>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Target className="mb-3 h-10 w-10 text-gray-500" />
            <p className="text-xs font-medium text-gray-400">No calibration data available</p>
            <p className="mt-1 text-[11px] text-gray-600">Data appears after markets resolve.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const maxBucketCount = Math.max(1, ...data.buckets.map((b) => b.count));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Calibration</h2>
        <p className="mt-1 text-sm text-gray-500">
          Brier score tracking and probability calibration analysis
        </p>
      </div>

      {/* Brier score cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Brier Score (All)</p>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', brierColor(data.currentBrier))}>
              {data.currentBrier.toFixed(4)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Rolling 50</p>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', brierColor(data.rollingBrier50))}>
              {data.rollingBrier50.toFixed(4)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Rolling 100</p>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', brierColor(data.rollingBrier100))}>
              {data.rollingBrier100.toFixed(4)}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <p className="text-xs text-gray-500">Total Predictions</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">
              {data.totalPredictions}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Calibration buckets */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <BarChart3 className="h-4 w-4 text-emerald-400" />
            Calibration Buckets
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.buckets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <BarChart3 className="mb-2 h-8 w-8 text-gray-600" />
              <p className="text-xs text-gray-500">No bucket data yet</p>
            </div>
          ) : (
            data.buckets.map((bucket) => {
              const barPct = Math.min((bucket.count / maxBucketCount) * 100, 100);
              return (
                <div key={bucket.label} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-400">{bucket.label}</span>
                    <span className="text-xs tabular-nums text-gray-500">
                      n={bucket.count} · Mean pred {bucket.meanPrediction.toFixed(2)} · Outcome {bucket.meanOutcome.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <Progress value={barPct} className="h-2 bg-gray-800 [&>div]:bg-emerald-500" />
                    </div>
                    <span className={cn('w-16 text-right text-xs font-bold tabular-nums', brierColor(bucket.brierScore))}>
                      {bucket.brierScore.toFixed(4)}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Category breakdown */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <Gauge className="h-4 w-4 text-emerald-400" />
            Category Brier Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.categoryBreakdown.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Target className="mb-2 h-8 w-8 text-gray-600" />
              <p className="text-xs text-gray-500">No category data yet</p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-500">Category</TableHead>
                    <TableHead className="text-right text-gray-500">Count</TableHead>
                    <TableHead className="text-right text-gray-500">Brier Score</TableHead>
                    <TableHead className="text-right text-gray-500">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.categoryBreakdown.map((cat) => (
                    <TableRow key={cat.category} className="border-gray-800 transition-colors hover:bg-gray-800/50">
                      <TableCell>
                        <span className="text-xs font-medium text-gray-200">{cat.category}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs tabular-nums text-gray-400">{cat.count}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cn('text-xs font-bold tabular-nums', brierColor(cat.brierScore))}>
                          {cat.brierScore.toFixed(4)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className={cn(
                          'text-[10px]',
                          cat.brierScore <= 0.10
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                            : cat.brierScore <= 0.20
                              ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                              : 'border-red-500/30 bg-red-500/10 text-red-400'
                        )}>
                          {cat.brierScore <= 0.10 ? 'Good' : cat.brierScore <= 0.20 ? 'Fair' : 'Poor'}
                        </Badge>
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
