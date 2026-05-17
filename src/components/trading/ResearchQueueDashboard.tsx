'use client';

import { useEffect, useState, useMemo } from 'react';
import {
  ListOrdered,
  AlertTriangle,
  XCircle,
  Zap,
  Timer,
  Layers,
  Inbox,
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

type ResearchTier = 'QUICK' | 'STANDARD' | 'DEEP';

interface ResearchJob {
  id: string;
  marketId: string;
  status: string;
  depth: ResearchTier;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  market: {
    id: string;
    title: string;
    venue: string;
    category: string;
  } | null;
}

interface TierBudget {
  tier: ResearchTier;
  total: number;
  used: number;
  remaining: number;
}

interface ResearchQueueData {
  jobs: ResearchJob[];
  budgets: TierBudget[];
  stuckCount: number;
  deadCount: number;
}

function tierBadge(tier: ResearchTier) {
  const styles: Record<ResearchTier, string> = {
    QUICK: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
    STANDARD: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    DEEP: 'border-purple-500/30 bg-purple-500/10 text-purple-400',
  };
  return (
    <Badge variant="outline" className={cn('text-[10px]', styles[tier])}>
      {tier}
    </Badge>
  );
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    PENDING: 'border-gray-500/30 bg-gray-500/10 text-gray-400',
    RUNNING: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
    COMPLETED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    FAILED: 'border-red-500/30 bg-red-500/10 text-red-400',
    STUCK: 'border-red-600/30 bg-red-600/10 text-red-500',
    DEAD: 'border-red-800/30 bg-red-800/10 text-red-600',
  };
  return (
    <Badge variant="outline" className={cn('text-[10px]', styles[status] ?? styles.PENDING)}>
      {status}
    </Badge>
  );
}

