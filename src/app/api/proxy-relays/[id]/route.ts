import { NextRequest, NextResponse } from 'next/server';
import { enforceRoutePermission } from '@/lib/engine/auth';
import { decrypt } from '@/lib/engine/crypto';
import {
  getVenueProxySettings,
  saveVenueProxySettings,
  type ProxyRelay,
  type RelayStatus,
} from '@/lib/engine/venue-proxy-settings';

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function deleteRemoteDeployment(relay: ProxyRelay, token: string): Promise<string | null> {
  try {
    if (relay.platform === 'vercel' && relay.deploymentId) {
      const response = await fetch(`https://api.vercel.com/v13/deployments/${relay.deploymentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.ok ? null : `Vercel delete returned HTTP ${response.status}`;
    }
    if (relay.platform === 'cloudflare' && relay.metadata?.accountId && (relay.projectName || relay.deploymentId)) {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${relay.metadata.accountId}/workers/scripts/${relay.projectName || relay.deploymentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.ok ? null : `Cloudflare delete returned HTTP ${response.status}`;
    }
    if (relay.platform === 'deno') {
      const appId = typeof relay.metadata?.appId === 'string' ? relay.metadata.appId : relay.projectName;
      if (!appId) return 'Deno app id is not available';
      const response = await fetch(`https://api.deno.com/v2/apps/${appId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      return response.ok ? null : `Deno delete returned HTTP ${response.status}`;
    }
    return 'Remote deployment id is not available';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const denied = enforceRoutePermission(request, '/api/proxy-relays/[id]', 'PUT');
  if (denied) return denied;

  try {
    const { id } = await context.params;
    const body = await request.json();
    const settings = await getVenueProxySettings();
    const now = new Date().toISOString();
    const relays = settings.relays.map((relay) => {
      if (relay.id !== id) return relay;
      const enabled = body.enabled !== undefined ? Boolean(body.enabled) : relay.enabled;
      const status: RelayStatus = enabled ? (relay.status === 'DISABLED' ? 'UNTESTED' : relay.status) : 'DISABLED';
      return {
        ...relay,
        label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : relay.label,
        enabled,
        preferred: body.preferred !== undefined ? Boolean(body.preferred) : relay.preferred,
        status,
        updatedAt: now,
      };
    });
    const found = relays.some((relay) => relay.id === id);
    if (!found) return NextResponse.json({ error: 'Relay not found' }, { status: 404 });
    const activeRelayId = body.preferred === true ? id : settings.activeRelayId ?? null;
    const saved = await saveVenueProxySettings({
      ...settings,
      activeRelayId,
      relays: relays.map((relay) => ({ ...relay, preferred: relay.id === activeRelayId })),
    });
    return NextResponse.json({ relay: saved.relays.find((relay) => relay.id === id), activeRelayId: saved.activeRelayId ?? null });
  } catch (error) {
    console.error('[ProxyRelays] Failed to update relay:', error);
    return NextResponse.json({ error: 'Failed to update relay' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const denied = enforceRoutePermission(request, '/api/proxy-relays/[id]', 'DELETE');
  if (denied) return denied;

  try {
    const { id } = await context.params;
    const settings = await getVenueProxySettings();
    const relay = settings.relays.find((item) => item.id === id);
    if (!relay) return NextResponse.json({ error: 'Relay not found' }, { status: 404 });
    let remoteDeleteError: string | null = null;
    const account = settings.relayAccounts.find((item) => item.id === relay.accountId);
    if (account?.encryptedToken) {
      remoteDeleteError = await deleteRemoteDeployment(relay, decrypt(account.encryptedToken));
    }
    const relays = settings.relays.filter((item) => item.id !== id);
    const activeRelayId = settings.activeRelayId === id ? relays.find((item) => item.enabled)?.id ?? null : settings.activeRelayId ?? null;
    const saved = await saveVenueProxySettings({
      ...settings,
      activeRelayId,
      relays: relays.map((item) => ({ ...item, preferred: item.id === activeRelayId })),
    });
    return NextResponse.json({ success: true, remoteDeleteError, relays: saved.relays, activeRelayId: saved.activeRelayId ?? null });
  } catch (error) {
    console.error('[ProxyRelays] Failed to delete relay:', error);
    return NextResponse.json({ error: 'Failed to delete relay' }, { status: 500 });
  }
}
