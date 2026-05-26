import { NextRequest, NextResponse } from 'next/server';
import { enforceRoutePermission } from '@/lib/engine/auth';
import { getVenueProxySettings, saveVenueProxySettings } from '@/lib/engine/venue-proxy-settings';

export async function GET(request: NextRequest) {
  const denied = enforceRoutePermission(request, '/api/proxy-relays', 'GET');
  if (denied) return denied;

  try {
    const settings = await getVenueProxySettings();
    return NextResponse.json({
      relays: settings.relays,
      relayAccounts: settings.relayAccounts.map((account) => ({
        id: account.id,
        platform: account.platform,
        accountLabel: account.accountLabel,
        cloudflareAccountId: account.cloudflareAccountId,
        denoOrgDomain: account.denoOrgDomain,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
      })),
      activeRelayId: settings.activeRelayId ?? null,
    });
  } catch (error) {
    console.error('[ProxyRelays] Failed to load relays:', error);
    return NextResponse.json({ error: 'Failed to load proxy relays' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const denied = enforceRoutePermission(request, '/api/proxy-relays', 'PUT');
  if (denied) return denied;

  try {
    const body = await request.json();
    const settings = await getVenueProxySettings();
    const activeRelayId = typeof body.activeRelayId === 'string' ? body.activeRelayId : settings.activeRelayId ?? null;
    const relays = settings.relays.map((relay) => ({
      ...relay,
      preferred: relay.id === activeRelayId,
    }));
    const saved = await saveVenueProxySettings({ ...settings, activeRelayId, relays });
    return NextResponse.json({ relays: saved.relays, activeRelayId: saved.activeRelayId ?? null });
  } catch (error) {
    console.error('[ProxyRelays] Failed to update relay preferences:', error);
    return NextResponse.json({ error: 'Failed to update proxy relays' }, { status: 500 });
  }
}
