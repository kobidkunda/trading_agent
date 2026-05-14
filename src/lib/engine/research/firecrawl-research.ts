import { db } from '@/lib/db';

const FIRECRAWL_BASE = 'https://api.firecrawl.dev';

export interface FirecrawlResearchResult {
  summary: string;
  keyFindings: string[];
  contradictions: string[];
  confidenceAssessment: number;
  sourceQuality: number;
  iterations: number;
  totalSources: number;
  allSearchResults: Array<{ title: string; url: string; snippet: string }>;
  allExtractedContent: Array<{ title: string; content: string; url: string }>;
}

async function getFirecrawlApiKey(): Promise<string | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (key) return key;

  const cred = await db.credential.findFirst({
    where: {
      OR: [
        { service: 'firecrawl' },
        { service: 'Firecrawl' },
      ],
      isActive: true,
    },
  });

  if (!cred?.encryptedData) return null;

  try {
    const raw = JSON.parse(cred.encryptedData);
    return raw.apiKey || raw.FIRECRAWL_API_KEY || null;
  } catch {
    return null;
  }
}

interface FirecrawlSearchItem {
  title: string;
  url: string;
  description: string;
}

async function firecrawlSearch(query: string, apiKey: string): Promise<FirecrawlSearchItem[]> {
  const res = await fetch(`${FIRECRAWL_BASE}/v2/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, limit: 8 }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    console.error(`[Firecrawl] search failed: ${res.status}`);
    return [];
  }

  const data = await res.json() as { data?: { web?: FirecrawlSearchItem[] } };
  return data.data?.web?.slice(0, 8) || [];
}

async function firecrawlScrape(url: string, apiKey: string): Promise<string> {
  const res = await fetch(`${FIRECRAWL_BASE}/v2/scrape`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url, formats: ['markdown'], onlyMainContent: true }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    console.error(`[Firecrawl] scrape ${url} failed: ${res.status}`);
    return `[Failed to scrape: HTTP ${res.status}]`;
  }

  const data = await res.json() as { data?: { markdown?: string } };
  return data.data?.markdown || '[No content extracted]';
}

function synthesizeFindings(
  marketTitle: string,
  searchResults: FirecrawlSearchItem[],
  scrapedContent: Array<{ title: string; content: string; url: string }>,
): { summary: string; keyFindings: string[]; contradictions: string[]; confidenceAssessment: number } {
  const totalSources = scrapedContent.length;
  if (totalSources === 0) {
    return {
      summary: `No research results found for "${marketTitle}". Consider refining the search or enabling alternative research providers.`,
      keyFindings: ['No data available from Firecrawl'],
      contradictions: [],
      confidenceAssessment: 0.1,
    };
  }

  const combinedText = scrapedContent.map(s => s.content).join('\n\n');
  const sentences = combinedText.split(/[.!?]+/).filter(s => s.trim().length > 30);

  const keyFindings = sentences
    .filter(s => /likely|will|probability|expect|forecast|predict|estimate/.test(s.toLowerCase()))
    .slice(0, 5)
    .map(s => s.trim());

  const contradictions = sentences
    .filter(s => /however|but|although|contrary|disagree|unlikely|counter/.test(s.toLowerCase()))
    .slice(0, 3)
    .map(s => s.trim());

  const summaryParts = scrapedContent.slice(0, 3).map(s => {
    const preview = s.content.slice(0, 400).replace(/\n/g, ' ');
    return `[${s.title}]: ${preview}...`;
  });
  const summary = `Deep research via Firecrawl for "${marketTitle}" (${totalSources} sources).\n\n${summaryParts.join('\n\n')}`;

  return {
    summary: summary.slice(0, 8000),
    keyFindings: keyFindings.length > 0 ? keyFindings : ['Research completed, see summary for details'],
    contradictions: contradictions.length > 0 ? contradictions : ['No major contradictions detected in available sources'],
    confidenceAssessment: Math.min(0.8, 0.3 + totalSources * 0.1),
  };
}

export async function runFirecrawlResearch(
  marketTitle: string,
  researchContext: string,
  impliedProbability: number,
): Promise<FirecrawlResearchResult> {
  const result: FirecrawlResearchResult = {
    summary: '',
    keyFindings: [],
    contradictions: [],
    confidenceAssessment: 0,
    sourceQuality: 0,
    iterations: 1,
    totalSources: 0,
    allSearchResults: [],
    allExtractedContent: [],
  };

  const apiKey = await getFirecrawlApiKey();
  if (!apiKey) {
    result.summary = 'Firecrawl API key not configured. Set FIRECRAWL_API_KEY env var or add a "Firecrawl" credential.';
    result.contradictions = ['Firecrawl unavailable — no API key'];
    result.confidenceAssessment = 0;
    return result;
  }

  const query = `${marketTitle} prediction market research analysis`;
  try {
    const searchResults = await firecrawlSearch(query, apiKey);
    result.allSearchResults = searchResults.map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.description || '',
    }));
    result.totalSources = searchResults.length;

    if (searchResults.length === 0) {
      result.summary = `No search results found for "${query}". The market may be too new or obscure for Firecrawl to find relevant sources.`;
      result.confidenceAssessment = 0.1;
      return result;
    }

    const scrapedContent: Array<{ title: string; content: string; url: string }> = [];
    const urlsToScrape = searchResults.slice(0, 5).map(r => r.url);

    for (const url of urlsToScrape) {
      try {
        const content = await firecrawlScrape(url, apiKey);
        const source = searchResults.find(r => r.url === url);
        scrapedContent.push({
          title: source?.title || url,
          content: content.slice(0, 3000),
          url,
        });
      } catch (err) {
        console.error(`[Firecrawl] scrape error for ${url}:`, err);
      }
    }

    result.allExtractedContent = scrapedContent;
    result.totalSources = scrapedContent.length;
    result.sourceQuality = scrapedContent.length > 0 ? 0.7 : 0.1;

    const synthesis = synthesizeFindings(marketTitle, searchResults, scrapedContent);
    result.summary = synthesis.summary;
    result.keyFindings = synthesis.keyFindings;
    result.contradictions = synthesis.contradictions;
    result.confidenceAssessment = synthesis.confidenceAssessment;

  } catch (err) {
    console.error('[Firecrawl] research error:', err);
    result.summary = `Firecrawl research failed: ${err instanceof Error ? err.message : String(err)}`;
    result.confidenceAssessment = 0;
  }

  return result;
}
