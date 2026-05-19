'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import {
  ListOrdered,
  AlertTriangle,
  XCircle,
  Zap,
  Timer,
  Layers,
  Inbox,
  Search,
  Loader2,
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
import { Progress } from '@/components/ui/progress';
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
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { usePagination } from '@/hooks/use-pagination';
import { PaginationBar } from '@/components/trading/PaginationBar';
import type { PaginationParams, PaginatedResponse } from '@/lib/types';

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
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [budgets, setBudgets] = useState<TierBudget[]>([]);
  const [fixing, setFixing] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const {
    data: jobs,
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
    fetchData,
  } = usePagination<ResearchJob>(
    async (params: PaginationParams): Promise<PaginatedResponse<ResearchJob>> => {
      const query = new URLSearchParams({
        page: String(params.page),
        limit: String(params.limit),
        sortBy: (params.sortBy as string) || 'createdAt',
        sortOrder: params.sortOrder || 'desc',
      });
      if (debouncedSearch.trim()) query.set('search', debouncedSearch.trim());
      if (statusFilter !== 'ALL') query.set('status', statusFilter);

      const res = await fetch(`/api/research?${query}`);
      if (!res.ok) throw new Error('Failed to fetch research runs');
      return res.json();
    },
    [debouncedSearch, statusFilter],
    { defaultSortBy: 'createdAt', defaultSortOrder: 'desc' },
  );

  // Fetch budgets from gating endpoint
  useEffect(() => {
    let cancelled = false;
    async function loadBudgets() {
      try {
        const res = await fetch('/api/research-gating');
        if (res.ok && !cancelled) {
          const data = await res.json();
          setBudgets(data.budgets ?? [
            { tier: 'QUICK', total: 100, used: 0, remaining: 100 },
            { tier: 'STANDARD', total: 50, used: 0, remaining: 50 },
            { tier: 'DEEP', total: 20, used: 0, remaining: 20 },
          ]);
        }
      } catch {}
    }
    loadBudgets();
    return () => { cancelled = true; };
  }, []);

  // Compute stuck/dead from current page data (stats based on full dataset count)
  const stuckCount = useMemo(() =>
    jobs.filter((j) => isStuck(j)).length,
    [jobs],
  );
  const deadCount = useMemo(() =>
    jobs.filter((j) => isDead(j)).length,
    [jobs],
  );

  const jobsByTier = useMemo(() => {
    const groups: Record<ResearchTier, ResearchJob[]> = { QUICK: [], STANDARD: [], DEEP: [] };
    for (const job of jobs) {
      const tier: ResearchTier = job.depth ?? 'STANDARD';
      groups[tier].push(job);
    }
    return groups;
  }, [jobs]);

  const isStuck = (job: ResearchJob) =>
    job.status === 'RUNNING' &&
    job.startedAt !== null &&
    (Date.now() - new Date(job.startedAt).getTime()) > 30 * 60 * 1000;

  const isDead = (job: ResearchJob) => job.status === 'FAILED' || job.status === 'STUCK';

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSort(field, sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSort(field, 'desc');
    }
  };

  const fixStuck = useCallback(async () => {
    setFixing(true);
    try {
      const res = await fetch('/api/research', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'fix_stuck' }),
      });
      if (res.ok) {
        const result = await res.json();
        toast.success(`Fixed ${result.fixed} stuck job(s)`);
        fetchData();
      }
    } catch {
      toast.error('Failed to fix stuck jobs');
    } finally {
      setFixing(false);
    }
  }, [fetchData]);

  const SortIcon = sortOrder === 'desc' ? ChevronDown : ChevronUp;

  if (loading && jobs.length === 0) {
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

  if (error && jobs.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Research Queue</h2>
        <Card className="border-red-500/30 bg-gray-900">
          <CardContent className="flex flex-col items-center py-12">
            <XCircle className="mb-3 h-10 w-10 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <Button variant="outline" size="sm" className="mt-4 border-gray-700 text-gray-300 hover:bg-gray-800" onClick={fetchData}>
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (jobs.length === 0 && !loading && !error) {
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Research Queue</h2>
          <p className="mt-1 text-sm text-gray-500">
            Research jobs by tier with budget tracking and stuck/dead job detection
          </p>
        </div>
        {/* Search + status filter + fix stuck */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
            <Input
              placeholder="Search by market..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-44 border-gray-700 bg-gray-800 pl-8 text-xs text-white placeholder:text-gray-600"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-28 border-gray-700 bg-gray-800 text-xs text-gray-300">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent className="border-gray-700 bg-gray-900">
              <SelectItem value="ALL" className="text-xs">All Status</SelectItem>
              <SelectItem value="PENDING" className="text-xs">Pending</SelectItem>
              <SelectItem value="RUNNING" className="text-xs">Running</SelectItem>
              <SelectItem value="COMPLETED" className="text-xs">Completed</SelectItem>
              <SelectItem value="FAILED" className="text-xs">Failed</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 border border-gray-700 text-xs text-amber-400 hover:bg-amber-500/10 hover:text-amber-300"
            onClick={fixStuck}
            disabled={fixing}
          >
            {fixing ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertTriangle className="h-3 w-3" />}
            Fix Stuck
          </Button>
        </div>
      </div>

      {/* Tier budget cards */}
      <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-3">
        {tiers.map((tier) => {
          const budget = budgets.find((b) => b.tier === tier) ?? { tier, total: 0, used: 0, remaining: 0 };
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
      {(stuckCount > 0 || deadCount > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {stuckCount > 0 && (
            <Card className="border-amber-500/20 bg-amber-500/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  <p className="text-xs font-medium text-amber-400">
                    {stuckCount} Stuck Job{stuckCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <p className="mt-1 text-[11px] text-amber-400/70">
                  Running for &gt;30 minutes — may need intervention
                </p>
              </CardContent>
            </Card>
          )}
          {deadCount > 0 && (
            <Card className="border-red-500/20 bg-red-500/5">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-red-400" />
                  <p className="text-xs font-medium text-red-400">
                    {deadCount} Dead Job{deadCount !== 1 ? 's' : ''}
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
              ({(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {jobs.length === 0 ? (
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
            <>
              <div className="max-h-[600px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-gray-800 hover:bg-transparent">
                      <TableHead className="text-gray-500">Market</TableHead>
                      <TableHead className="text-gray-500">Tier</TableHead>
                      <TableHead className="text-gray-500">Status</TableHead>
                      <TableHead
                        className="cursor-pointer text-right text-gray-500 hover:text-gray-300 select-none"
                        onClick={() => handleSort('startedAt')}
                      >
                        <span className="inline-flex items-center gap-1">
                          Started {sortBy === 'startedAt' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
                      <TableHead
                        className="cursor-pointer text-right text-gray-500 hover:text-gray-300 select-none"
                        onClick={() => handleSort('createdAt')}
                      >
                        <span className="inline-flex items-center gap-1">
                          Created {sortBy === 'createdAt' && <SortIcon className="h-3 w-3" />}
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => {
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
              {/* Pagination */}
              <div className="flex items-center justify-between border-t border-gray-800 px-4 py-3">
                <span className="text-xs text-gray-500">
                  Showing {(page - 1) * limit + 1}-{Math.min(page * limit, total)} of {total} jobs
                </span>
                {loading && (
                  <Loader2 className="h-4 w-4 animate-spin text-gray-500" />
                )}
                <PaginationBar page={page} totalPages={totalPages} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
