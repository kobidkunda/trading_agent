export interface ExtractedContent {
  title: string;
  content: string;
  contentLength: number;
}

export async function extractContent(url: string): Promise<ExtractedContent | null> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TradingBot/1.0)',
        Accept: 'text/html,application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    let text = '';

    if (contentType.includes('application/json')) {
      const json = await response.json();
      text = JSON.stringify(json).slice(0, 5000);
    } else {
      const html = await response.text();
      text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 5000);
    }

    const titleMatch = text.match(/^(.{1,200}?)(?:\.\s|$)/);
    const title = titleMatch ? titleMatch[1].trim() : url;

    return { title, content: text, contentLength: text.length };
  } catch {
    return null;
  }
}