function tierIcon(tier: ResearchTier) {
  switch (tier) {
    case 'QUICK': return <Zap className="h-4 w-4 text-cyan-400" />;
    case 'STANDARD': return <Timer className="h-4 w-4 text-amber-400" />;
    case 'DEEP': return <Layers className="h-4 w-4 text-purple-400" />;
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = Date.now();
  const elapsed = now - d.getTime();
  if (elapsed < 60000) return 'just now';
  const mins = Math.floor(elapsed / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function ResearchQueueDashboard() {
  const [data, setData] = useState<ResearchQueueData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [gatingRes, jobsRes] = await Promise.all([
          fetch('/api/research-gating'),
          fetch('/api/jobs?type=RESEARCH'),
        ]);
        if (!cancelled) {
          const gatingData = gatingRes.ok ? await gatingRes.json() : null;
          const jobsData = jobsRes.ok ? await jobsRes.json() : null;

          const jobs: ResearchJob[] = (jobsData?.jobs ?? []).map((j: ResearchJob) => ({
            ...j,
            depth: j.depth ?? 'STANDARD',
          }));

          const budgets: TierBudget[] = gatingData?.budgets ?? [
            { tier: 'QUICK', total: 100, used: 0, remaining: 100 },
            { tier: 'STANDARD', total: 50, used: 0, remaining: 50 },
            { tier: 'DEEP', total: 20, used: 0, remaining: 20 },
          ];

          const stuckJobs = jobs.filter((j: ResearchJob) => j.status === 'RUNNING' &&
            j.startedAt && (Date.now() - new Date(j.startedAt).getTime()) > 30 * 60 * 1000
          );

          const deadJobs = jobs.filter((j: ResearchJob) => j.status === 'FAILED' || j.status === 'STUCK');

          setData({
            jobs,
            budgets,
            stuckCount: stuckJobs.length,
            deadCount: deadJobs.length,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load research queue');
          toast.error('Failed to load research queue');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const jobsByTier = useMemo(() => {
    if (!data) return { QUICK: [], STANDARD: [], DEEP: [] };
    const groups: Record<ResearchTier, ResearchJob[]> = { QUICK: [], STANDARD: [], DEEP: [] };
    for (const job of data.jobs) {
      const tier: ResearchTier = job.depth ?? 'STANDARD';
      groups[tier].push(job);
    }
    return groups;
  }, [data]);

  const isStuck = (job: ResearchJob) =>
    job.status === 'RUNNING' &&
    job.startedAt !== null &&
    (Date.now() - new Date(job.startedAt).getTime()) > 30 * 60 * 1000;

  const isDead = (job: ResearchJob) => job.status === 'FAILED' || job.status === 'STUCK';

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-56 animate-pulse rounded bg-gray-800" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-900" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Research Queue</h2>
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
        <h2 className="text-xl font-semibold text-white">Research Queue</h2>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <ListOrdered className="mb-3 h-10 w-10 text-gray-500" />
            <p className="text-xs font-medium text-gray-400">No research queue data</p>
            <p className="mt-1 text-[11px] text-gray-600">Queue data appears when research jobs are running.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const tiers: ResearchTier[] = ['QUICK', 'STANDARD', 'DEEP'];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Research Queue</h2>
        <p className="mt-1 text-sm text-gray-500">
          Research jobs by tier with budget tracking and stuck/dead job detection
        </p>
      </div>

      {/* Tier budget cards */}
      <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-3">
        {tiers.map((tier) => {
          const budget = data.budgets.find((b) => b.tier === tier) ?? { tier, total: 0, used: 0, remaining: 0 };
          const utilPct = budget.total > 0 ? (budget.used / budget.total) * 100 : 0;
          const jobCount = jobsByTier[tier].length;
          return (
            <Card key={tier} className="border-gray-800 bg-gray-900">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {tierIcon(tier)}
                    <p className="text-sm font-medium text-white">{tier}</p>
                  </div>
                  <span className="text-xs text-gray-500">{jobCount} jobs</span>
                </div>
                <div className="mt-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-600">Budget</span>
                    <span className={cn('text-[10px] tabular-nums',
                      utilPct >= 90 ? 'text-red-400' : utilPct >= 70 ? 'text-amber-400' : 'text-emerald-400'
                    )}>
                      {budget.remaining} / {budget.total} remaining
                    </span>
                  </div>
                  <Progress value={utilPct} className={cn(
                    'h-1.5 bg-gray-800',
                    utilPct >= 90 ? '[&>div]:bg-red-500' : utilPct >= 70 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500'
                  )} />
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Warning cards for stuck/dead */}
      {(data.stuckCount > 0 || data.deadCount > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {data.stuckCount > 0 && (
            <Card className="border-amber-500/20 bg-amber-500/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <p className="text-xs font-medium text-amber-400">
                    {data.stuckCount} Stuck Job{data.stuckCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <p className="mt-1 text-[11px] text-amber-400/70">
                  Running for &gt;30 minutes — may need intervention
                </p>
              </CardContent>
            </Card>
          )}
          {data.deadCount > 0 && (
            <Card className="border-red-500/20 bg-red-500/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-400" />
                  <p className="text-xs font-medium text-red-400">
                    {data.deadCount} Dead Job{data.deadCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <p className="mt-1 text-[11px] text-red-400/70">
                  Failed or permanently stuck jobs
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Queue table */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <ListOrdered className="h-4 w-4 text-emerald-400" />
            All Research Jobs
            <span className="ml-1 text-xs font-normal text-gray-500">
              ({data.jobs.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data.jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                <Inbox className="h-6 w-6 text-gray-500" />
              </div>
              <p className="text-xs font-medium text-gray-400">No research jobs queued</p>
              <p className="mt-1 text-[11px] text-gray-600">
                Jobs appear when markets enter the research stage.
              </p>
            </div>
          ) : (
            <div className="max-h-[600px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-gray-800 hover:bg-transparent">
                    <TableHead className="text-gray-500">Market</TableHead>
                    <TableHead className="text-gray-500">Tier</TableHead>
                    <TableHead className="text-gray-500">Status</TableHead>
                    <TableHead className="text-right text-gray-500">Started</TableHead>
                    <TableHead className="text-right text-gray-500">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.jobs.map((job) => {
                    const stuck = isStuck(job);
                    const dead = isDead(job);
                    return (
                      <TableRow key={job.id} className={cn(
                        'border-gray-800 transition-colors hover:bg-gray-800/50',
                        (stuck || dead) && 'bg-red-500/5'
                      )}>
                        <TableCell>
                          <div className="max-w-[260px]">
                            <p className="truncate text-xs font-medium text-gray-200">
                              {job.market?.title ?? '—'}
                            </p>
                            {job.market?.venue && (
                              <p className="text-[10px] text-gray-600">{job.market.venue}</p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{tierBadge(job.depth)}</TableCell>
                        <TableCell>{statusBadge(stuck ? 'STUCK' : dead ? 'DEAD' : job.status)}</TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs tabular-nums text-gray-500">{formatTime(job.startedAt)}</span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-xs tabular-nums text-gray-500">{formatTime(job.createdAt)}</span>
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
    </div>
  );
}
