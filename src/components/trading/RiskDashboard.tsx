'use client';

import { useEffect, useState } from 'react';
import {
  Shield,
  AlertTriangle,
  TrendingDown,
  BarChart3,
  XCircle,
  Gauge,
  Zap,
  Layers,
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
import type { ClusterExposure, TailRiskWarning, ClusterType, TailRiskLevel } from '@/lib/types';

interface RiskData {
  totalDailyExposure: number;
  maxDailyExposure: number;
  clusterExposures: ClusterExposure[];
  tailRiskWarnings: TailRiskWarning[];
  openPositionCount: number;
  totalUnrealizedPnl: number;
  riskLimitUtilization: number;
}

function clusterTypeLabel(type: ClusterType): string {
  const map: Record<ClusterType, string> = {
    EVENT: 'Event',
    CATEGORY: 'Category',
    RESOLUTION_SOURCE: 'Resolution Source',
    DATE_WINDOW: 'Date Window',
    UNDERLYING: 'Underlying',
  };
  return map[type] ?? type;
}

function tailRiskColor(level: TailRiskLevel): string {
  switch (level) {
    case 'CRITICAL': return 'text-red-400';
    case 'HIGH': return 'text-red-400/80';
    case 'MEDIUM': return 'text-amber-400';
    case 'LOW': return 'text-gray-400';
  }
}

function tailRiskBadgeColor(level: TailRiskLevel): string {
  switch (level) {
    case 'CRITICAL': return 'border-red-500/30 bg-red-500/10 text-red-400';
    case 'HIGH': return 'border-red-400/30 bg-red-400/10 text-red-400';
    case 'MEDIUM': return 'border-amber-500/30 bg-amber-500/10 text-amber-400';
    case 'LOW': return 'border-gray-700 bg-gray-500/10 text-gray-400';
  }
}

function utilizationColor(pct: number): string {
  if (pct >= 0.9) return 'text-red-400';
  if (pct >= 0.7) return 'text-amber-400';
  if (pct >= 0.5) return 'text-cyan-400';
  return 'text-emerald-400';
}

function progressColor(pct: number): string {
  if (pct >= 0.9) return '[&>div]:bg-red-500';
  if (pct >= 0.7) return '[&>div]:bg-amber-500';
  if (pct >= 0.5) return '[&>div]:bg-cyan-500';
  return '[&>div]:bg-emerald-500';
}

function formatCurrency(val: number): string {
  return val >= 1000 ? `$${(val / 1000).toFixed(1)}k` : `$${val.toFixed(0)}`;
}

export function RiskDashboard() {
  const [data, setData] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/risk');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load risk data');
          toast.error('Failed to load risk dashboard');
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
        <div className="h-8 w-40 animate-pulse rounded bg-gray-800" />
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
        <h2 className="text-xl font-semibold text-white">Risk Dashboard</h2>
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
        <h2 className="text-xl font-semibold text-white">Risk Dashboard</h2>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Shield className="mb-3 h-10 w-10 text-gray-500" />
            <p className="text-xs font-medium text-gray-400">No risk data available</p>
            <p className="mt-1 text-[11px] text-gray-600">Risk data populates as positions open and exposures build.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const dailyUtilPct = data.maxDailyExposure > 0 ? data.totalDailyExposure / data.maxDailyExposure : 0;
  const overallUtilPct = Math.max(0, Math.min(1, data.riskLimitUtilization));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Risk Dashboard</h2>
        <p className="mt-1 text-sm text-gray-500">
          Cluster exposures, tail-risk warnings, and daily loss limits
        </p>
      </div>

      {/* Gauge cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-gray-400" />
              <p className="text-xs text-gray-500">Daily Exposure</p>
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-white">
              {formatCurrency(data.totalDailyExposure)}
            </p>
            <p className="text-[10px] text-gray-600">
              of {formatCurrency(data.maxDailyExposure)} limit
            </p>
            <Progress value={dailyUtilPct * 100} className={cn('mt-2 h-1.5 bg-gray-800', progressColor(dailyUtilPct))} />
          </CardContent>
        </Card>

        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-gray-400" />
              <p className="text-xs text-gray-500">Open Positions</p>
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-white">{data.openPositionCount}</p>
          </CardContent>
        </Card>

        <Card className={cn(
          'border bg-gray-900',
          data.totalUnrealizedPnl >= 0 ? 'border-emerald-500/20' : 'border-red-500/20'
        )}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <TrendingDown className={cn('h-4 w-4', data.totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400')} />
              <p className="text-xs text-gray-500">Unrealized PnL</p>
            </div>
            <p className={cn('mt-2 text-2xl font-bold tabular-nums',
              data.totalUnrealizedPnl >= 0 ? 'text-emerald-400' : 'text-red-400'
            )}>
              {formatCurrency(data.totalUnrealizedPnl)}
            </p>
          </CardContent>
        </Card>

        <Card className={cn(
          'border bg-gray-900',
          overallUtilPct >= 0.9 ? 'border-red-500/20' : overallUtilPct >= 0.7 ? 'border-amber-500/20' : 'border-emerald-500/20'
        )}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Zap className={cn('h-4 w-4', utilizationColor(overallUtilPct))} />
              <p className="text-xs text-gray-500">Risk Utilization</p>
            </div>
            <p className={cn('mt-2 text-2xl font-bold tabular-nums', utilizationColor(overallUtilPct))}>
              {(overallUtilPct * 100).toFixed(0)}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Cluster exposures */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <BarChart3 className="h-4 w-4 text-emerald-400" />
            Cluster Exposures
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.clusterExposures.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <BarChart3 className="mb-2 h-8 w-8 text-gray-600" />
              <p className="text-xs text-gray-500">No cluster exposures</p>
            </div>
          ) : (
            <div className="max-h-[400px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-500">Cluster</TableHead>
                    <TableHead className="text-gray-500">Type</TableHead>
                    <TableHead className="text-right text-gray-500">Markets</TableHead>
                    <TableHead className="text-right text-gray-500">Exposure</TableHead>
                    <TableHead className="text-right text-gray-500">Utilization</TableHead>
                    <TableHead className="text-right text-gray-500">Tail Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.clusterExposures.map((c) => {
                    const utilPct = Math.min(c.utilization, 1);
                    return (
                      <TableRow key={c.clusterId} className="border-gray-800 transition-colors hover:bg-gray-800/50">
                        <TableCell>
                          <span className="text-xs font-medium text-gray-200">{c.label ?? c.clusterKey}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="border-gray-700 text-[10px] text-gray-400">
                            {clusterTypeLabel(c.clusterType)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs tabular-nums text-gray-400">{c.marketCount}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <div>
                            <span className="text-xs tabular-nums text-gray-300">{formatCurrency(c.totalExposure)}</span>
                            {c.exposureLimit && (
                              <span className="ml-1 text-[10px] text-gray-600">/ {formatCurrency(c.exposureLimit)}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Progress value={utilPct * 100} className={cn('h-1.5 w-20 bg-gray-800', progressColor(utilPct))} />
                            <span className={cn('text-xs tabular-nums w-10 text-right', utilizationColor(utilPct))}>
                              {(utilPct * 100).toFixed(0)}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {c.tailRiskLevel ? (
                            <Badge variant="outline" className={cn('text-[10px]', tailRiskBadgeColor(c.tailRiskLevel as TailRiskLevel))}>
                              {c.tailRiskLevel}
                            </Badge>
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
          )}
        </CardContent>
      </Card>

      {/* Tail risk warnings */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            Tail-Risk Warnings
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.tailRiskWarnings.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Shield className="mb-2 h-8 w-8 text-emerald-600/50" />
              <p className="text-xs text-gray-500">No tail-risk warnings</p>
              <p className="text-[11px] text-gray-600">All positions within acceptable risk bounds.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.tailRiskWarnings.map((w, i) => (
                <div key={i} className={cn(
                  'flex items-start gap-3 rounded-lg border p-3',
                  w.severity === 'CRITICAL' ? 'border-red-500/30 bg-red-500/5' :
                  w.severity === 'HIGH' ? 'border-red-400/20 bg-red-400/5' :
                  'border-amber-500/20 bg-amber-500/5'
                )}>
                  <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', tailRiskColor(w.severity))} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-200">{w.marketTitle ?? w.marketId}</p>
                    <p className="mt-0.5 text-[11px] text-gray-400">{w.warning}</p>
                    <div className="mt-1.5 flex items-center gap-3">
                      <span className={cn('text-[10px] font-medium', tailRiskColor(w.severity))}>
                        Loss: {formatCurrency(w.lossAmount)}
                      </span>
                      <span className="text-[10px] text-gray-600">
                        Wipes {w.winsWiped} of {w.totalWinningPositions} wins
                      </span>
                      <Badge variant="outline" className={cn('text-[10px]', tailRiskBadgeColor(w.severity))}>
                        {w.severity}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
