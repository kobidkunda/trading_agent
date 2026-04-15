'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  RefreshCw,
  Wifi,
  WifiOff,
  Database,
  Server,
  Gauge,
  Layers,
  HardDrive,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Activity,
  Loader2,
  Zap,
  Shield,
} from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
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
import type { SystemHealth } from '@/lib/types';

// ── types ────────────────────────────────────────────────────────────────────

interface JobRow {
  id: string;
  type: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'RETRYING';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  retryCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  marketTitle?: string;
}

// ── mock data ────────────────────────────────────────────────────────────────

const MOCK_HEALTH: SystemHealth = {
  queueDepth: 12,
  failingJobs: 2,
  apiHealth: {
    Gemini: 'UP',
    OpenAI: 'DEGRADED',
    Qdrant: 'UP',
    Mem0: 'UP',
    'SearXNG': 'DOWN',
  },
  venueRateLimits: {
    POLYMARKET: { remaining: 847, resetAt: '2025-01-15T11:00:00Z' },
    KALSHI: { remaining: 234, resetAt: '2025-01-15T10:30:00Z' },
    SX_BET: { remaining: 1200, resetAt: '2025-01-15T11:00:00Z' },
    MANIFOLD: { remaining: 950, resetAt: '2025-01-15T11:00:00Z' },
  },
  walletSync: 'OK',
  dbStatus: 'UP',
  vectorStatus: 'UP',
  lastScanAt: '2025-01-15T10:30:00Z',
  uptimeSeconds: 145237,
};

const MOCK_JOBS: JobRow[] = [
  {
    id: 'job-001',
    type: 'SCAN',
    status: 'COMPLETED',
    priority: 'HIGH',
    retryCount: 0,
    createdAt: '2025-01-15T10:00:00Z',
    startedAt: '2025-01-15T10:00:02Z',
    completedAt: '2025-01-15T10:02:15Z',
    errorMessage: null,
    marketTitle: 'Market scan cycle #847',
  },
  {
    id: 'job-002',
    type: 'TRIAGE',
    status: 'COMPLETED',
    priority: 'MEDIUM',
    retryCount: 0,
    createdAt: '2025-01-15T10:02:16Z',
    startedAt: '2025-01-15T10:02:18Z',
    completedAt: '2025-01-15T10:03:45Z',
    errorMessage: null,
    marketTitle: 'Bitcoin > $150K by Dec 2025',
  },
  {
    id: 'job-003',
    type: 'RESEARCH',
    status: 'RUNNING',
    priority: 'HIGH',
    retryCount: 0,
    createdAt: '2025-01-15T10:03:50Z',
    startedAt: '2025-01-15T10:03:52Z',
    completedAt: null,
    errorMessage: null,
    marketTitle: 'Fed rate cut March 2025',
  },
  {
    id: 'job-004',
    type: 'RESEARCH',
    status: 'RUNNING',
    priority: 'MEDIUM',
    retryCount: 0,
    createdAt: '2025-01-15T10:04:00Z',
    startedAt: '2025-01-15T10:04:02Z',
    completedAt: null,
    errorMessage: null,
    marketTitle: 'TikTok banned in US by July',
  },
  {
    id: 'job-005',
    type: 'JUDGE',
    status: 'PENDING',
    priority: 'HIGH',
    retryCount: 0,
    createdAt: '2025-01-15T10:05:00Z',
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    marketTitle: 'S&P 500 > 6000 Friday close',
  },
  {
    id: 'job-006',
    type: 'RISK',
    status: 'PENDING',
    priority: 'MEDIUM',
    retryCount: 0,
    createdAt: '2025-01-15T10:05:10Z',
    startedAt: null,
    completedAt: null,
    errorMessage: null,
    marketTitle: 'ETH ETF net inflows positive',
  },
  {
    id: 'job-007',
    type: 'EXECUTE',
    status: 'COMPLETED',
    priority: 'CRITICAL',
    retryCount: 0,
    createdAt: '2025-01-15T09:30:00Z',
    startedAt: '2025-01-15T09:30:02Z',
    completedAt: '2025-01-15T09:30:08Z',
    errorMessage: null,
    marketTitle: 'BTC > $150K BUY $1,250',
  },
  {
    id: 'job-008',
    type: 'RESEARCH',
    status: 'FAILED',
    priority: 'MEDIUM',
    retryCount: 2,
    createdAt: '2025-01-15T09:15:00Z',
    startedAt: '2025-01-15T09:15:05Z',
    completedAt: '2025-01-15T09:17:30Z',
    errorMessage:
      'OpenAI API rate limit exceeded (429). Retry attempts exhausted.',
    marketTitle: 'Academy Award Best Picture',
  },
  {
    id: 'job-009',
    type: 'SETTLE',
    status: 'COMPLETED',
    priority: 'LOW',
    retryCount: 0,
    createdAt: '2025-01-15T08:00:00Z',
    startedAt: '2025-01-15T08:00:05Z',
    completedAt: '2025-01-15T08:00:15Z',
    errorMessage: null,
    marketTitle: 'S&P 500 > 6000 Friday close',
  },
  {
    id: 'job-010',
    type: 'RESEARCH',
    status: 'FAILED',
    priority: 'LOW',
    retryCount: 3,
    createdAt: '2025-01-14T22:00:00Z',
    startedAt: '2025-01-14T22:00:03Z',
    completedAt: '2025-01-14T22:05:00Z',
    errorMessage:
      'SearXNG search endpoint unreachable. Connection refused after 3 retries.',
    marketTitle: 'NFL MVP Patrick Mahomes?',
  },
  {
    id: 'job-011',
    type: 'TRIAGE',
    status: 'RETRYING',
    priority: 'LOW',
    retryCount: 1,
    createdAt: '2025-01-15T10:02:00Z',
    startedAt: '2025-01-15T10:02:05Z',
    completedAt: null,
    errorMessage: 'Gemini API timeout (504). Retrying with backoff.',
    marketTitle: 'AGI before 2030?',
  },
];

