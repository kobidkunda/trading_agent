'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  FileText,
  AlertCircle,
  Clock,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  ScrollText,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  type: 'Job' | 'Audit' | 'AgentOutput';
  action: string;
  message: string;
  status: string;
  entityType?: string;
  entityId?: string;
  timestamp: string;
}

interface LogStats {
  totalLogs: number;
  failedCount: number;
  recentActivity: number;
}

type TypeFilter = 'All' | 'Jobs' | 'Audit' | 'AgentOutput';
type StatusFilter = 'All' | 'Completed' | 'Failed' | 'Running';

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: 'All', label: 'All Types' },
  { value: 'Jobs', label: 'Jobs' },
  { value: 'Audit', label: 'Audit' },
  { value: 'AgentOutput', label: 'Agent Output' },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'All', label: 'All Status' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Failed', label: 'Failed' },
  { value: 'Running', label: 'Running' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
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

function typeBadge(type: LogEntry['type']) {
  const styles: Record<string, string> = {
    Job: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
    Audit: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    AgentOutput: 'border-violet-500/30 bg-violet-500/10 text-violet-400',
  };
  return (
    <Badge
      variant="outline"
      className={cn('text-[10px] border', styles[type] ?? 'border-gray-700 text-gray-400')}
    >
      {type}
    </Badge>
  );
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    COMPLETED: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    FAILED: 'border-red-500/30 bg-red-500/10 text-red-400',
    RUNNING: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400 animate-pulse',
    RETRYING: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    PENDING: 'border-gray-500/30 bg-gray-500/10 text-gray-400',
  };
  const dotStyles: Record<string, string> = {
    COMPLETED: 'bg-emerald-400',
    FAILED: 'bg-red-400',
    RUNNING: 'bg-cyan-400 animate-pulse',
    RETRYING: 'bg-amber-400 animate-pulse',
    PENDING: 'bg-gray-400',
  };
  return (
    <Badge
      variant="outline"
      className={cn('text-[10px] gap-1 border', styles[status] ?? styles.PENDING)}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', dotStyles[status] ?? 'bg-gray-400')} />
      {status}
    </Badge>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function LogsDashboard() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<LogStats>({ totalLogs: 0, failedCount: 0, recentActivity: 0 });
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('All');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery.trim());
      setPage(1);
    }, 350);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (typeFilter !== 'All') params.set('type', typeFilter);
      if (statusFilter !== 'All') params.set('status', statusFilter);
      if (debouncedSearch) params.set('search', debouncedSearch);
      params.set('sort', sortAsc ? 'asc' : 'desc');
      params.set('page', String(page));
      params.set('limit', '25');

      const res = await fetch(`/api/logs?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries ?? []);
        if (data.stats) setStats(data.stats);
        setLastUpdated(new Date());
      }
    } catch {
      // Silently handle
    } finally {
      setLoading(false);
    }
  }, [typeFilter, statusFilter, debouncedSearch, sortAsc, page]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh) {
      refreshRef.current = setInterval(fetchLogs, 5000);
    }
    return () => {
      if (refreshRef.current) clearInterval(refreshRef.current);
    };
  }, [autoRefresh, fetchLogs]);

  // Reset page on filter change
  useEffect(() => {
    setPage(1);
  }, [typeFilter, statusFilter, debouncedSearch]);

  const canGoPrev = page > 1;
  const canGoNext = entries.length >= 25;

  // ── Loading Skeleton ────────────────────────────────────────────────────

  if (loading && entries.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600/20">
            <ScrollText className="h-4 w-4 text-emerald-400" />
          </div>
          <h2 className="text-xl font-semibold text-white">Logs</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-900" />
          ))}
        </div>
        <div className="h-80 animate-pulse rounded-xl bg-gray-900" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-600/20">
              <ScrollText className="h-4 w-4 text-emerald-400" />
            </div>
            <h2 className="text-xl font-semibold text-white">Logs</h2>
            {entries.length > 0 && (
              <Badge className="gap-1 border-gray-700 bg-gray-800 text-gray-400 text-[10px]">
                <Activity className="h-3 w-3" />
                {entries.length} entries
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Unified log viewer across Jobs, Audit, and Agent Output
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={autoRefresh}
              onCheckedChange={setAutoRefresh}
              id="logs-auto-refresh"
              className="data-[state=checked]:bg-emerald-600"
            />
            <label htmlFor="logs-auto-refresh" className="text-xs text-gray-500">
              Auto-refresh (5s)
            </label>
          </div>
          {lastUpdated && (
            <span className="text-[10px] text-gray-600">
              Updated {formatTimestamp(lastUpdated.toISOString())}
            </span>
          )}
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-gray-500" />
              <span className="text-[11px] text-gray-500">Total Logs</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-white">
              {stats.totalLogs.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-red-400" />
              <span className="text-[11px] text-gray-500">Failed</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-red-400">
              {stats.failedCount.toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-400" />
              <span className="text-[11px] text-gray-500">Recent (5m)</span>
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-emerald-400">
              {stats.recentActivity.toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filters */}
      <Card className="border-gray-800 bg-gray-900">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <Input
                placeholder="Search logs..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 border-gray-700 bg-gray-800 text-sm text-white placeholder:text-gray-600 focus-visible:border-emerald-500/50 focus-visible:ring-emerald-500/20"
              />
            </div>

            {/* Type Filter */}
            <div className="flex flex-wrap gap-1.5">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTypeFilter(opt.value)}
                  className={cn(
                    'px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-all',
                    typeFilter === opt.value
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : 'border-gray-700 bg-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-600'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Status Filter */}
            <div className="flex flex-wrap gap-1.5">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setStatusFilter(opt.value)}
                  className={cn(
                    'px-2.5 py-1.5 rounded-md text-[11px] font-medium border transition-all',
                    statusFilter === opt.value
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                      : 'border-gray-700 bg-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-600'
                  )}
                >
                  <Filter className="inline h-3 w-3 mr-1" />
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Sort Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSortAsc(!sortAsc)}
              className={cn(
                'text-xs text-gray-500 hover:text-gray-200',
                sortAsc && 'text-emerald-400'
              )}
            >
              <Clock className="h-3.5 w-3.5 mr-1" />
              {sortAsc ? 'Oldest' : 'Newest'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Log Entries Table */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm text-white">
            <FileText className="h-4 w-4 text-gray-400" />
            Log Entries
          </CardTitle>
          <CardDescription className="text-gray-500">
            {entries.length > 0
              ? `Showing ${entries.length} entries`
              : 'No log entries found'}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length > 0 ? (
            <>
              <div className="hidden sm:block">
                {/* Desktop: table view */}
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="px-4 py-2.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                          Timestamp
                        </th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                          Type
                        </th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                          Action
                        </th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                          Message
                        </th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-4 py-2.5 text-left text-[11px] font-medium text-gray-500 uppercase tracking-wider">
                          Entity
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/50">
                      {entries.map((entry) => (
                        <tr
                          key={entry.id}
                          className="transition-colors hover:bg-gray-800/30"
                        >
                          <td className="px-4 py-3">
                            <div className="flex flex-col">
                              <span className="text-xs tabular-nums text-gray-300">
                                {formatTimestamp(entry.timestamp)}
                              </span>
                              <span className="text-[10px] text-gray-600">
                                {formatDate(entry.timestamp)}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">{typeBadge(entry.type)}</td>
                          <td className="px-4 py-3">
                            <span className="text-xs text-gray-300 font-medium">
                              {entry.action}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={cn(
                                'text-xs max-w-[280px] line-clamp-2',
                                entry.status === 'FAILED'
                                  ? 'text-red-400/80'
                                  : 'text-gray-400'
                              )}
                            >
                              {entry.message}
                            </span>
                          </td>
                          <td className="px-4 py-3">{statusBadge(entry.status)}</td>
                          <td className="px-4 py-3">
                            {entry.entityType && (
                              <span className="text-[10px] text-gray-600">
                                {entry.entityType}
                                {entry.entityId && (
                                  <span className="text-gray-700">
                                    {' '}
                                    · {entry.entityId.substring(0, 8)}…
                                  </span>
                                )}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile: card list */}
              <div className="sm:hidden divide-y divide-gray-800/50">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="px-4 py-3 space-y-2 transition-colors hover:bg-gray-800/30"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {typeBadge(entry.type)}
                        {statusBadge(entry.status)}
                      </div>
                      <span className="text-[10px] tabular-nums text-gray-500">
                        {formatRelativeTime(entry.timestamp)}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-gray-300">{entry.action}</p>
                    <p
                      className={cn(
                        'text-xs',
                        entry.status === 'FAILED' ? 'text-red-400/80' : 'text-gray-400'
                      )}
                    >
                      {entry.message}
                    </p>
                    <div className="flex items-center gap-3 text-[10px] text-gray-600">
                      <span>
                        {formatDate(entry.timestamp)} {formatTimestamp(entry.timestamp)}
                      </span>
                      {entry.entityType && (
                        <span>
                          {entry.entityType} · {entry.entityId?.substring(0, 8)}…
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
                <span className="text-xs text-gray-600">
                  Page {page}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!canGoPrev}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="h-7 px-2 text-xs text-gray-500 hover:text-gray-200 disabled:opacity-30"
                  >
                    <ChevronLeft className="h-3.5 w-3.5 mr-1" />
                    Prev
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!canGoNext}
                    onClick={() => setPage((p) => p + 1)}
                    className="h-7 px-2 text-xs text-gray-500 hover:text-gray-200 disabled:opacity-30"
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-gray-600">
              <FileText className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm font-medium">No log entries found</p>
              <p className="text-xs mt-1 text-gray-700 max-w-xs text-center">
                {searchQuery || typeFilter !== 'All' || statusFilter !== 'All'
                  ? 'Try adjusting your filters or search query.'
                  : 'Logs from Jobs, Audit events, and Agent outputs will appear here as the system runs.'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
