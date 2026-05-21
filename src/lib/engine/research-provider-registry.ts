export type ProviderHealthStatus = 'OK' | 'DEGRADED' | 'DOWN' | 'CONFIG_MISSING' | 'DISABLED' | 'ERROR' | 'UNKNOWN';

export interface ResearchProviderRegistryEntry {
  key: string;
  displayName: string;
  healthServiceName: string;
  fallback: string | null;
  aliases: string[];
}

export const RESEARCH_PROVIDER_REGISTRY: ResearchProviderRegistryEntry[] = [
  { key: 'deerflow', displayName: 'DeerFlow', healthServiceName: 'deerflow', fallback: 'firecrawl', aliases: ['deerflow', 'DeerFlow'] },
  { key: 'firecrawl', displayName: 'Firecrawl', healthServiceName: 'firecrawl', fallback: null, aliases: ['firecrawl', 'Firecrawl'] },
  { key: 'tradingagents', displayName: 'TradingAgents', healthServiceName: 'tradingagents', fallback: null, aliases: ['tradingagents', 'TradingAgents'] },
  { key: 'agent_reach', displayName: 'Agent-Reach', healthServiceName: 'agent_reach', fallback: null, aliases: ['agent_reach', 'agentreach', 'Agent-Reach', 'Agent Reach'] },
  { key: 'mirofish', displayName: 'MiroFish', healthServiceName: 'mirofish', fallback: null, aliases: ['mirofish', 'mirofis', 'MiroFish', 'microfish'] },
];

export const RESEARCH_PROVIDER_MAP = Object.fromEntries(
  RESEARCH_PROVIDER_REGISTRY.map((entry) => [entry.key, entry]),
);

export function normalizeResearchProviderKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[-\s]+/g, '_');
  const match = RESEARCH_PROVIDER_REGISTRY.find((entry) =>
    entry.aliases.some((alias) => alias.toLowerCase().replace(/[-\s]+/g, '_') === normalized),
  );
  return match?.key ?? normalized;
}

export function mapRawHealthStatus(rawStatus: string | null | undefined, error?: string | null): ProviderHealthStatus {
  switch (rawStatus) {
    case 'UP':
      return 'OK';
    case 'DEGRADED':
      return 'DEGRADED';
    case 'DOWN':
      return error && /no api key|not configured|no active credential|no active credential or url configured/i.test(error)
        ? 'CONFIG_MISSING'
        : 'DOWN';
    case 'UNKNOWN':
    default:
      return error ? 'ERROR' : 'UNKNOWN';
  }
}
