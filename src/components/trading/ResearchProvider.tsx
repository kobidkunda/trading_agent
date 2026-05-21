'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  Brain,
  Search,
  Database,
  Network,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Activity,
  ExternalLink,
  ArrowRight,
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
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ProviderDef {
  key: string;
  name: string;
  description: string;
  icon: React.ElementType;
  fallback: string | null;
}

interface ProviderState {
  status: 'OK' | 'DEGRADED' | 'DOWN' | 'CONFIG_MISSING' | 'DISABLED' | 'ERROR' | 'UNKNOWN';
  latency?: number;
  error?: string;
  lastChecked?: string;
  isActive: boolean;
}

type ProviderMap = Record<string, ProviderState>;

const PROVIDER_DEFS: ProviderDef[] = [
  {
    key: 'deerflow',
    name: 'DeerFlow',
    description: 'Iterative multi-hop deep research agent with web search and content extraction',
    icon: Brain,
    fallback: 'firecrawl',
  },
  {
    key: 'firecrawl',
    name: 'Firecrawl',
    description: 'Web scraping and crawling with JavaScript rendering and structured extraction',
    icon: Search,
    fallback: null,
  },
  {
    key: 'tradingagents',
    name: 'TradingAgents',
    description: 'Multi-analyst team (News, Sentiment, Technical) with structured debate and synthesis',
    icon: Network,
    fallback: null,
  },
  {
    key: 'mirofish',
    name: 'MiroFish',
    description: 'Post-debate synthesis and prediction provider',
    icon: Brain,
    fallback: null,
  },
  {
    key: 'agent_reach',
    name: 'Agent-Reach',
    description: 'Remote research adapter for external evidence gathering and tool orchestration',
    icon: Database,
    fallback: null,
  },
];

const LOOKUP_BY_KEY: Record<string, ProviderDef> = Object.fromEntries(
  PROVIDER_DEFS.map((d) => [d.key, d])
);

