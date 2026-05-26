'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cloud,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  Star,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import type { ProxyRelay, RelayPlatform, RelayStatus } from '@/lib/engine/venue-proxy-settings';

interface RelayListResponse {
  relays: ProxyRelay[];
  activeRelayId: string | null;
}

const PLATFORM_LABELS: Record<RelayPlatform, string> = {
  vercel: 'Vercel',
  deno: 'Deno',
  cloudflare: 'Cloudflare',
};

const PLATFORM_TOKEN_LINKS: Record<RelayPlatform, { href: string; label: string; hint: string }> = {
  vercel: {
    href: 'https://vercel.com/account/tokens',
    label: 'Create Vercel token',
    hint: 'Account Settings -> Tokens -> Create Token',
  },
  cloudflare: {
    href: 'https://dash.cloudflare.com/profile/api-tokens',
    label: 'Create Cloudflare token',
    hint: 'Use Workers Scripts: Edit permission for your account',
  },
  deno: {
    href: 'https://console.deno.com/',
    label: 'Open Deno Deploy console',
    hint: 'Create an access/deploy token in the Deno Deploy dashboard',
  },
};

function adminFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    headers: {
      'x-role': 'Admin',
      ...(init.headers || {}),
    },
  });
}

function statusBadge(status: RelayStatus) {
  const styles: Record<RelayStatus, string> = {
    UP: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
    DEGRADED: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
    DOWN: 'border-red-500/30 bg-red-500/10 text-red-400',
    DISABLED: 'border-gray-600 bg-gray-800 text-gray-500',
    UNTESTED: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-400',
  };
  return (
    <Badge variant="outline" className={cn('gap-1 text-[10px]', styles[status])}>
      {status === 'UP' ? <CheckCircle2 className="h-3 w-3" /> : status === 'DOWN' ? <XCircle className="h-3 w-3" /> : <Activity className="h-3 w-3" />}
      {status}
    </Badge>
  );
}

