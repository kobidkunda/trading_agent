import { NextResponse } from 'next/server';
import { checkServiceHealth } from '@/lib/engine/health-check';
import {
  mapRawHealthStatus,
  normalizeResearchProviderKey,
  RESEARCH_PROVIDER_REGISTRY,
} from '@/lib/engine/research-provider-registry';
import { resolveResearchProvider } from '@/lib/engine/service-routing';

export async function GET() {
  try {
    const [checks, resolvedProvider] = await Promise.all([
      Promise.all(RESEARCH_PROVIDER_REGISTRY.map((entry) => checkServiceHealth(entry.healthServiceName))),
      resolveResearchProvider().catch(() => null),
    ]);

    const providers = Object.fromEntries(
      RESEARCH_PROVIDER_REGISTRY.map((entry, index) => {
        const check = checks[index];
        return [entry.key, {
          key: entry.key,
          name: entry.displayName,
          status: mapRawHealthStatus(check.status, check.error),
          rawStatus: check.status,
          error: check.error ?? null,
          latency: check.latency ?? null,
          lastChecked: check.lastChecked,
          fallback: entry.fallback,
          isActive: normalizeResearchProviderKey(resolvedProvider) === entry.key,
        }];
      }),
    );

    return NextResponse.json({
      providers,
      resolvedProvider: normalizeResearchProviderKey(resolvedProvider),
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Research Provider Health API] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch provider health' }, { status: 500 });
  }
}
