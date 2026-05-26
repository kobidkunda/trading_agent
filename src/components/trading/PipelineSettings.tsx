'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Settings,
  Play,
  Square,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Wifi,
  WifiOff,
  Database,
  Cpu,
  Search,
  Activity,
  Zap,
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
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useTradingStore } from '@/store/trading-store';
import { getPipelineModeSummary } from '@/lib/engine/pipeline-settings-view-model';
import { summarizePipelineObservability, hasPipelineData } from '@/lib/engine/pipeline-observability-view-model';

interface WorkerState {
  status: 'STOPPED' | 'RUNNING';
  jobsProcessed: number;
  errors: number;
  lastActivity: string | null;
  currentJobType: string | null;
  error: string | null;
}

interface CredentialSummary {
  id: string;
  service: string;
  label: string;
  serviceUrl: string | null;
  testResult: string | null;
  testDetails: string | null;
}

interface HealthData {
  queueDepth: number;
  scheduledQueueDepth?: number;
  scheduledResolutionChecks?: number;
  nextScheduledJobAt?: string | null;
  nextResolutionCheckAt?: string | null;
  failingJobs: number;
  apiHealth: Record<string, 'UP' | 'DOWN' | 'DEGRADED'>;
  dbStatus: 'UP' | 'DOWN';
  vectorStatus: 'UP' | 'DOWN' | 'DEGRADED';
  lastScanAt: string | null;
  uptimeSeconds: number;
}

interface QdrantLinks {
  researchMemory?: string;
  marketSearch?: string;
  tradeHistory?: string;
}

interface ScanRunSummary {
  id: string;
}

interface CandidateSummary {
  id: string;
}

interface WatchlistSummary {
  id: string;
}

interface OpenOrderSummary {
  id: string;
}

const REQUIRED_SERVICES = [
  { key: 'qdrant', healthKey: 'Qdrant', label: 'Qdrant', icon: Database, credServices: ['qdrant'] },
  { key: 'llm', healthKey: 'LLM', label: 'Ollama / LLM', icon: Cpu, credServices: ['llm', 'ollama', 'LLM Provider'] },
  { key: 'searxng', healthKey: 'SearXNG', label: 'SearXNG', icon: Search, credServices: ['searxng'] },
] as const;

