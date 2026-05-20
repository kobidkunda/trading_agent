import { db } from '@/lib/db';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceType: 'SEARCH';
  recencyScore: number;
  qualityScore: number;
}

export async function getCredentialForService(serviceKey: string): Promise<{
  baseUrl: string;
  apiKey: string;
} | null> {
const normalizedServiceKey = serviceKey.trim().toLowerCase().replace(/[\s\-]+/g, '_');
   const variantMap: Record<string, string[]> = {
     searxng: ['searxng', 'SearXNG', 'SEARXNG'],
     llm: ['llm', 'LLM Provider', 'OpenAI', 'openai'],
     qdrant: ['qdrant', 'Qdrant', 'QDRANT'],
     ollama: ['ollama', 'Ollama', 'OLLAMA'],
     deerflow: ['deerflow', 'DeerFlow Research', 'DeerFlow', 'DEERFLOW'],
     tradingagents: ['tradingagents', 'TradingAgents', 'TRADINGAGENTS', 'Trading Agents'],
     agent_reach: ['agent-reach', 'agent_reach', 'Agent Reach', 'Agent-Reach', 'AGENT_REACH', 'agentreach'],
     mirofis: ['mirofis', 'mirofish', 'MiroFish', 'MIROFISH', 'microfish'],
     venue_proxy: ['venue_proxy', 'venue-proxy', 'Venue Proxy', 'proxy'],
     proxy: ['proxy', 'Proxy App', 'prediction_proxy', 'prediction-market-proxy', 'venue_proxy'],
     polymarket_proxy: ['polymarket_proxy', 'Polymarket Proxy', 'polymarket-proxy', 'proxy_polymarket'],
     kalshi_proxy: ['kalshi_proxy', 'Kalshi Proxy', 'kalshi-proxy', 'proxy_kalshi'],
     sxbet_proxy: ['sxbet_proxy', 'SX Bet Proxy', 'sxbet-proxy', 'sx_bet_proxy', 'proxy_sxbet'],
     manifold_proxy: ['manifold_proxy', 'Manifold Proxy', 'manifold-proxy', 'proxy_manifold'],
   };
  const variants = variantMap[normalizedServiceKey] || variantMap[serviceKey] || [serviceKey];

  const cred = await db.credential.findFirst({
    where: { service: { in: variants }, isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  if (!cred) return null;

  let apiKey = '';
  if (cred.encryptedData) {
    try {
      const { isEncrypted, decrypt } = await import('@/lib/engine/crypto');
      const rawData = isEncrypted(cred.encryptedData) ? decrypt(cred.encryptedData) : cred.encryptedData;
      const parsed = JSON.parse(rawData);
      apiKey = String(parsed.apiKey || '');
    } catch {
      try { const parsed = JSON.parse(cred.encryptedData); apiKey = String(parsed.apiKey || ''); } catch {}
    }
  }

  return { baseUrl: cred.serviceUrl || '', apiKey };
}

export async function searchSearXNG(query: string, maxResults: number = 50): Promise<SearchResult[]> {
  const credResult = await getCredentialForService('searxng');
  const baseUrl = credResult?.baseUrl || process.env.SEARXNG_URL || 'http://192.168.88.97:7777';
  const apiKey = credResult?.apiKey || '';

  try {
    const url = `${baseUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&categories=general,news&language=en`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    headers['X-Forwarded-For'] = '127.0.0.1';
    headers['X-Real-IP'] = '127.0.0.1';

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      console.error(`SearXNG search failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const GARBAGE_DOMAINS = ['arxiv.org', 'scholar.google', 'doi.org', 'semanticscholar.org', 'dl.acm.org', 'ieeexplore.ieee.org', 'link.springer.com', 'pubmed.ncbi.nlm.nih.gov'];
    const GARBAGE_PATTERNS = [/skip to main/i, /sign in/i, /log in/i, /cookie/i, /subscribe/i, /newsletter/i, /^\[\d/, /^arxiv:/i];

    const results: SearchResult[] = (data.results || [])
      .filter((item: Record<string, unknown>) => {
        const url = String(item.url || '');
        const snippet = String(item.content || '');
        const title = String(item.title || '');
        if (!url || url.length < 10) return false;
        if (GARBAGE_DOMAINS.some((d) => url.includes(d))) return false;
        if (snippet.length < 30) return false;
        if (GARBAGE_PATTERNS.some((p) => p.test(snippet.slice(0, 50)))) return false;
        if (title.length < 5) return false;
        return true;
      })
      .slice(0, maxResults)
      .map((item: Record<string, unknown>) => {
        let snippet = String(item.content || '');
        snippet = snippet.replace(/Skip to main content.*?(?=[A-Z])/gi, '').trim();
        snippet = snippet.replace(/\s+/g, ' ').slice(0, 500);
        return {
          title: String(item.title || ''),
          url: String(item.url || ''),
          snippet,
          sourceType: 'SEARCH' as const,
          recencyScore: 0.7,
          qualityScore: snippet.length > 100 ? 0.7 : 0.5,
        };
      });

    return results;
  } catch (error) {
    console.error('SearXNG search error:', error);
    return [];
  }
}

export async function searchSearXNGReddit(query: string, maxResults: number = 50): Promise<SearchResult[]> {
  return searchSearXNGWithFilter(`${query} site:reddit.com`, maxResults);
}

export async function searchSearXNGX(query: string, maxResults: number = 50): Promise<SearchResult[]> {
  return searchSearXNGWithFilter(`${query} site:x.com OR site:twitter.com`, maxResults);
}

async function searchSearXNGWithFilter(query: string, maxResults: number = 50): Promise<SearchResult[]> {
  const credResult = await getCredentialForService('searxng');
  const baseUrl = credResult?.baseUrl || process.env.SEARXNG_URL || 'http://192.168.88.97:7777';
  const apiKey = credResult?.apiKey || '';

  try {
    const url = `${baseUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&categories=general,news,social media&language=en`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    headers['X-Forwarded-For'] = '127.0.0.1';
    headers['X-Real-IP'] = '127.0.0.1';

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return [];

    const data = await response.json();
    const GARBAGE_PATTERNS = [/skip to main/i, /sign in/i, /log in/i, /cookie/i];

    return (data.results || [])
      .filter((item: Record<string, unknown>) => {
        const url = String(item.url || '');
        const snippet = String(item.content || '');
        const title = String(item.title || '');
        if (!url || url.length < 10) return false;
        if (snippet.length < 20) return false;
        if (GARBAGE_PATTERNS.some((p) => p.test(snippet.slice(0, 50)))) return false;
        return true;
      })
      .slice(0, maxResults)
      .map((item: Record<string, unknown>) => ({
        title: String(item.title || ''),
        url: String(item.url || ''),
        snippet: String(item.content || '').replace(/\s+/g, ' ').slice(0, 500),
        sourceType: 'SEARCH' as const,
        recencyScore: 0.75,
        qualityScore: 0.65,
      }));
  } catch (error) {
    console.error('SearXNG filtered search error:', error);
    return [];
  }
}
