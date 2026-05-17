import { db } from '@/lib/db';
import { isEncrypted, decrypt } from '@/lib/engine/crypto';

export interface ServiceHealthStatus {
  name: string;
  status: 'UP' | 'DOWN' | 'DEGRADED' | 'UNKNOWN';
  latency?: number;
  error?: string;
  lastChecked: string;
}

export interface HealthCheckResult {
  healthy: boolean;
  services: ServiceHealthStatus[];
  errors: string[];
}

/**
 * Normalize service name variants to a canonical key.
 * Handles hyphen/underscore differences (e.g. "agent-reach" ↔ "agent_reach").
 */
function normalizeServiceName(name: string): string {
  return name.toLowerCase().replace(/[-_\s]+/g, '_');
}

const SERVICE_ENDPOINTS: Record<string, string> = {
  deerflow: '/health',
  qdrant: '/healthz',
  searxng: '/search?q=test&format=json',
  tradingagents: '/health',
  agent_reach: '/health',
  agentreach: '/health',
  openai: '/models',
  ollama: '/api/tags',
  mirofis: '/health',
  firecrawl: '',
};

const SERVICE_DISPLAY_NAMES: Record<string, string> = {
  deerflow: 'DeerFlow',
  qdrant: 'Qdrant',
  searxng: 'SearXNG',
  tradingagents: 'TradingAgents',
  agent_reach: 'Agent-Reach',
  agentreach: 'Agent-Reach',
  openai: 'OpenAI',
  ollama: 'Ollama',
  llm: 'LLM Provider',
  mirofis: 'MiroFish',
  firecrawl: 'Firecrawl',
};

/**
 * Check health of a single service
 */