function StatusDot({ status }: { status: 'UP' | 'DOWN' | 'DEGRADED' | null | undefined }) {
  if (!status) {
    return <span className="h-2.5 w-2.5 rounded-full bg-gray-600" />;
  }
  if (status === 'UP') {
    return <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/50" />;
  }
  if (status === 'DEGRADED') {
    return <span className="h-2.5 w-2.5 rounded-full bg-amber-400 shadow-sm shadow-amber-400/50" />;
  }
  return <span className="h-2.5 w-2.5 rounded-full bg-red-400 shadow-sm shadow-red-400/50" />;
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

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PipelineSettings() {
  const { tradingMode } = useTradingStore();
  const modeSummary = getPipelineModeSummary(tradingMode);
  const [worker, setWorker] = useState<WorkerState | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [qdrantLinks, setQdrantLinks] = useState<QdrantLinks>({});
  const [scanRuns, setScanRuns] = useState<ScanRunSummary[]>([]);
  const [candidates, setCandidates] = useState<CandidateSummary[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistSummary[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenOrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [workerRes, healthRes, credsRes, settingsRes, scanRunsRes, candidatesRes, watchlistRes, openOrdersRes] = await Promise.all([
        fetch('/api/jobs/worker'),
        fetch('/api/health'),
        fetch('/api/credentials'),
        fetch('/api/settings'),
        fetch('/api/trading/scan-runs'),
        fetch('/api/trading/candidates?limit=50'),
        fetch('/api/trading/watchlist'),
        fetch('/api/trading/orders/open'),
      ]);

      if (workerRes.ok) {
        setWorker(await workerRes.json());
      }
      if (healthRes.ok) {
        setHealth(await healthRes.json());
      }
      if (credsRes.ok) {
        const data = await credsRes.json();
        setCredentials(data.credentials || []);
      }
      if (settingsRes.ok) {
        const data = await settingsRes.json();
        const links: QdrantLinks = {};
        if (Array.isArray(data.settings)) {
          for (const s of data.settings) {
            if (s.key?.startsWith('qdrant_collections_')) {
              try {
                Object.assign(links, JSON.parse(s.value));
              } catch {}
            }
          }
        }
        setQdrantLinks(links);
      }
      if (scanRunsRes.ok) {
        const data = await scanRunsRes.json();
        setScanRuns(data.scanRuns || []);
      }
      if (candidatesRes.ok) {
        const data = await candidatesRes.json();
        setCandidates(data.candidates || []);
      }
      if (watchlistRes.ok) {
        const data = await watchlistRes.json();
        setWatchlist(data.watchlist || []);
      }
      if (openOrdersRes.ok) {
        const data = await openOrdersRes.json();
        setOpenOrders(data.orders || []);
      }
    } catch {
      toast.error('Failed to fetch pipeline data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const toggleWorker = useCallback(async () => {
    if (!worker) return;
    setToggling(true);
    try {
      const action = worker.status === 'RUNNING' ? 'stop' : 'start';
      const res = await fetch('/api/jobs/worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, mode: tradingMode }),
      });
      if (res.ok) {
        const data = await res.json();
        setWorker(data);
        toast.success(action === 'start' ? 'Pipeline worker started' : 'Pipeline worker stopped');
        await fetchAll();
      } else {
        toast.error('Failed to toggle worker');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setToggling(false);
    }
  }, [worker, fetchAll, tradingMode]);

  const syncMarkets = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/markets/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Market sync complete: ${data.imported ?? 0} markets imported`);
        await fetchAll();
      } else {
        toast.error('Market sync failed');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setSyncing(false);
    }
  }, [fetchAll]);

  const getCredStatus = useCallback((credServices: readonly string[]): { has: boolean; status: string | null; label: string; url: string | null } => {
    const cred = credentials.find((c) => credServices.some((s) => c.service.toLowerCase() === s.toLowerCase()));
    return {
      has: !!cred,
      status: cred?.testResult ?? null,
      label: cred?.label ?? 'Not configured',
      url: cred?.serviceUrl ?? null,
    };
  }, [credentials]);

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Pipeline Settings</h2>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-900" />
        ))}
      </div>
    );
  }

  const isRunning = worker?.status === 'RUNNING';
  const healthApi = health?.apiHealth ?? {};
  const observability = summarizePipelineObservability({ scanRuns, candidates, watchlist, openOrders });
  const showObservability = hasPipelineData({ scanRuns, candidates, watchlist, openOrders });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Pipeline Settings</h2>
          <p className="mt-1 text-sm text-gray-500">Manage the trading pipeline worker and service connectivity</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className={cn(
              'gap-2 text-xs font-medium',
              isRunning
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            )}
            onClick={toggleWorker}
            disabled={toggling}
          >
            {toggling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isRunning ? (
              <Square className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {isRunning ? 'Stop Pipeline' : 'Start Pipeline'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-xs text-gray-400 hover:text-white"
            onClick={syncMarkets}
            disabled={syncing}
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sync Markets
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-gray-400"
            onClick={fetchAll}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Card className="border-gray-800 bg-gray-900">
        <CardContent className="p-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Mode</p>
              <p className="mt-1 text-sm font-semibold text-white">{modeSummary.title}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Data source</p>
              <p className="mt-1 text-sm font-semibold text-white">{modeSummary.dataSource}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Execution</p>
              <p className="mt-1 text-sm font-semibold text-white">{modeSummary.executionMode}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Mode warning</p>
              <p className="mt-1 text-sm text-gray-300">{modeSummary.warning}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {showObservability && (
        <Card className="border-gray-800 bg-gray-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-white">Pipeline Observability</CardTitle>
            <CardDescription className="text-xs text-gray-500">Counts from scan runs, candidates, watchlist, and open orders.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Scan Runs</p>
                <p className="mt-1 font-mono text-lg font-semibold text-white">{observability.scanRunsCount}</p>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Candidates</p>
                <p className="mt-1 font-mono text-lg font-semibold text-white">{observability.candidatesCount}</p>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Watchlist</p>
                <p className="mt-1 font-mono text-lg font-semibold text-white">{observability.watchlistCount}</p>
              </div>
              <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Open Orders</p>
                <p className="mt-1 font-mono text-lg font-semibold text-white">{observability.openOrdersCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Worker State */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg',
                isRunning ? 'bg-emerald-500/10' : 'bg-gray-800'
              )}>
                <Settings className={cn('h-4 w-4', isRunning ? 'text-emerald-400' : 'text-gray-500')} />
              </div>
              <div>
                <CardTitle className="text-sm font-semibold text-white">Worker State</CardTitle>
                <CardDescription className="text-xs text-gray-500">
                  {isRunning ? 'Currently processing jobs' : 'Worker is stopped'}
                </CardDescription>
              </div>
            </div>
            <Badge className={cn(
              'gap-1.5 text-[11px]',
              isRunning
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                : 'border-gray-600/30 bg-gray-800 text-gray-400'
            )}>
              <span className={cn(
                'h-1.5 w-1.5 rounded-full',
                isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'
              )} />
              {isRunning ? 'Running' : 'Stopped'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Processed</p>
              <p className="mt-1 font-mono text-lg font-semibold text-white">{worker?.jobsProcessed ?? 0}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Errors</p>
              <p className={cn('mt-1 font-mono text-lg font-semibold', (worker?.errors ?? 0) > 0 ? 'text-red-400' : 'text-white')}>
                {worker?.errors ?? 0}
              </p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Current Job</p>
              <p className="mt-1 font-mono text-sm font-semibold text-white">{worker?.currentJobType ?? '—'}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Last Activity</p>
              <p className="mt-1 font-mono text-sm font-semibold text-white">{formatTime(worker?.lastActivity ?? null)}</p>
            </div>
          </div>
          {worker?.error && (
            <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <p className="text-xs font-medium text-red-400">Error: {worker.error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Required Services */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
              <Wifi className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-white">Required Services</CardTitle>
              <CardDescription className="text-xs text-gray-500">Service connectivity status</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {REQUIRED_SERVICES.map((svc) => {
              const cred = getCredStatus(svc.credServices);
              const apiStatus = healthApi[svc.healthKey];
              const detail = cred.has
                ? (cred.url ? `${cred.label} - ${cred.url}` : cred.label)
                : apiStatus
                  ? 'Runtime/env configuration'
                  : 'Not configured';
              const Icon = svc.icon;
              return (
                <div key={svc.key} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-800/30 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-800">
                      <Icon className="h-4 w-4 text-gray-400" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">{svc.label}</p>
                      <p className="text-xs text-gray-500">{detail}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {apiStatus === 'UP' ? (
                      <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> UP
                      </Badge>
                    ) : apiStatus === 'DEGRADED' ? (
                      <Badge className="gap-1 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-400">
                        <AlertTriangle className="h-3 w-3" /> DEGRADED
                      </Badge>
                    ) : apiStatus === 'DOWN' ? (
                      <Badge className="gap-1 border-red-500/30 bg-red-500/10 text-[10px] text-red-400">
                        <XCircle className="h-3 w-3" /> DOWN
                      </Badge>
                    ) : cred.has && cred.status === 'SUCCESS' ? (
                      <Badge className="gap-1 border-gray-600/30 bg-gray-800 text-[10px] text-gray-400">
                        <WifiOff className="h-3 w-3" /> UNKNOWN
                      </Badge>
                    ) : (
                      <Badge className="gap-1 border-gray-600/30 bg-gray-800 text-[10px] text-gray-500">
                        <WifiOff className="h-3 w-3" /> NOT SET
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Qdrant Collection Links */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-orange-500/10">
              <Database className="h-4 w-4 text-orange-400" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-white">Qdrant Collection Links</CardTitle>
              <CardDescription className="text-xs text-gray-500">
                {Object.values(qdrantLinks).filter(Boolean).length}/3 collections linked
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {(['researchMemory', 'marketSearch', 'tradeHistory'] as const).map((key) => {
              const linked = qdrantLinks[key];
              const labels: Record<string, string> = {
                researchMemory: 'Research Memory',
                marketSearch: 'Market Search',
                tradeHistory: 'Trade History',
              };
              return (
                <div key={key} className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-800/30 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={cn('h-2 w-2 rounded-full', linked ? 'bg-emerald-400' : 'bg-gray-600')} />
                    <p className="text-sm font-medium text-white">{labels[key]}</p>
                  </div>
                  <p className={cn('text-xs font-mono', linked ? 'text-emerald-400' : 'text-gray-600')}>
                    {linked ?? 'Not linked'}
                  </p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* System Health Stats */}
      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/10">
              <Activity className="h-4 w-4 text-purple-400" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold text-white">System Health</CardTitle>
              <CardDescription className="text-xs text-gray-500">Queue and infrastructure status</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Due Queue</p>
              <p className="mt-1 font-mono text-lg font-semibold text-white">{health?.queueDepth ?? 0}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Scheduled</p>
              <p className="mt-1 font-mono text-lg font-semibold text-cyan-400">{health?.scheduledQueueDepth ?? 0}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Resolution Checks</p>
              <p className="mt-1 font-mono text-lg font-semibold text-emerald-400">{health?.scheduledResolutionChecks ?? 0}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Next Resolution</p>
              <p className="mt-1 font-mono text-sm font-semibold text-emerald-400">{formatDateTime(health?.nextResolutionCheckAt)}</p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Failing Jobs</p>
              <p className={cn('mt-1 font-mono text-lg font-semibold', (health?.failingJobs ?? 0) > 0 ? 'text-red-400' : 'text-white')}>
                {health?.failingJobs ?? 0}
              </p>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">DB Status</p>
              <div className="mt-1 flex items-center gap-2">
                <StatusDot status={health?.dbStatus} />
                <p className="font-mono text-sm font-semibold text-white">{health?.dbStatus ?? '—'}</p>
              </div>
            </div>
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 p-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Qdrant</p>
              <div className="mt-1 flex items-center gap-2">
                <StatusDot status={health?.vectorStatus} />
                <p className="font-mono text-sm font-semibold text-white">{health?.vectorStatus ?? '—'}</p>
              </div>
            </div>
          </div>
          {health?.lastScanAt && (
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-500">
              <Zap className="h-3 w-3" />
              <span>Last market scan: {new Date(health.lastScanAt).toLocaleString()}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
