/** Centralised lookup for external service URLs — credential store preferred, env var fallback, empty = not configured. */
export const SERVICE_ENV_KEYS = {
  MIROFISH: 'MIROFISH_BASE_URL',
  OPENAI: 'OPENAI_BASE_URL',
  OLLAMA: 'OLLAMA_BASE_URL',
  QDRANT: 'QDRANT_URL',
  SEARXNG: 'SEARXNG_URL',
  MEM0: 'MEM0_URL',
  DEERFLOW: 'DEERFLOW_URL',
  TRADINGAGENTS: 'TRADINGAGENTS_URL',
  AGENT_REACH: 'AGENT_REACH_URL',
  FIRECRAWL: 'FIRECRAWL_URL',
} as const;

export type ServiceKey = keyof typeof SERVICE_ENV_KEYS;

export function getServiceUrl(
  serviceKey: ServiceKey,
  credUrl?: string | null
): string {
  if (credUrl?.trim()) return credUrl.trim();
  const envVal = process.env[SERVICE_ENV_KEYS[serviceKey]];
  if (envVal?.trim()) return envVal.trim();
  return '';
}
