/**
 * Parse web tool JSON output into citation cards for the chat UI.
 * Host/tools-web already returns structured JSON strings.
 */

export type CitationCard = {
  title: string;
  url: string;
  snippet: string;
  source?: string;
};

export type ParsedToolCitations = {
  kind: 'web_search' | 'web_fetch' | 'none';
  query?: string;
  providerId?: string;
  citations: CitationCard[];
  fetchPreview?: {
    title: string | null;
    finalUrl: string;
    truncated: boolean;
    excerpt: string;
  };
};

export function parseToolCitations(toolName: string, output: string): ParsedToolCitations {
  if (!output.trim()) {
    return { kind: 'none', citations: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return { kind: 'none', citations: [] };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { kind: 'none', citations: [] };
  }
  const record = parsed as Record<string, unknown>;

  if (toolName === 'web_search' && Array.isArray(record.hits)) {
    const citations: CitationCard[] = [];
    for (const hit of record.hits) {
      if (!hit || typeof hit !== 'object') continue;
      const item = hit as Record<string, unknown>;
      const url = typeof item.url === 'string' ? item.url : '';
      if (!url) continue;
      const card: CitationCard = {
        title: typeof item.title === 'string' && item.title.trim() ? item.title : url,
        url,
        snippet: typeof item.snippet === 'string' ? item.snippet : '',
      };
      if (typeof item.source === 'string' && item.source.trim()) {
        card.source = item.source;
      }
      citations.push(card);
    }
    const result: ParsedToolCitations = {
      kind: 'web_search',
      citations,
    };
    if (typeof record.query === 'string') {
      result.query = record.query;
    }
    if (typeof record.providerId === 'string') {
      result.providerId = record.providerId;
    }
    return result;
  }

  if (toolName === 'web_fetch' && typeof record.url === 'string') {
    const finalUrl = typeof record.finalUrl === 'string' ? record.finalUrl : record.url;
    const text = typeof record.text === 'string' ? record.text : '';
    const title = typeof record.title === 'string' ? record.title : null;
    const citation: CitationCard = {
      title: title?.trim() ? title : finalUrl,
      url: finalUrl,
      snippet: text.slice(0, 240),
    };
    return {
      kind: 'web_fetch',
      citations: [citation],
      fetchPreview: {
        title,
        finalUrl,
        truncated: record.truncated === true,
        excerpt: text.slice(0, 600),
      },
    };
  }

  return { kind: 'none', citations: [] };
}