// ── helpers ──────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hrs = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hrs}h ${mins}m`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function jobStatusBadge(status: string) {
  const styles: Record<string, string> = {
    PENDING: 'border-gray-500/30 bg-gray-500/10 text-gray-400',
    RUNNING: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
    COMPLETED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    FAILED: 'border-red-500/30 bg-red-500/10 text-red-400',
    RETRYING: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  };
  return (
    <Badge className={cn('text-[10px]', styles[status] ?? styles.PENDING)}>
      {status}
    </Badge>
  );
}

function priorityColor(p: string): string {
  const colors: Record<string, string> = {
    CRITICAL: 'text-red-400',
    HIGH: 'text-amber-400',
    MEDIUM: 'text-cyan-400',
    LOW: 'text-gray-500',
  };
  return colors[p] ?? 'text-gray-500';
}

function apiStatusDot(status: string) {
  const colors: Record<string, string> = {
    UP: 'bg-emerald-400',
    DEGRADED: 'bg-amber-400',
    DOWN: 'bg-red-400',
  };
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={cn('h-2 w-2 rounded-full', colors[status] ?? 'bg-gray-500')}
      />
      <span
        className={cn(
          'text-xs font-medium',
          status === 'UP'
            ? 'text-emerald-400'
            : status === 'DEGRADED'
              ? 'text-amber-400'
              : 'text-red-400'
        )}
      >
        {status}
      </span>
    </span>
  );
}

// ── component ────────────────────────────────────────────────────────────────

