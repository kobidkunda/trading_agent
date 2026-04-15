'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  Radio,
  ScanSearch,
  Filter,
  BookOpen,
  Scale,
  ShieldAlert,
  Play,
  CheckCircle2,
  ChevronRight,
  AlertTriangle,
  Clock,
  RefreshCw,
  Zap,
  Database,
  HardDrive,
  Bot,
  Search,
  Brain,
  SkipForward,
  CircleDot,
  ArrowRight,
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
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

interface Job {
  id: string;
  type: string;
  status: string;
  priority: number;
  payload: string | null;
  result: string | null;
  retryCount: number;
  maxRetries: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

interface HealthData {
  queueDepth?: number;
  failingJobs?: number;
  apiHealth?: Record<string, 'UP' | 'DOWN' | 'DEGRADED'>;
  venueRateLimits?: Record<string, { remaining: number; resetAt: string }>;
  walletSync?: string;
  dbStatus?: string;
  vectorStatus?: string;
  lastScanAt?: string | null;
  uptimeSeconds?: number;
  jobsByType?: Record<string, number>;
  jobsByStatus?: Record<string, number>;
  recentErrors?: Array<{ id: string; type: string; status: string; error: string; updatedAt: string }>;
  recentCompleted?: Array<{ id: string; type: string; completedAt: string }>;
}

type JobType = 'SCAN' | 'TRIAGE' | 'RESEARCH' | 'JUDGE' | 'RISK' | 'EXECUTE' | 'SETTLE';

const JOB_TYPES: JobType[] = ['SCAN', 'TRIAGE', 'RESEARCH', 'JUDGE', 'RISK', 'EXECUTE', 'SETTLE'];

const REQUIRED_SERVICES = ['Postgres', 'Redis', 'Qdrant', 'Ollama', 'SearXNG', 'Mem0'] as const;

// ── Agent config ───────────────────────────────────────────────────────────

const AGENT_CONFIG: Record<JobType, { label: string; icon: React.ElementType; color: string }> = {
  SCAN: { label: 'Scanner', icon: ScanSearch, color: 'text-blue-400' },
  TRIAGE: { label: 'Triage', icon: Filter, color: 'text-violet-400' },
  RESEARCH: { label: 'Research', icon: BookOpen, color: 'text-amber-400' },
  JUDGE: { label: 'Judge', icon: Scale, color: 'text-emerald-400' },
  RISK: { label: 'Risk', icon: ShieldAlert, color: 'text-red-400' },
  EXECUTE: { label: 'Execute', icon: Play, color: 'text-cyan-400' },
  SETTLE: { label: 'Settle', icon: CheckCircle2, color: 'text-green-400' },
};

// ── Helpers ────────────────────────────────────────────────────────────────

function parsePayload(payload: string | null): Record<string, unknown> | null {
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function getMarketTitle(payload: string | null): string {
  const parsed = parsePayload(payload);
  if (!parsed) return '—';
  return (parsed.marketTitle as string) || (parsed.title as string) || (parsed.market as string) || '—';
}

function formatDuration(startedAt: string | null): string {
  if (!startedAt) return '—';
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diffMs = now - start;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function jobStatusBadge(status: string) {
  const styles: Record<string, string> = {
    PENDING: 'border-gray-500/30 bg-gray-500/10 text-gray-400',
    RUNNING: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
    COMPLETED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    FAILED: 'border-red-500/30 bg-red-500/10 text-red-400',
    RETRYING: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
  };
  const dotStyles: Record<string, string> = {
    PENDING: 'bg-gray-400',
    RUNNING: 'bg-cyan-400 animate-pulse',
    COMPLETED: 'bg-emerald-400',
    FAILED: 'bg-red-400',
    RETRYING: 'bg-amber-400 animate-pulse',
  };
  return (
    <Badge className={cn('text-[10px] gap-1', styles[status] ?? styles.PENDING)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dotStyles[status] ?? 'bg-gray-400')} />
      {status}
    </Badge>
  );
}

function jobTypeBadge(type: string) {
  const config = AGENT_CONFIG[type as JobType];
  const colorClass = config?.color ?? 'text-gray-400';
  return (
    <Badge variant="outline" className={cn('text-[10px] border-gray-700', colorClass)}>
      {type}
    </Badge>
  );
}

function priorityLabel(priority: number): string {
  if (priority >= 9) return 'CRITICAL';
  if (priority >= 7) return 'HIGH';
  if (priority >= 4) return 'MEDIUM';
  return 'LOW';
}

function priorityColor(priority: number): string {
  if (priority >= 9) return 'text-red-400';
  if (priority >= 7) return 'text-amber-400';
  if (priority >= 4) return 'text-cyan-400';
  return 'text-gray-500';
}

// ── Component ──────────────────────────────────────────────────────────────

export function LiveStatus() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [skippedServices, setSkippedServices] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const jobsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const healthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Tick every second for duration calculations
  useEffect(() => {
    tickRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const fetchJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/jobs?limit=50');
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs ?? []);
        setLastUpdated(new Date());
      }
    } catch {
      // Silently handle fetch failures
    }
  }, []);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch {
      // Silently handle fetch failures
    }
  }, []);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    async function initialLoad() {
      try {
        const [jobsRes, healthRes] = await Promise.all([
          fetch('/api/jobs?limit=50'),
          fetch('/api/health'),
        ]);
        if (!cancelled) {
          if (jobsRes.ok) {
            const data = await jobsRes.json();
            setJobs(data.jobs ?? []);
            setLastUpdated(new Date());
          }
          if (healthRes.ok) {
            setHealth(await healthRes.json());
          }
        }
      } catch {
        // Silently handle
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    initialLoad();
    return () => { cancelled = true; };
  }, []);

  // Auto-refresh jobs every 5 seconds
  useEffect(() => {
    if (autoRefresh) {
      jobsIntervalRef.current = setInterval(fetchJobs, 5000);
    }
    return () => {
      if (jobsIntervalRef.current) clearInterval(jobsIntervalRef.current);
    };
  }, [autoRefresh, fetchJobs]);

  // Auto-refresh health every 10 seconds
  useEffect(() => {
    healthIntervalRef.current = setInterval(fetchHealth, 10000);
    return () => {
      if (healthIntervalRef.current) clearInterval(healthIntervalRef.current);
    };
  }, [fetchHealth]);

  const toggleSkipService = useCallback((service: string) => {
    setSkippedServices((prev) => {
      const next = new Set(prev);
      if (next.has(service)) {
        next.delete(service);
      } else {
        next.add(service);
      }
      return next;
    });
  }, []);

  // ── Derived data ────────────────────────────────────────────────────────

  const statsByType = useMemo(() => {
    const stats: Record<string, { running: number; pending: number; failed: number; total: number; retrying: number }> = {};
    for (const type of JOB_TYPES) {
      stats[type] = { running: 0, pending: 0, failed: 0, total: 0, retrying: 0 };
    }
    for (const job of jobs) {
      if (!stats[job.type]) continue;
      stats[job.type].total++;
      if (job.status === 'RUNNING') stats[job.type].running++;
      if (job.status === 'PENDING') stats[job.type].pending++;
      if (job.status === 'FAILED') stats[job.type].failed++;
      if (job.status === 'RETRYING') stats[job.type].retrying++;
    }
    return stats;
  }, [jobs]);

  const runningJobs = useMemo(
    () => jobs.filter((j) => j.status === 'RUNNING' || j.status === 'RETRYING'),
    [jobs]
  );

  const recentJobs = useMemo(() => jobs.slice(0, 20), [jobs]);

  // Service status
  const serviceStatuses = useMemo(() => {
    const apiHealth = health?.apiHealth ?? {};
    return REQUIRED_SERVICES.map((service) => {
      const status = apiHealth[service] as string | undefined;
      let resolvedStatus: 'UP' | 'DOWN' | 'UNCONFIGURED';
      if (status === 'UP' || status === 'DEGRADED') {
        resolvedStatus = 'UP';
      } else if (status === 'DOWN') {
        resolvedStatus = 'DOWN';
      } else {
        resolvedStatus = 'UNCONFIGURED';
      }
      const isSkipped = skippedServices.has(service);
      return { name: service, status: resolvedStatus, isSkipped };
    });
  }, [health, skippedServices]);

  const totalRunning = jobs.filter((j) => j.status === 'RUNNING').length;
  const totalPending = jobs.filter((j) => j.status === 'PENDING').length;
  const totalFailed = jobs.filter((j) => j.status === 'FAILED').length;

  // ── Loading state ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Live Status</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-900" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-600/20">
              <Radio className="h-4 w-4 text-cyan-400" />
            </div>
            <h2 className="text-xl font-semibold text-white">Live Status</h2>
            {totalRunning > 0 && (
              <Badge className="gap-1 border-cyan-500/30 bg-cyan-500/10 text-cyan-400 text-[10px]">
                <CircleDot className="h-3 w-3 animate-pulse" />
                {totalRunning} active
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Real-time agent activity &amp; pipeline monitoring
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
              id="live-auto-refresh"
              className="data-[state=checked]:bg-emerald-600"
            />
            <label htmlFor="live-auto-refresh" className="text-xs text-gray-500">
              Auto-refresh (5s)
            </label>
          </div>
          {lastUpdated && (
            <span className="text-[10px] text-gray-600">
              Updated {formatTime(lastUpdated.toISOString())}
            </span>
          )}
        </div>
      </div>

      {/* ═══════════════════════ Section A: Active Agents Panel ═══════════════════════ */}
      <section aria-label="Active Agents">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Active Agents
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
          {JOB_TYPES.map((type) => {
            const config = AGENT_CONFIG[type];
            const stats = statsByType[type];
            const Icon = config.icon;
            const isActive = stats.running + stats.retrying > 0;
            const hasFailures = stats.failed > 0;
            const activeCount = stats.running + stats.retrying;
            const completedCount = stats.total - activeCount - stats.pending - stats.failed;

            let cardBorder = 'border-gray-800';
            let cardGlow = '';
            if (hasFailures) {
              cardBorder = 'border-red-500/30';
              cardGlow = 'shadow-sm shadow-red-500/5';
            } else if (isActive) {
              cardBorder = 'border-emerald-500/30';
              cardGlow = 'shadow-sm shadow-emerald-500/5';
            }

            return (
              <Card
                key={type}
                className={cn(
                  'border-gray-800 bg-gray-900 transition-all duration-300',
                  cardBorder,
                  cardGlow,
                  !isActive && !hasFailures && 'opacity-60'
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <Icon className={cn('h-4 w-4', isActive ? 'text-emerald-400' : hasFailures ? 'text-red-400' : 'text-gray-500')} />
                    {hasFailures && (
                      <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                    )}
                  </div>

                  <p className="mt-2 text-[11px] font-medium text-gray-400">
                    {config.label}
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-white">
                    {activeCount}
                  </p>

                  {/* Progress bar: active out of total */}
                  {stats.total > 0 ? (
                    <div className="mt-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-600">
                          {activeCount}/{stats.total}
                        </span>
                        <span className="text-[10px] text-gray-600">
                          {stats.pending}q
                        </span>
                      </div>
                      <Progress
                        value={stats.total > 0 ? (activeCount / stats.total) * 100 : 0}
                        className={cn(
                          'mt-1 h-1',
                          isActive
                            ? '[&>div]:bg-emerald-500'
                            : hasFailures
                              ? '[&>div]:bg-red-500'
                              : '[&>div]:bg-gray-600'
                        )}
                      />
                    </div>
                  ) : (
                    <p className="mt-2 text-[10px] text-gray-600">No jobs</p>
                  )}

                  {/* Mini stats row */}
                  <div className="mt-2 flex gap-2 text-[10px]">
                    {stats.pending > 0 && (
                      <span className="text-gray-500">
                        <Clock className="mr-0.5 inline h-2.5 w-2.5" />
                        {stats.pending}
                      </span>
                    )}
                    {stats.failed > 0 && (
                      <span className="text-red-400/70">
                        <AlertTriangle className="mr-0.5 inline h-2.5 w-2.5" />
                        {stats.failed}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ═══════════════════════ Section B: Pipeline Flow ═══════════════════════ */}
      <section aria-label="Pipeline Flow">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
          Pipeline Flow
        </h3>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-1 overflow-x-auto pb-2">
              {JOB_TYPES.map((type, index) => {
                const stats = statsByType[type];
                const config = AGENT_CONFIG[type];
                const Icon = config.icon;
                const isActive = stats.running + stats.retrying > 0;
                const hasFailures = stats.failed > 0;

                return (
                  <div key={type} className="flex items-center">
                    <div
                      className={cn(
                        'flex min-w-[90px] flex-col items-center gap-1.5 rounded-lg border px-3 py-3 transition-all duration-300 sm:min-w-[100px]',
                        isActive
                          ? 'border-emerald-500/40 bg-emerald-500/5 shadow-sm shadow-emerald-500/10'
                          : hasFailures
                            ? 'border-red-500/30 bg-red-500/5'
                            : 'border-gray-800 bg-gray-800/40'
                      )}
                    >
                      <div className="relative">
                        <Icon
                          className={cn(
                            'h-5 w-5 transition-colors',
                            isActive ? 'text-emerald-400' : hasFailures ? 'text-red-400' : 'text-gray-500'
                          )}
                        />
                        {isActive && (
                          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />
                        )}
                        {hasFailures && !isActive && (
                          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-400" />
                        )}
                      </div>
                      <span className={cn(
                        'text-[11px] font-medium',
                        isActive ? 'text-emerald-300' : hasFailures ? 'text-red-300' : 'text-gray-500'
                      )}>
                        {config.label}
                      </span>
                      <div className="flex items-center gap-1">
                        {stats.running > 0 && (
                          <Badge className="h-4 px-1 text-[9px] border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                            {stats.running}r
                          </Badge>
                        )}
                        {stats.pending > 0 && (
                          <Badge className="h-4 px-1 text-[9px] border-gray-500/30 bg-gray-500/10 text-gray-400">
                            {stats.pending}q
                          </Badge>
                        )}
                        {stats.failed > 0 && (
                          <Badge className="h-4 px-1 text-[9px] border-red-500/30 bg-red-500/10 text-red-400">
                            {stats.failed}f
                          </Badge>
                        )}
                        {stats.running === 0 && stats.pending === 0 && stats.failed === 0 && (
                          <span className="text-[9px] text-gray-600">idle</span>
                        )}
                      </div>
                    </div>
                    {index < JOB_TYPES.length - 1 && (
                      <ArrowRight className="mx-1 h-4 w-4 shrink-0 text-gray-700" />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* ═══════════════════════ Section C: Running Jobs Table ═══════════════════════ */}
      <section aria-label="Currently Running Jobs">
        <Card className="border-gray-800 bg-gray-900">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm text-white">
              <Zap className="h-4 w-4 text-cyan-400" />
              Currently Running Jobs
            </CardTitle>
            <CardDescription className="text-gray-500">
              {runningJobs.length > 0
                ? `${runningJobs.length} job${runningJobs.length !== 1 ? 's' : ''} in progress`
                : 'No agents currently active'}
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {runningJobs.length > 0 ? (
              <div className="max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-transparent">
                      <TableHead className="text-gray-500">Type</TableHead>
                      <TableHead className="text-gray-500">Market</TableHead>
                      <TableHead className="text-gray-500 hidden sm:table-cell">Started At</TableHead>
                      <TableHead className="text-gray-500">Duration</TableHead>
                      <TableHead className="text-gray-500 hidden md:table-cell">Priority</TableHead>
                      <TableHead className="text-right text-gray-500">Retries</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runningJobs.map((job) => (
                      <TableRow
                        key={job.id}
                        className="border-gray-800 transition-colors hover:bg-gray-800/50"
                      >
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {jobTypeBadge(job.type)}
                            {job.status === 'RETRYING' && (
                              <Badge className="text-[9px] border-amber-500/30 bg-amber-500/10 text-amber-400">
                                RETRY
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="max-w-[200px] truncate text-xs text-gray-300">
                            {getMarketTitle(job.payload)}
                          </p>
                          {job.error && (
                            <p className="mt-0.5 max-w-[200px] truncate text-[10px] text-red-400/60">
                              {job.error}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">
                          <span className="text-xs tabular-nums text-gray-500">
                            {job.startedAt ? formatTime(job.startedAt) : '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs tabular-nums text-cyan-400">
                            {formatDuration(job.startedAt)}
                          </span>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <span className={cn('text-xs font-medium', priorityColor(job.priority))}>
                            {priorityLabel(job.priority)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={cn(
                            'text-xs tabular-nums',
                            job.retryCount > 0 ? 'text-amber-400' : 'text-gray-500'
                          )}>
                            {job.retryCount}/{job.maxRetries}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-gray-600">
                <Clock className="h-8 w-8 mb-2 opacity-30" />
                <p className="text-sm font-medium">No agents currently active</p>
                <p className="text-xs mt-1 text-gray-700">New jobs will appear here when they start running</p>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ═══════════════════════ Bottom grid: Activity Feed + Services ═══════════════════════ */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* ═══════════════════════ Section D: Recent Activity Feed ═══════════════════════ */}
        <section aria-label="Recent Activity" className="lg:col-span-3">
          <Card className="border-gray-800 bg-gray-900 h-full">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-white">
                <RefreshCw className="h-4 w-4 text-gray-400" />
                Recent Activity
              </CardTitle>
              <CardDescription className="text-gray-500">
                Last {recentJobs.length} jobs across all types
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {recentJobs.length > 0 ? (
                <div className="max-h-96 overflow-y-auto divide-y divide-gray-800/50">
                  {recentJobs.map((job) => (
                    <div
                      key={job.id}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-800/30"
                    >
                      <div className="shrink-0">{jobStatusBadge(job.status)}</div>
                      <div className="shrink-0">{jobTypeBadge(job.type)}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs text-gray-300">
                          {getMarketTitle(job.payload)}
                        </p>
                        {job.error && job.status === 'FAILED' && (
                          <p className="mt-0.5 truncate text-[10px] text-red-400/60">
                            {job.error}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-[10px] tabular-nums text-gray-600">
                        {formatRelativeTime(job.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-gray-600">
                  <Clock className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm font-medium">No activity yet</p>
                  <p className="text-xs mt-1 text-gray-700">Jobs will appear here as they are created</p>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        {/* ═══════════════════════ Section E: Service Dependency Status ═══════════════════════ */}
        <section aria-label="Service Dependencies" className="lg:col-span-2">
          <Card className="border-gray-800 bg-gray-900 h-full">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-white">
                <Database className="h-4 w-4 text-gray-400" />
                Service Dependencies
              </CardTitle>
              <CardDescription className="text-gray-500">
                Required Docker services
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {serviceStatuses.map((service) => {
                const isDown = service.status === 'DOWN' || service.status === 'UNCONFIGURED';
                const isSkipped = service.isSkipped;
                const isDegraded = (health?.apiHealth?.[service.name] as string) === 'DEGRADED';

                return (
                  <div
                    key={service.name}
                    className={cn(
                      'flex items-center justify-between rounded-lg border px-3 py-2.5 transition-all',
                      isSkipped
                        ? 'border-gray-800/50 bg-gray-800/20 opacity-50'
                        : isDown
                          ? 'border-red-500/20 bg-red-500/5'
                          : 'border-gray-800 bg-gray-800/40'
                    )}
                  >
                    <div className="flex items-center gap-2.5">
                      {/* Status dot */}
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full',
                          isSkipped
                            ? 'bg-gray-600'
                            : service.status === 'UP' && isDegraded
                              ? 'bg-amber-400'
                              : service.status === 'UP'
                                ? 'bg-emerald-400'
                                : service.status === 'DOWN'
                                  ? 'bg-red-400'
                                  : 'bg-gray-500'
                        )}
                      />
                      <div className="flex flex-col">
                        <span className={cn(
                          'text-xs font-medium',
                          isSkipped ? 'text-gray-500' : 'text-gray-300'
                        )}>
                          {service.name}
                        </span>
                        <span className={cn(
                          'text-[10px]',
                          isSkipped
                            ? 'text-gray-600'
                            : service.status === 'UP' && isDegraded
                              ? 'text-amber-400/70'
                              : service.status === 'UP'
                                ? 'text-emerald-400/70'
                                : service.status === 'DOWN'
                                  ? 'text-red-400/70'
                                  : 'text-gray-600'
                        )}>
                          {isSkipped
                            ? 'Skipped'
                            : service.status === 'UP' && isDegraded
                              ? 'DEGRADED'
                              : service.status
                          }
                        </span>
                      </div>
                    </div>
                    {(isDown || service.status === 'UNCONFIGURED') && !isSkipped && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] text-gray-400 hover:bg-gray-700 hover:text-gray-200"
                        onClick={() => toggleSkipService(service.name)}
                      >
                        <SkipForward className="mr-1 h-3 w-3" />
                        Skip
                      </Button>
                    )}
                    {isSkipped && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px] text-gray-500 hover:bg-gray-700 hover:text-gray-300"
                        onClick={() => toggleSkipService(service.name)}
                      >
                        Enable
                      </Button>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
