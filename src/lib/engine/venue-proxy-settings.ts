import { db } from '@/lib/db';

export type ProxyVenue = 'polymarket' | 'kalshi' | 'sxBet' | 'manifold';
export type RelayPlatform = 'vercel' | 'deno' | 'cloudflare';
export type RelayStatus = 'UP' | 'DEGRADED' | 'DOWN' | 'DISABLED' | 'UNTESTED';

export interface ProxyRelayAccount {
  id: string;
  platform: RelayPlatform;
  accountLabel: string;
  encryptedToken: string;
  cloudflareAccountId?: string;
  denoOrgDomain?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProxyRelay {
  id: string;
  label: string;
  platform: RelayPlatform;
  accountLabel: string;
  accountId?: string;
  baseUrl: string;
  status: RelayStatus;
  enabled: boolean;
  preferred?: boolean;
  lastTestedAt?: string | null;
  lastError?: string | null;
  latencyMs?: number | null;
  deploymentId?: string | null;
  projectName?: string | null;
  quotaNotes?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface VenueProxyProfile {
  id: string;
  label: string;
  baseUrl?: string;
  token?: string;
  urls: Partial<Record<ProxyVenue, string>>;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface VenueProxySettings {
  activeProfileId: string | null;
  activeRelayId?: string | null;
  profiles: VenueProxyProfile[];
  relays: ProxyRelay[];
  relayAccounts: ProxyRelayAccount[];
}

export const VENUE_PROXY_SETTINGS_KEY = 'venue_proxy_settings';

const LEGACY_KEYS: Record<ProxyVenue, string> = {
  polymarket: 'polymarket_proxy_url',
  kalshi: 'kalshi_proxy_url',
  sxBet: 'sx_bet_proxy_url',
  manifold: 'manifold_proxy_url',
};

const PATHS: Record<ProxyVenue, string> = {
  polymarket: 'clob',
  kalshi: 'kalshi',
  sxBet: 'sx-bet',
  manifold: 'manifold',
};

function cleanUrl(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\/$/, '') : '';
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRelayPlatform(value: unknown): RelayPlatform {
  const normalized = cleanString(value).toLowerCase();
  if (normalized === 'deno' || normalized === 'cloudflare') return normalized;
  return 'vercel';
}

function normalizeRelayStatus(value: unknown, enabled: boolean): RelayStatus {
  if (!enabled) return 'DISABLED';
  const normalized = cleanString(value).toUpperCase();
  if (normalized === 'UP' || normalized === 'DEGRADED' || normalized === 'DOWN' || normalized === 'UNTESTED') {
    return normalized;
  }
  return 'UNTESTED';
}

function makeUrlsFromBase(baseUrl: string): Partial<Record<ProxyVenue, string>> {
  const base = cleanUrl(baseUrl);
  if (!base) return {};
  return {
    polymarket: `${base}/${PATHS.polymarket}`,
    kalshi: `${base}/${PATHS.kalshi}`,
    sxBet: `${base}/${PATHS.sxBet}`,
    manifold: `${base}/${PATHS.manifold}`,
  };
}

export function normalizeVenueProxySettings(input: unknown): VenueProxySettings {
  const raw = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {};
  const profilesRaw = Array.isArray(raw.profiles) ? raw.profiles : [];
  const relaysRaw = Array.isArray(raw.relays) ? raw.relays : [];
  const relayAccountsRaw = Array.isArray(raw.relayAccounts) ? raw.relayAccounts : [];
  const profiles = profilesRaw.map((item, index) => {
    const obj = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {};
    const baseUrl = cleanUrl(obj.baseUrl);
    const rawUrls = typeof obj.urls === 'object' && obj.urls !== null ? obj.urls as Record<string, unknown> : {};
    const expanded = makeUrlsFromBase(baseUrl);
    const urls: Partial<Record<ProxyVenue, string>> = {
      polymarket: cleanUrl(rawUrls.polymarket) || expanded.polymarket,
      kalshi: cleanUrl(rawUrls.kalshi) || expanded.kalshi,
      sxBet: cleanUrl(rawUrls.sxBet) || expanded.sxBet,
      manifold: cleanUrl(rawUrls.manifold) || expanded.manifold,
    };
    return {
      id: cleanUrl(obj.id) || `proxy-${index + 1}`,
      label: cleanUrl(obj.label) || `Proxy ${index + 1}`,
      baseUrl,
      token: cleanUrl(obj.token),
      urls,
      isActive: Boolean(obj.isActive),
      createdAt: cleanUrl(obj.createdAt) || new Date().toISOString(),
      updatedAt: cleanUrl(obj.updatedAt) || new Date().toISOString(),
    };
  });
  const relayAccounts = relayAccountsRaw.map((item, index) => {
    const obj = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {};
    const platform = normalizeRelayPlatform(obj.platform);
    return {
      id: cleanString(obj.id) || `relay-account-${index + 1}`,
      platform,
      accountLabel: cleanString(obj.accountLabel) || `${platform} account`,
      encryptedToken: cleanString(obj.encryptedToken),
      cloudflareAccountId: cleanString(obj.cloudflareAccountId) || undefined,
      denoOrgDomain: cleanString(obj.denoOrgDomain) || undefined,
      createdAt: cleanString(obj.createdAt) || new Date().toISOString(),
      updatedAt: cleanString(obj.updatedAt) || new Date().toISOString(),
    };
  }).filter((account) => account.encryptedToken);
  const relays = relaysRaw.map((item, index) => {
    const obj = typeof item === 'object' && item !== null ? item as Record<string, unknown> : {};
    const enabled = obj.enabled !== false;
    const platform = normalizeRelayPlatform(obj.platform);
    return {
      id: cleanString(obj.id) || `relay-${index + 1}`,
      label: cleanString(obj.label) || `Relay ${index + 1}`,
      platform,
      accountLabel: cleanString(obj.accountLabel) || `${platform} account`,
      accountId: cleanString(obj.accountId) || undefined,
      baseUrl: cleanUrl(obj.baseUrl),
      status: normalizeRelayStatus(obj.status, enabled),
      enabled,
      preferred: Boolean(obj.preferred),
      lastTestedAt: cleanString(obj.lastTestedAt) || null,
      lastError: cleanString(obj.lastError) || null,
      latencyMs: typeof obj.latencyMs === 'number' && Number.isFinite(obj.latencyMs) ? obj.latencyMs : null,
      deploymentId: cleanString(obj.deploymentId) || null,
      projectName: cleanString(obj.projectName) || null,
      quotaNotes: cleanString(obj.quotaNotes) || null,
      metadata: typeof obj.metadata === 'object' && obj.metadata !== null ? obj.metadata as Record<string, unknown> : {},
      createdAt: cleanString(obj.createdAt) || new Date().toISOString(),
      updatedAt: cleanString(obj.updatedAt) || new Date().toISOString(),
    };
  }).filter((relay) => relay.baseUrl);

  const activeProfileId = cleanUrl(raw.activeProfileId) || profiles.find((profile) => profile.isActive)?.id || null;
  const activeRelayId = cleanString(raw.activeRelayId) || relays.find((relay) => relay.preferred && relay.enabled)?.id || null;
  return {
    activeProfileId,
    activeRelayId,
    profiles: profiles.map((profile) => ({ ...profile, isActive: profile.id === activeProfileId })),
    relays: relays.map((relay) => ({ ...relay, preferred: relay.id === activeRelayId })),
    relayAccounts,
  };
}

export async function getVenueProxySettings(): Promise<VenueProxySettings> {
  const setting = await db.settings.findUnique({ where: { key: VENUE_PROXY_SETTINGS_KEY } });
  if (!setting?.value) return { activeProfileId: null, activeRelayId: null, profiles: [], relays: [], relayAccounts: [] };
  try {
    return normalizeVenueProxySettings(JSON.parse(setting.value));
  } catch {
    return { activeProfileId: null, activeRelayId: null, profiles: [], relays: [], relayAccounts: [] };
  }
}

export async function getActiveVenueProxyUrl(venue: ProxyVenue): Promise<string | null> {
  const settings = await getVenueProxySettings();
  const active = settings.profiles.find((profile) => profile.id === settings.activeProfileId && profile.isActive);
  const profileUrl = cleanUrl(active?.urls?.[venue]);
  if (profileUrl) return profileUrl;

  const legacy = await db.settings.findUnique({ where: { key: LEGACY_KEYS[venue] } });
  return cleanUrl(legacy?.value) || null;
}

export async function saveVenueProxySettings(settings: VenueProxySettings): Promise<VenueProxySettings> {
  const normalized = normalizeVenueProxySettings(settings);
  const now = new Date().toISOString();
  const profiles = normalized.profiles.map((profile) => ({
    ...profile,
    updatedAt: now,
    createdAt: profile.createdAt || now,
  }));
  const activeProfileId = normalized.activeProfileId || profiles.find((profile) => profile.isActive)?.id || null;
  const payload = normalizeVenueProxySettings({
    activeProfileId,
    activeRelayId: normalized.activeRelayId,
    profiles,
    relays: normalized.relays,
    relayAccounts: normalized.relayAccounts,
  });

  await db.settings.upsert({
    where: { key: VENUE_PROXY_SETTINGS_KEY },
    update: { value: JSON.stringify(payload), updatedAt: new Date() },
    create: {
      key: VENUE_PROXY_SETTINGS_KEY,
      value: JSON.stringify(payload),
      description: 'Venue proxy profiles for Polymarket, Kalshi, SX Bet, and Manifold',
    },
  });

  const active = payload.profiles.find((profile) => profile.id === payload.activeProfileId);
  if (active) {
    for (const [venue, key] of Object.entries(LEGACY_KEYS) as Array<[ProxyVenue, string]>) {
      const value = cleanUrl(active.urls[venue]);
      if (!value) continue;
      await db.settings.upsert({
        where: { key },
        update: { value, updatedAt: new Date() },
        create: { key, value, description: `Active ${venue} proxy URL` },
      });
    }
  }

  return payload;
}
