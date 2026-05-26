import { NextRequest, NextResponse } from 'next/server';
import { enforceRoutePermission } from '@/lib/engine/auth';
import { encrypt } from '@/lib/engine/crypto';
import { deployRelay } from '@/lib/engine/proxy-relay-deploy';
import { testProxyRelay } from '@/lib/engine/relay-pool';
import {
  getVenueProxySettings,
  saveVenueProxySettings,
  type ProxyRelay,
  type ProxyRelayAccount,
  type RelayPlatform,
} from '@/lib/engine/venue-proxy-settings';

function isRelayPlatform(value: unknown): value is RelayPlatform {
  return value === 'vercel' || value === 'deno' || value === 'cloudflare';
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function relayId(): string {
  return `relay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function POST(request: NextRequest) {
  const denied = enforceRoutePermission(request, '/api/proxy-relays/deploy', 'POST');
  if (denied) return denied;

  try {
    const body = await request.json();
    const platform = body.platform;
    const token = clean(body.token);
    const accountLabel = clean(body.accountLabel) || `${platform} account`;
    const label = clean(body.label) || `${platform} relay`;
    const projectName = clean(body.projectName) || `tradingbot-relay-${Date.now().toString(36)}`;
    const cloudflareAccountId = clean(body.cloudflareAccountId);
    const denoOrgDomain = clean(body.denoOrgDomain);

    if (!isRelayPlatform(platform)) {
      return NextResponse.json({ error: 'platform must be vercel, deno, or cloudflare' }, { status: 400 });
    }
    if (!token) {
      return NextResponse.json({ error: 'Platform token is required' }, { status: 400 });
    }
    if (platform === 'cloudflare' && !cloudflareAccountId) {
      return NextResponse.json({ error: 'Cloudflare Account ID is required' }, { status: 400 });
    }
    if (platform === 'deno' && !denoOrgDomain) {
      return NextResponse.json({ error: 'Deno organization domain is required' }, { status: 400 });
    }

    const logs = ['Starting relay deployment'];
    const deployment = await deployRelay({
      platform,
      token,
      projectName,
      accountId: cloudflareAccountId || undefined,
      orgDomain: denoOrgDomain || undefined,
    });
    logs.push(...deployment.logs, 'Testing deployed relay');

    const now = new Date().toISOString();
    const account: ProxyRelayAccount = {
      id: relayId(),
      platform,
      accountLabel,
      encryptedToken: encrypt(token),
      cloudflareAccountId: cloudflareAccountId || undefined,
      denoOrgDomain: denoOrgDomain || undefined,
      createdAt: now,
      updatedAt: now,
    };
    const relay: ProxyRelay = {
      id: relayId(),
      label,
      platform,
      accountLabel,
      accountId: account.id,
      baseUrl: deployment.baseUrl,
      status: 'UNTESTED',
      enabled: true,
      preferred: false,
      deploymentId: deployment.deploymentId,
      projectName,
      metadata: deployment.metadata,
      createdAt: now,
      updatedAt: now,
    };

    const test = await testProxyRelay(relay);
    const testedRelay: ProxyRelay = {
      ...relay,
      status: test.status,
      lastTestedAt: now,
      lastError: test.error,
      latencyMs: test.latencyMs,
    };
    logs.push(test.ok ? 'Relay test succeeded' : `Relay test failed: ${test.error || test.status}`);

    const settings = await getVenueProxySettings();
    const activeRelayId = settings.activeRelayId || testedRelay.id;
    const saved = await saveVenueProxySettings({
      ...settings,
      activeRelayId,
      relays: [
        { ...testedRelay, preferred: testedRelay.id === activeRelayId },
        ...settings.relays.map((item) => ({ ...item, preferred: item.id === activeRelayId })),
      ],
      relayAccounts: [account, ...settings.relayAccounts],
    });

    return NextResponse.json({
      relay: saved.relays.find((item) => item.id === testedRelay.id) || testedRelay,
      logs,
      test,
      activeRelayId: saved.activeRelayId ?? null,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[ProxyRelays] Deployment failed:', error);
    return NextResponse.json({ error: message, logs: ['Deployment failed', message] }, { status: 502 });
  }
}