export function ResearchProvider() {
  const defaultProviders = useCallback(
    (): ProviderMap =>
      Object.fromEntries(
        PROVIDER_DEFS.map((d) => [d.key, { status: 'UNKNOWN' as const, isActive: false }])
      ),
    []
  );

  const [providers, setProviders] = useState<ProviderMap>(defaultProviders);
  const [resolvedProvider, setResolvedProvider] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const fetchHealth = useCallback(async (showToast = false) => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/research/providers/health');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const apiHealth = data.providers || {};
      const resolved = typeof data.resolvedProvider === 'string' ? data.resolvedProvider : null;

      setProviders((prev) => {
        const next: ProviderMap = {};
        for (const def of PROVIDER_DEFS) {
          const raw = apiHealth[def.key];
          const status: ProviderState['status'] = raw?.status || 'UNKNOWN';
          next[def.key] = {
            status,
            latency: raw?.latency ?? prev[def.key]?.latency,
            error: raw?.error ?? prev[def.key]?.error,
            lastChecked: raw?.lastChecked || data.checkedAt || null,
            isActive: def.key === resolved,
          };
        }
        return next;
      });

      setResolvedProvider(resolved);
      setLastRefresh(new Date().toLocaleTimeString('en-US', { hour12: false }));

      if (showToast) toast.success('Provider health refreshed');
    } catch {
      if (showToast) toast.error('Failed to fetch provider health');
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  useEffect(() => {
    const interval = setInterval(() => fetchHealth(), 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const activeCount = Object.values(providers).filter((p) => p.status === 'OK').length;
  const downCount = Object.values(providers).filter((p) => p.status === 'DOWN').length;

  const statusBadge = (status: ProviderState['status']) => {
    const colors: Record<string, string> = {
      OK: 'border-emerald-700 text-emerald-400 bg-emerald-500/10',
      DOWN: 'border-red-700 text-red-400 bg-red-500/10',
      DEGRADED: 'border-amber-700 text-amber-400 bg-amber-500/10',
      CONFIG_MISSING: 'border-orange-700 text-orange-400 bg-orange-500/10',
      ERROR: 'border-red-700 text-red-400 bg-red-500/10',
      DISABLED: 'border-gray-700 text-gray-400 bg-gray-500/10',
      UNKNOWN: 'border-gray-700 text-gray-500',
    };
    return (
      <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 font-mono', colors[status] || colors.UNKNOWN)}>
        {status}
      </Badge>
    );
  };

  const statusIconColor = (status: ProviderState['status']) => {
    switch (status) {
      case 'OK': return 'bg-emerald-500/20';
      case 'DOWN': return 'bg-red-500/20';
      case 'CONFIG_MISSING': return 'bg-orange-500/20';
      default: return 'bg-gray-800';
    }
  };

  const iconColor = (status: ProviderState['status']) => {
    switch (status) {
      case 'OK': return 'text-emerald-400';
      case 'DOWN': return 'text-red-400';
      case 'CONFIG_MISSING': return 'text-orange-400';
      default: return 'text-gray-500';
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="text-xl font-semibold text-white">Research Provider</h2>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-900" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Research Provider</h2>
          <p className="mt-1 text-sm text-gray-500">
            Provider health, resolution, and active routing for research pipeline stages
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastRefresh && (
            <span className="text-[11px] text-gray-600">Last: {lastRefresh}</span>
          )}
          <Button variant="ghost" size="sm" onClick={() => fetchHealth(true)} disabled={refreshing}>
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Database className="h-4 w-4" />
              Total Providers
            </div>
            <p className="mt-1 text-2xl font-bold text-white">{PROVIDER_DEFS.length}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              Active
            </div>
            <p className="mt-1 text-2xl font-bold text-emerald-400">{activeCount}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-red-400">
              <XCircle className="h-4 w-4" />
              Down
            </div>
            <p className="mt-1 text-2xl font-bold text-red-400">{downCount}</p>
          </CardContent>
        </Card>
        <Card className="border-gray-800 bg-gray-900">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 text-sm text-violet-400">
              <Activity className="h-4 w-4" />
              Resolved
            </div>
            <p className="mt-1 text-lg font-bold text-violet-400 truncate">
              {resolvedProvider || '—'}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4">
        {PROVIDER_DEFS.map((def) => {
          const provider = providers[def.key];
          const Icon = def.icon;
          const isActive = provider.isActive;
          const fallbackDef = def.fallback ? LOOKUP_BY_KEY[def.fallback] : null;

          return (
            <Card
              key={def.key}
              className={cn(
                'border-gray-800 bg-gray-900 transition-colors',
                isActive && 'border-violet-500/30 bg-violet-500/5'
              )}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'flex h-10 w-10 items-center justify-center rounded-lg',
                        statusIconColor(provider.status)
                      )}
                    >
                      <Icon className={cn('h-5 w-5', iconColor(provider.status))} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-base text-white">{def.name}</CardTitle>
                        {statusBadge(provider.status)}
                        {isActive && (
                          <Badge className="bg-violet-500/20 text-violet-400 text-[10px] px-1.5 py-0 border-0">
                            ACTIVE
                          </Badge>
                        )}
                      </div>
                      <CardDescription className="text-gray-500 mt-0.5">
                        {def.description}
                      </CardDescription>
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-2">
                {provider.lastChecked && (
                  <div className="text-[11px] text-gray-500">
                    <ExternalLink className="inline h-2.5 w-2.5 mr-1" />
                    Checked: {new Date(provider.lastChecked).toLocaleTimeString('en-US', { hour12: false })}
                  </div>
                )}

                {provider.error && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11px] text-red-400">
                    <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
                    <span>{provider.error}</span>
                  </div>
                )}

                {provider.status === 'DOWN' && fallbackDef && (
                  <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-400">
                    <ArrowRight className="h-3 w-3 shrink-0" />
                    <span>
                      Fallback: <span className="font-medium">{fallbackDef.name}</span> — when {def.name} is unavailable, research routes to{' '}
                      {def.fallback}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Separator className="bg-gray-800" />

      <Card className="border-gray-800 bg-gray-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-white">
            <Shield className="h-4 w-4 text-violet-400" />
            Provider Resolution Logic
          </CardTitle>
          <CardDescription className="text-gray-500">
            How the system selects which research provider to use
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm text-gray-400">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-700 text-[11px] text-gray-500">1</span>
              <p>Check DeerFlow health → if UP, use DeerFlow</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-700 text-[11px] text-gray-500">2</span>
              <p>If DeerFlow DOWN and Firecrawl fallback configured → check Firecrawl health → if UP, use Firecrawl</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-700 text-[11px] text-gray-500">3</span>
              <p>Otherwise → default to DeerFlow (pipelines will handle unavailability gracefully)</p>
            </div>
          </div>
          <p className="mt-4 text-[11px] text-gray-600">
            Configure fallback provider in Strategy Hub → Service-to-Stage Routing. TradingAgents and Agent-Reach run in parallel with the primary provider when FULL research depth is selected.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
