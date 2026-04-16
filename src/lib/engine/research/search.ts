import { db } from '@/lib/db';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  sourceType: 'SEARCH';
  recencyScore: number;
  qualityScore: number;
}

export async function searchSearXNG(query: string, maxResults: number = 5): Promise<SearchResult[]> {
  const cred = await db.credential.findFirst({
    where: { service: 'SearXNG', isActive: true },
    orderBy: { createdAt: 'desc' },
  });

  const baseUrl = cred?.serviceUrl || process.env.SEARXNG_URL || 'http://localhost:8888';
  let apiKey = '';
  if (cred?.encryptedData) {
    try {
      const { isEncrypted, decrypt } = await import('@/lib/engine/crypto');
      const rawData = isEncrypted(cred.encryptedData) ? decrypt(cred.encryptedData) : cred.encryptedData;
      const parsed = JSON.parse(rawData);
      apiKey = String(parsed.apiKey || '');
    } catch {
      try { const parsed = JSON.parse(cred.encryptedData); apiKey = String(parsed.apiKey || ''); } catch {}
    }
  }

  try {
    const url = `${baseUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&categories=general,news,science`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) {
      console.error(`SearXNG search failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const results: SearchResult[] = (data.results || [])
      .slice(0, maxResults)
      .map((item: Record<string, unknown>) => ({
        title: String(item.title || ''),
        url: String(item.url || ''),
        snippet: String(item.content || ''),
        sourceType: 'SEARCH' as const,
        recencyScore: 0.7,
        qualityScore: 0.6,
      }));

    return results;
  } catch (error) {
    console.error('SearXNG search error:', error);
    return [];
  }
}