export function RelayPoolManager() {
  const [relays, setRelays] = useState<ProxyRelay[]>([]);
  const [activeRelayId, setActiveRelayId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [platform, setPlatform] = useState<RelayPlatform>('vercel');
  const [label, setLabel] = useState('Market Relay');
  const [accountLabel, setAccountLabel] = useState('Primary account');
  const [token, setToken] = useState('');
  const [projectName, setProjectName] = useState(`tradingbot-relay-${Date.now().toString(36)}`);
  const [cloudflareAccountId, setCloudflareAccountId] = useState('');
  const [denoOrgDomain, setDenoOrgDomain] = useState('');

  const healthyCount = useMemo(() => relays.filter((relay) => relay.enabled && relay.status === 'UP').length, [relays]);
  const enabledCount = useMemo(() => relays.filter((relay) => relay.enabled).length, [relays]);
  const tokenLink = PLATFORM_TOKEN_LINKS[platform];

  const loadRelays = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminFetch('/api/proxy-relays');
      if (!res.ok) throw new Error('Failed to load relays');
      const data = await res.json() as RelayListResponse;
      setRelays(data.relays || []);
      setActiveRelayId(data.activeRelayId || null);
    } catch {
      toast.error('Failed to load relay pool');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRelays();
  }, [loadRelays]);

  const deployRelay = useCallback(async () => {
    setDeploying(true);
    setLogs(['Preparing deployment request']);
    try {
      const res = await adminFetch('/api/proxy-relays/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform,
          label,
          accountLabel,
          token,
          projectName,
          cloudflareAccountId,
          denoOrgDomain,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setLogs(data.logs || []);
      if (!res.ok) {
        toast.error(data.error || 'Relay deployment failed');
        return;
      }
      toast.success('Relay deployed and saved');
      setToken('');
      await loadRelays();
    } catch {
      toast.error('Relay deployment failed');
    } finally {
      setDeploying(false);
    }
  }, [accountLabel, cloudflareAccountId, denoOrgDomain, label, loadRelays, platform, projectName, token]);

  const testRelay = useCallback(async (relay: ProxyRelay) => {
    setTestingId(relay.id);
    try {
      const res = await adminFetch(`/api/proxy-relays/${relay.id}/test`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || 'Relay test failed');
        return;
      }
      if (data.test?.ok) {
        toast.success('Relay is up', { description: `${data.test.latencyMs ?? 0}ms` });
      } else {
        toast.warning('Relay test failed', { description: data.test?.error || `${data.test?.latencyMs ?? 0}ms` });
      }
      await loadRelays();
    } catch {
      toast.error('Relay test failed');
    } finally {
      setTestingId(null);
    }
  }, [loadRelays]);

  const updateRelay = useCallback(async (relay: ProxyRelay, patch: Partial<ProxyRelay>) => {
    try {
      const res = await adminFetch(`/api/proxy-relays/${relay.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Update failed');
      await loadRelays();
    } catch {
      toast.error('Failed to update relay');
    }
  }, [loadRelays]);

  const deleteRelay = useCallback(async (relay: ProxyRelay) => {
    try {
      const res = await adminFetch(`/api/proxy-relays/${relay.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast.success('Relay removed');
      await loadRelays();
    } catch {
      toast.error('Failed to delete relay');
    }
  }, [loadRelays]);

  return (
    <Card className="border-gray-800 bg-gray-900">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base text-white">
              <Cloud className="h-4 w-4 text-emerald-400" />
              Relay Pool
            </CardTitle>
            <CardDescription className="text-xs text-gray-500">
              Dumb market-data relays for operator-owned Vercel, Deno, and Cloudflare accounts
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Badge variant="outline" className="border-emerald-500/30 text-emerald-400">{healthyCount} up</Badge>
            <Badge variant="outline" className="border-gray-700 text-gray-400">{enabledCount} enabled</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 lg:grid-cols-6">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-gray-400">Platform</Label>
              <a
                href={tokenLink.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300"
              >
                Token page <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
            <Select value={platform} onValueChange={(value) => setPlatform(value as RelayPlatform)}>
              <SelectTrigger className="h-8 border-gray-700 bg-gray-800 text-white">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-gray-700 bg-gray-900">
                <SelectItem value="vercel">Vercel</SelectItem>
                <SelectItem value="deno">Deno</SelectItem>
                <SelectItem value="cloudflare">Cloudflare</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-400">Relay Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} className="h-8 border-gray-700 bg-gray-800 text-white" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-400">Account Label</Label>
            <Input value={accountLabel} onChange={(e) => setAccountLabel(e.target.value)} className="h-8 border-gray-700 bg-gray-800 text-white" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-gray-400">Project Name</Label>
            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} className="h-8 border-gray-700 bg-gray-800 font-mono text-xs text-white" />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-gray-400">Token</Label>
              <a
                href={tokenLink.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[10px] text-cyan-400 hover:text-cyan-300"
              >
                {tokenLink.label} <ExternalLink className="h-2.5 w-2.5" />
              </a>
            </div>
            <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="h-8 border-gray-700 bg-gray-800 text-white" />
            <p className="text-[10px] leading-snug text-gray-600">{tokenLink.hint}</p>
          </div>
          <div className="flex items-end">
            <Button onClick={deployRelay} disabled={deploying || !token.trim()} className="h-8 w-full gap-2 bg-emerald-600 text-white hover:bg-emerald-700">
              {deploying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
              Deploy
            </Button>
          </div>
          {platform === 'cloudflare' && (
            <div className="space-y-1.5 lg:col-span-2">
              <Label className="text-xs text-gray-400">Cloudflare Account ID</Label>
              <Input value={cloudflareAccountId} onChange={(e) => setCloudflareAccountId(e.target.value)} className="h-8 border-gray-700 bg-gray-800 font-mono text-xs text-white" />
            </div>
          )}
          {platform === 'deno' && (
            <div className="space-y-1.5 lg:col-span-2">
              <Label className="text-xs text-gray-400">Deno Org Domain</Label>
              <Input value={denoOrgDomain} onChange={(e) => setDenoOrgDomain(e.target.value)} placeholder="your-org" className="h-8 border-gray-700 bg-gray-800 font-mono text-xs text-white" />
            </div>
          )}
        </div>

        {logs.length > 0 && (
          <div className="rounded-md border border-gray-800 bg-gray-950 px-3 py-2 font-mono text-[11px] text-gray-400">
            {logs.map((line, index) => (
              <div key={`${line}-${index}`}>{line}</div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center gap-2 rounded-md border border-gray-800 bg-gray-950 px-3 py-4 text-xs text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading relay pool
            </div>
          ) : relays.length === 0 ? (
            <div className="rounded-md border border-gray-800 bg-gray-950 px-3 py-4 text-xs text-gray-500">
              No relays yet. Deploy one from an operator-owned platform account.
            </div>
          ) : relays.map((relay) => (
            <div key={relay.id} className="grid gap-3 rounded-md border border-gray-800 bg-gray-950 px-3 py-3 lg:grid-cols-[1fr_auto]">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">{relay.label}</span>
                  <Badge variant="outline" className="border-gray-700 text-[10px] text-gray-400">{PLATFORM_LABELS[relay.platform]}</Badge>
                  {statusBadge(relay.status)}
                  {relay.id === activeRelayId && (
                    <Badge className="gap-1 border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-400">
                      <Star className="h-3 w-3" />
                      Preferred
                    </Badge>
                  )}
                </div>
                <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-gray-500">
                  <span>{relay.accountLabel}</span>
                  <a href={relay.baseUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 text-cyan-400 hover:text-cyan-300">
                    <span className="truncate font-mono">{relay.baseUrl}</span>
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  {relay.latencyMs != null && <span>{relay.latencyMs}ms</span>}
                  {relay.lastError && <span className="text-red-400">{relay.lastError}</span>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2 rounded-md border border-gray-800 px-2 py-1">
                  <Switch checked={relay.enabled} onCheckedChange={(checked) => updateRelay(relay, { enabled: checked })} />
                  <span className="text-[11px] text-gray-500">{relay.enabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 border-gray-700 text-xs text-gray-300 hover:bg-gray-800" onClick={() => testRelay(relay)} disabled={testingId === relay.id}>
                  {testingId === relay.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Test
                </Button>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 border-gray-700 text-xs text-gray-300 hover:bg-gray-800" onClick={() => updateRelay(relay, { preferred: true })}>
                  <Play className="h-3.5 w-3.5" />
                  Prefer
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-red-400/80 hover:bg-red-500/10 hover:text-red-400" onClick={() => deleteRelay(relay)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