export async function checkServiceHealth(serviceName: string): Promise<ServiceHealthStatus> {
  const startTime = Date.now();
  const normalizedName = normalizeServiceName(serviceName);
  const displayName = SERVICE_DISPLAY_NAMES[normalizedName] || serviceName;

  try {
    // Get credential for service - try normalized name, then fallback to various casing
    const cred = await db.credential.findFirst({
      where: {
        OR: [
          { service: serviceName },
          { service: normalizedName },
          { service: displayName },
        ],
        isActive: true,
      },
    });

    // Determine the service URL: prefer credential, then env var fallback
    let serviceUrl = cred?.serviceUrl;
    if (!serviceUrl) {
      const envUrlMap: Record<string, string> = {
        searxng: process.env.SEARXNG_URL || 'http://localhost:8888',
        qdrant: process.env.QDRANT_URL || 'http://localhost:6333',
        deerflow: process.env.DEERFLOW_URL || 'http://localhost:2026',
        tradingagents: process.env.TRADINGAGENTS_URL || 'http://localhost:8100',
        agent_reach: process.env.AGENT_REACH_URL || '',
        openai: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
        ollama: process.env.OLLAMA_URL || 'http://localhost:11434',
        mirofis: process.env.MIROFISH_URL || '',
      };
      serviceUrl = envUrlMap[normalizedName] || envUrlMap[serviceName.toLowerCase()] || '';
    }

    if (!serviceUrl) {
      return {
        name: displayName,
        status: 'DOWN',
        error: 'No active credential or URL configured',
        lastChecked: new Date().toISOString(),
      };
    }

    const endpoint = SERVICE_ENDPOINTS[normalizedName] || SERVICE_ENDPOINTS[serviceName.toLowerCase()];
    if (!endpoint) {
      return {
        name: displayName,
        status: 'UNKNOWN',
        error: 'No health endpoint defined',
        lastChecked: new Date().toISOString(),
      };
    }

    // Parse encrypted data for API key
    let apiKey: string | undefined;
    if (cred?.encryptedData) {
      try {
        const raw = isEncrypted(cred.encryptedData) ? decrypt(cred.encryptedData) : cred.encryptedData;
        const parsed = JSON.parse(raw);
        apiKey = parsed.apiKey || parsed.api_key;
      } catch {}
    }

    // Firecrawl: check API key presence instead of endpoint
    if (serviceName.toLowerCase() === 'firecrawl') {
      const latency = Date.now() - startTime;
      const status = apiKey ? 'UP' : 'DOWN';
      return {
        name: displayName,
        status,
        latency,
        error: apiKey ? undefined : 'No API key configured',
        lastChecked: new Date().toISOString(),
      };
    }

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(`${serviceUrl.replace(/\/$/, '')}${endpoint}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(5000),
    });

    const latency = Date.now() - startTime;
    const status = response.ok ? 'UP' : 'DEGRADED';

    return {
      name: displayName,
      status,
      latency,
      error: response.ok ? undefined : `HTTP ${response.status}`,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    return {
      name: displayName,
      status: 'DOWN',
      latency: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
      lastChecked: new Date().toISOString(),
    };
  }
}

/**
 * Check health of multiple services required for a pipeline stage
 */
export async function checkServicesHealth(services: string[]): Promise<HealthCheckResult> {
  const results = await Promise.all(
    services.map(s => checkServiceHealth(s))
  );

  const errors: string[] = [];
  const downServices = results.filter(r => r.status === 'DOWN');

  for (const svc of downServices) {
    errors.push(`${svc.name}: ${svc.error || 'Service unavailable'}`);
  }

  return {
    healthy: downServices.length === 0,
    services: results,
    errors,
  };
}

/**
 * Get health status for all research-related services
 */
export async function getResearchServicesHealth(): Promise<HealthCheckResult> {
  return checkServicesHealth([
    'deerflow',
    'tradingagents',
    'qdrant',
    'searxng',
  ]);
}

/**
 * Check if a specific stage can run based on required services
 */
export function getRequiredServicesForStage(stage: string): string[] {
   // Normalize stage name to handle case variations (e.g. 'TRADINGAGENTS' → 'tradingagents')
   const normalized = normalizeServiceName(stage);
   switch (normalized) {
     case 'deerflow':
       return ['deerflow'];
     case 'tradingagents':
       return ['tradingagents'];
     case 'web_search':
       return ['searxng'];
     case 'agent_reach':
     case 'agentreach':
       return ['agent_reach'];
     case 'synthesis':
       return ['tradingagents'];
     case 'mirofis':
       return ['mirofis'];
     case 'firecrawl':
       return ['firecrawl'];
     default:
       return [];
   }
 }

/**
 * Check if a stage can run, returning the health status
 */
export async function canRunStage(stage: string): Promise<{
  canRun: boolean;
  health: HealthCheckResult;
  skipReason?: string;
}> {
  const requiredServices = getRequiredServicesForStage(stage);

  if (requiredServices.length === 0) {
    return {
      canRun: true,
      health: { healthy: true, services: [], errors: [] },
    };
  }

  const health = await checkServicesHealth(requiredServices);

  if (!health.healthy) {
    return {
      canRun: false,
      health,
      skipReason: `Required services unavailable: ${health.errors.join('; ')}`,
    };
  }

  return {
    canRun: true,
    health,
  };
}

/**
 * Check if a service is actually reachable by testing connectivity directly.
 * Used as a fallback when canRunStage reports failure but the service might
 * actually be up (e.g., due to name normalization issues).
 */
export async function isServiceReachable(serviceName: string, url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get cached health status from the health API
 */
export async function getCachedHealthStatus(): Promise<Record<string, 'UP' | 'DOWN' | 'DEGRADED'>> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000'}/api/health`);
    if (res.ok) {
      const data = await res.json();
      return data.apiHealth || {};
    }
  } catch {}
  return {};
}

/**
 * Get health map for all configured services
 */
export async function getServiceHealthMap(): Promise<Record<string, 'UP' | 'DOWN'>> {
  const services = Object.keys(SERVICE_ENDPOINTS);
  const results = await Promise.all(
    services.map(async (s) => {
      const health = await checkServiceHealth(s);
      return [s, health.status === 'UP' ? 'UP' : 'DOWN'] as [string, 'UP' | 'DOWN'];
    })
  );
  return Object.fromEntries(results);
}