export function SystemHealth() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [healthRes, jobsRes] = await Promise.all([
        fetch('/api/health'),
        fetch('/api/jobs'),
      ]);
      if (healthRes.ok) {
        const data = await healthRes.json();
        setHealth(data);
      }
      if (jobsRes.ok) {
        const data = await jobsRes.json();
        setJobs(data);
      }
    } catch {
      // fallback
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialFetch() {
      try {
        const [healthRes, jobsRes] = await Promise.all([
          fetch('/api/health'),
          fetch('/api/jobs'),
        ]);
        if (healthRes.ok && !cancelled) {
          setHealth(await healthRes.json());
        }
        if (jobsRes.ok && !cancelled) {
          setJobs(await jobsRes.json());
        }
      } catch {
        // fallback
      } finally {
        if (!cancelled) {
          setHealth(MOCK_HEALTH);
          setJobs(MOCK_JOBS);
          setLoading(false);
        }
      }
    }
    initialFetch();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        fetchData(true);
      }, 15000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchData]);

  const manualRefresh = useCallback(() => {
    fetchData();
    toast.success('Health data refreshed');
  }, [fetchData]);

  if (loading || !health) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">System Health</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-xl bg-gray-900"
            />
          ))}
        </div>
      </div>
    );
  }

  // Derived stats
  const totalJobs = jobs.length;
  const runningJobs = jobs.filter((j) => j.status === 'RUNNING').length;
  const failedJobs = jobs.filter((j) => j.status === 'FAILED').length;
  const pendingJobs = jobs.filter((j) => j.status === 'PENDING').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">System Health</h2>
          <p className="mt-1 text-sm text-gray-500">
            Real-time monitoring of system components and job queue
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
              id="auto-refresh"
              className="data-[state=checked]:bg-emerald-600"
            />
            <Label htmlFor="auto-refresh" className="text-xs text-gray-500">
              Auto-refresh (15s)
            </Label>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-gray-700 text-gray-300 hover:bg-gray-800 hover:text-white"
            onClick={manualRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={cn('h-4 w-4', refreshing && 'animate-spin')}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* Status cards grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {/* Queue Depth */}
        <StatusCard
          icon={Layers}
          label="Queue Depth"
          value={health.queueDepth}
          color={
            health.queueDepth > 20
              ? 'text-red-400'
              : health.queueDepth > 10
                ? 'text-amber-400'
                : 'text-emerald-400'
          }
          borderColor={
            health.queueDepth > 20
              ? 'border-red-500/20'
              : health.queueDepth > 10
                ? 'border-amber-500/20'
                : 'border-emerald-500/20'
          }
        />

        {/* Failing Jobs */}
        <StatusCard
          icon={XCircle}
          label="Failing Jobs"
          value={health.failingJobs}
          color={health.failingJobs > 0 ? 'text-red-400' : 'text-emerald-400'}
          borderColor={
            health.failingJobs > 0
              ? 'border-red-500/20'
              : 'border-emerald-500/20'
          }
        />

        {/* Wallet Sync */}
        <StatusCard
          icon={Shield}
          label="Wallet Sync"
          value={health.walletSync}
          color={
            health.walletSync === 'OK'
              ? 'text-emerald-400'
              : health.walletSync === 'SYNCING'
                ? 'text-amber-400'
                : 'text-red-400'
          }
          borderColor={
            health.walletSync === 'OK'
              ? 'border-emerald-500/20'
              : health.walletSync === 'SYNCING'
                ? 'border-amber-500/20'
                : 'border-red-500/20'
          }
          isText
        />

        {/* DB Status */}
        <StatusCard
          icon={Database}
          label="Database"
          value={health.dbStatus}
          color={health.dbStatus === 'UP' ? 'text-emerald-400' : 'text-red-400'}
          borderColor={
            health.dbStatus === 'UP'
              ? 'border-emerald-500/20'
              : 'border-red-500/20'
          }
          isText
        />

        {/* Vector DB */}
        <StatusCard
          icon={HardDrive}
          label="Vector DB"
          value={health.vectorStatus}
          color={
            health.vectorStatus === 'UP' ? 'text-emerald-400' : 'text-red-400'
          }
          borderColor={
            health.vectorStatus === 'UP'
              ? 'border-emerald-500/20'
              : 'border-red-500/20'
          }
          isText
        />

        {/* Last Scan */}
        <StatusCard
          icon={Search}
          label="Last Scan"
          value={
            health.lastScanAt
              ? new Date(health.lastScanAt).toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })
              : 'Never'
          }
          color="text-gray-300"
          borderColor="border-gray-800"
          isText
        />

        {/* System Uptime */}
        <StatusCard
          icon={Zap}
          label="Uptime"
          value={formatUptime(health.uptimeSeconds)}
          color="text-cyan-400"
          borderColor="border-cyan-500/20"
          isText
        />

        {/* Running Jobs */}
        <StatusCard
          icon={Activity}
          label="Running"
          value={runningJobs}
          color="text-cyan-400"
          borderColor="border-cyan-500/20"
        />

        {/* Pending Jobs */}
        <StatusCard
          icon={Clock}
          label="Pending"
          value={pendingJobs}
          color={pendingJobs > 10 ? 'text-amber-400' : 'text-gray-400'}
          borderColor={
            pendingJobs > 10 ? 'border-amber-500/20' : 'border-gray-800'
          }
        />

        {/* Total Jobs */}
        <StatusCard
          icon={Gauge}
          label="Total Jobs"
          value={totalJobs}
          color="text-white"
          borderColor="border-gray-800"
        />
      </div>

      {/* API Health & Rate Limits */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* API Health */}
        <Card className="border-gray-800 bg-gray-900">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-white">
              <Server className="h-4 w-4 text-emerald-400" />
              API Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.entries(health.apiHealth).map(([name, status]) => (
              <div
                key={name}
                className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-800/40 px-4 py-2.5"
              >
                <span className="text-sm font-medium text-gray-300">{name}</span>
                {apiStatusDot(status)}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Venue Rate Limits */}
        <Card className="border-gray-800 bg-gray-900">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-white">
              <Wifi className="h-4 w-4 text-emerald-400" />
              Venue Rate Limits
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {Object.entries(health.venueRateLimits).map(
              ([venue, info]) => {
                const pct = Math.min((info.remaining / 1000) * 100, 100);
                const venueName = {
                  POLYMARKET: 'Polymarket',
                  KALSHI: 'Kalshi',
                  SX_BET: 'SX Bet',
                  MANIFOLD: 'Manifold',
                }[venue] ?? venue;
                return (
                  <div key={venue} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-300">
                        {venueName}
                      </span>
                      <span
                        className={cn(
                          'text-xs tabular-nums',
                          pct > 50
                            ? 'text-emerald-400'
                            : pct > 20
                              ? 'text-amber-400'
                              : 'text-red-400'
                        )}
                      >
                        {info.remaining} remaining
                      </span>
                    </div>
                    <Progress
                      value={pct}
                      className={cn(
                        'h-1.5',
                        pct > 50
                          ? '[&>div]:bg-emerald-500'
                          : pct > 20
                            ? '[&>div]:bg-amber-500'
                            : '[&>div]:bg-red-500'
                      )}
                    />
                  </div>
                );
              }
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Jobs Table */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-white">Recent Jobs</CardTitle>
          <CardDescription className="text-gray-500">
            Showing last {jobs.length} jobs across all pipelines
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-gray-800 hover:bg-transparent">
                  <TableHead className="text-gray-500">Type</TableHead>
                  <TableHead className="text-gray-500">Status</TableHead>
                  <TableHead className="text-gray-500">Priority</TableHead>
                  <TableHead className="text-gray-500">Market</TableHead>
                  <TableHead className="text-right text-gray-500">
                    Retries
                  </TableHead>
                  <TableHead className="text-right text-gray-500">
                    Created
                  </TableHead>
                  <TableHead className="text-right text-gray-500">
                    Completed
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow
                    key={job.id}
                    className="border-gray-800 transition-colors hover:bg-gray-800/50"
                  >
                    <TableCell>
                      <Badge
                        variant="outline"
                        className="border-gray-700 text-[10px] text-gray-300"
                      >
                        {job.type}
                      </Badge>
                    </TableCell>
                    <TableCell>{jobStatusBadge(job.status)}</TableCell>
                    <TableCell>
                      <span className={cn('text-xs font-medium', priorityColor(job.priority))}>
                        {job.priority}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[200px]">
                        <p className="truncate text-xs text-gray-400">
                          {job.marketTitle || '—'}
                        </p>
                        {job.errorMessage && (
                          <p className="mt-0.5 truncate text-[10px] text-red-400/70">
                            {job.errorMessage}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={cn(
                          'text-xs tabular-nums',
                          job.retryCount > 0 ? 'text-amber-400' : 'text-gray-500'
                        )}
                      >
                        {job.retryCount}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-xs tabular-nums text-gray-500">
                        {formatTime(job.createdAt)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-xs tabular-nums text-gray-500">
                        {formatTime(job.completedAt)}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Label({
  className,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={className} {...props}>
      {children}
    </label>
  );
}

function StatusCard({
  icon: Icon,
  label,
  value,
  color,
  borderColor,
  isText = false,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  color: string;
  borderColor: string;
  isText?: boolean;
}) {
  return (
    <Card className={cn('border-gray-800 bg-gray-900', borderColor)}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4', color, 'opacity-50')} />
          <p className="text-xs text-gray-500">{label}</p>
        </div>
        <p
          className={cn(
            'mt-2 text-lg font-bold tabular-nums',
            color,
            isText && 'text-base'
          )}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
