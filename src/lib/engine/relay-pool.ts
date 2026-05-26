import {
  getActiveVenueProxyUrl,
  getVenueProxySettings,
  saveVenueProxySettings,
  type ProxyRelay,
  type ProxyVenue,
  type RelayStatus,
} from '@/lib/engine/venue-proxy-settings';

export interface RelayFetchOptions extends RequestInit {
  directFallback?: boolean;
  timeoutMs?: number;
}

export interface RelayTestResult {
  ok: boolean;
  status: RelayStatus;
  latencyMs: number;
  error: string | null;
}

const RELAY_TEST_TARGET = 'https://clob.polymarket.com';
const RELAY_TEST_PATH = '/markets?limit=1&active=true';

function cleanBaseUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function relayHealthRank(status: RelayStatus): number {
  switch (status) {
    case 'UP':
      return 0;
    case 'UNTESTED':
      return 1;
    case 'DEGRADED':
      return 2;
    default:
      return 3;
  }
}

export function selectRelayCandidates(relays: ProxyRelay[], activeRelayId?: string | null): ProxyRelay[] {
  return relays
    .filter((relay) => relay.enabled && relay.status !== 'DOWN' && relay.status !== 'DISABLED' && relay.baseUrl)
    .sort((a, b) => {
      if (a.id === activeRelayId) return -1;
      if (b.id === activeRelayId) return 1;
      if (a.preferred && !b.preferred) return -1;
      if (b.preferred && !a.preferred) return 1;
      return relayHealthRank(a.status) - relayHealthRank(b.status);
    });
}

async function updateRelayHealth(relayId: string, patch: Partial<ProxyRelay>): Promise<void> {
  try {
    const settings = await getVenueProxySettings();
    const relays = settings.relays.map((relay) => (
      relay.id === relayId
        ? { ...relay, ...patch, updatedAt: new Date().toISOString() }
        : relay
    ));
    await saveVenueProxySettings({ ...settings, relays });
  } catch (error) {
    console.error(`[RelayPool] Failed to update relay ${relayId} health:`, error);
  }
}

function cloneHeaders(headers: HeadersInit | undefined): Headers {
  return new Headers(headers || {});
}

function buildRelayRequest(relay: ProxyRelay, targetBaseUrl: string, pathWithQuery: string, init: RequestInit): [string, RequestInit] {
  const headers = cloneHeaders(init.headers);
  headers.set('x-relay-target', cleanBaseUrl(targetBaseUrl));
  headers.set('x-relay-path', pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`);

  return [
    cleanBaseUrl(relay.baseUrl),
    {
      ...init,
      headers,
    },
  ];
}

function shouldFailOver(response: Response): boolean {
  return response.status === 429 || response.status >= 500;
}

function classifyStatus(response: Response): RelayStatus {
  if (response.ok) return 'UP';
  if (shouldFailOver(response)) return 'DEGRADED';
  return 'UP';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function relayHttpError(response: Response): Promise<string> {
  const base = `HTTP ${response.status} ${response.statusText}`.trim();
  const body = await response.text().catch(() => '');
  if (response.status === 401 && body.includes('Vercel Authentication')) {
    return `${base} - Vercel deployment protection is enabled`;
  }
  if (response.headers.get('x-vercel-error') === 'FUNCTION_INVOCATION_FAILED') {
    return `${base} - Vercel relay function crashed`;
  }
  const server = response.headers.get('server')?.toLowerCase() || '';
  if (response.status >= 500 && server.includes('cloudflare')) {
    return `${base} - Cloudflare relay or upstream fetch failed`;
  }
  if (response.status >= 500 && (server.includes('deno') || response.headers.has('x-deno-ray'))) {
    return `${base} - Deno relay or upstream fetch failed`;
  }
  if (response.status === 404 && body.includes('The page could not be found')) {
    return `${base} - relay route was not found on the deployment`;
  }
  if (response.status === 502 && body.includes('"error"')) {
    return `${base} - ${body.slice(0, 240)}`;
  }
  return base;
}

export async function testProxyRelay(relay: ProxyRelay): Promise<RelayTestResult> {
  const startedAt = Date.now();
  try {
    const [relayUrl, init] = buildRelayRequest(relay, RELAY_TEST_TARGET, RELAY_TEST_PATH, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const response = await fetch(relayUrl, init);
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        ok: false,
        status: shouldFailOver(response) ? 'DEGRADED' : 'DOWN',
        latencyMs,
        error: await relayHttpError(response),
      };
    }
    return { ok: true, status: 'UP', latencyMs, error: null };
  } catch (error) {
    return {
      ok: false,
      status: 'DOWN',
      latencyMs: Date.now() - startedAt,
      error: errorMessage(error),
    };
  }
}

export async function fetchVenueWithRelayFallback(
  venue: ProxyVenue,
  directBaseUrl: string,
  pathWithQuery: string,
  init: RelayFetchOptions = {},
): Promise<Response> {
  const { directFallback = true, timeoutMs, ...fetchInit } = init;
  const settings = await getVenueProxySettings();
  const relays = selectRelayCandidates(settings.relays, settings.activeRelayId);

  for (const relay of relays) {
    const startedAt = Date.now();
    try {
      const [relayUrl, relayInit] = buildRelayRequest(relay, directBaseUrl, pathWithQuery, {
        ...fetchInit,
        signal: fetchInit.signal || (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined),
      });
      const response = await fetch(relayUrl, relayInit);
      const latencyMs = Date.now() - startedAt;
      const status = classifyStatus(response);
      await updateRelayHealth(relay.id, {
        status,
        latencyMs,
        lastError: response.ok ? null : `HTTP ${response.status} ${response.statusText}`,
        lastTestedAt: new Date().toISOString(),
      });
      if (!shouldFailOver(response)) return response;
    } catch (error) {
      await updateRelayHealth(relay.id, {
        status: 'DOWN',
        latencyMs: Date.now() - startedAt,
        lastError: errorMessage(error),
        lastTestedAt: new Date().toISOString(),
      });
    }
  }

  const legacyProxyUrl = await getActiveVenueProxyUrl(venue);
  if (legacyProxyUrl) {
    try {
      return await fetch(`${cleanBaseUrl(legacyProxyUrl)}${pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`}`, {
        ...fetchInit,
        signal: fetchInit.signal || (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined),
      });
    } catch (error) {
      console.error(`[RelayPool] Legacy ${venue} proxy failed:`, error);
    }
  }

  if (!directFallback) {
    throw new Error(`No healthy relay available for ${venue}`);
  }

  return fetch(`${cleanBaseUrl(directBaseUrl)}${pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`}`, {
    ...fetchInit,
    signal: fetchInit.signal || (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined),
  });
}
