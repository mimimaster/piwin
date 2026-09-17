import { spawn } from 'node:child_process';
import type { SearchHit, WebSearchSource, WebSearchSourceAttempt } from '@piwin/contracts';

export type SearchProviderOptions = {
  limit: number;
  signal?: AbortSignal;
  /** Aggregate providers report each source's outcome; single sources ignore it. */
  onSourceAttempt?: (attempt: WebSearchSourceAttempt) => void;
};

export type SearchProvider = {
  id: string;
  search(query: string, options: SearchProviderOptions): Promise<SearchHit[]>;
};

/**
 * Build a SearchProvider for one configured source.
 * Throws only on misconfiguration; network failures surface from search().
 */
export function createProviderForSource(source: WebSearchSource, apiKey?: string): SearchProvider {
  if (source.kind === 'duckduckgo') {
    return createDuckDuckGoProvider(source.id);
  }
  if (source.kind === 'brave') {
    return createBraveProvider(source, apiKey);
  }
  if (source.kind === 'tavily') {
    return createTavilyProvider(source, apiKey);
  }
  if (source.kind === 'searxng') {
    return createSearxngProvider(source);
  }
  if (source.kind === 'http') {
    return createHttpProvider(source, apiKey);
  }
  return createCliProvider(source);
}

function createBraveProvider(source: WebSearchSource, runtimeApiKey?: string): SearchProvider {
  const apiKeyEnv = source.apiKeyEnv?.trim() || 'BRAVE_API_KEY';
  return {
    id: source.id,
    async search(query, options) {
      const apiKey = runtimeApiKey ?? process.env[apiKeyEnv] ?? process.env.BRAVE_API_KEY;
      if (!apiKey) {
        throw new Error(`Missing API key env ${apiKeyEnv} (or BRAVE_API_KEY) for Brave Search`);
      }
      const url = new URL('https://api.search.brave.com/res/v1/web/search');
      url.searchParams.set('q', query);
      url.searchParams.set('count', String(Math.min(Math.max(options.limit, 1), 20)));
      const requestInit: RequestInit = {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
      };
      if (options.signal) {
        requestInit.signal = options.signal;
      }
      const response = await fetch(url, requestInit);
      if (!response.ok) {
        throw new Error(`Brave search failed: HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
      };
      return (payload.web?.results ?? [])
        .filter((item) => item.url && item.title)
        .map((item) => ({
          title: item.title ?? item.url ?? '',
          url: item.url ?? '',
          snippet: item.description ?? '',
          source: source.id,
        }));
    },
  };
}

function createTavilyProvider(source: WebSearchSource, runtimeApiKey?: string): SearchProvider {
  const apiKeyEnv = source.apiKeyEnv?.trim() || 'TAVILY_API_KEY';
  return {
    id: source.id,
    async search(query, options) {
      const apiKey = runtimeApiKey ?? process.env[apiKeyEnv] ?? process.env.TAVILY_API_KEY;
      if (!apiKey) {
        throw new Error(`Missing API key env ${apiKeyEnv} (or TAVILY_API_KEY) for Tavily`);
      }
      const requestInit: RequestInit = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: Math.min(Math.max(options.limit, 1), 20),
        }),
      };
      if (options.signal) {
        requestInit.signal = options.signal;
      }
      const response = await fetch('https://api.tavily.com/search', requestInit);
      if (!response.ok) {
        throw new Error(`Tavily search failed: HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string }>;
      };
      return (payload.results ?? [])
        .filter((item) => item.url && item.title)
        .map((item) => ({
          title: item.title ?? item.url ?? '',
          url: item.url ?? '',
          snippet: item.content ?? '',
          source: source.id,
        }));
    },
  };
}

/**
 * SearXNG JSON search API: GET {baseUrl}/search?q=...&format=json
 */
function createSearxngProvider(source: WebSearchSource): SearchProvider {
  const baseUrl = source.baseUrl?.trim() ?? '';
  return {
    id: source.id,
    async search(query, options) {
      if (!baseUrl) {
        throw new Error(`SearXNG source "${source.id}" is missing baseUrl`);
      }
      let searchUrl: URL;
      try {
        searchUrl = new URL('search', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      } catch {
        throw new Error(`SearXNG source "${source.id}" has invalid baseUrl: ${baseUrl}`);
      }
      searchUrl.searchParams.set('q', query);
      searchUrl.searchParams.set('format', 'json');
      const requestInit: RequestInit = {
        headers: { Accept: 'application/json' },
      };
      if (options.signal) {
        requestInit.signal = options.signal;
      }
      const response = await fetch(searchUrl, requestInit);
      if (!response.ok) {
        throw new Error(`SearXNG search failed: HTTP ${response.status}`);
      }
      const payload = (await response.json()) as {
        results?: Array<{ title?: string; url?: string; content?: string; pretty_url?: string }>;
      };
      const limit = Math.min(Math.max(options.limit, 1), 20);
      return (payload.results ?? [])
        .filter((item) => (item.url || item.pretty_url) && item.title)
        .slice(0, limit)
        .map((item) => ({
          title: item.title ?? item.url ?? '',
          url: item.url ?? item.pretty_url ?? '',
          snippet: item.content ?? '',
          source: source.id,
        }));
    },
  };
}

/**
 * Custom CLI: spawn without shell; stdout must be JSON hits.
 * Accepted shapes:
 *   { "hits": [ { title, url, snippet, source? } ] }
 *   [ { title, url, snippet, source? } ]
 */
function createCliProvider(source: WebSearchSource): SearchProvider {
  const command = source.command?.trim() ?? '';
  const argTemplate = source.args && source.args.length > 0 ? source.args : ['{{query}}'];
  const extraEnv = source.env;
  return {
    id: source.id,
    async search(query, options) {
      if (!command) {
        throw new Error(`CLI search source "${source.id}" is missing command`);
      }
      const argv = argTemplate.map((part) => part.replaceAll('{{query}}', query));
      const stdout = await runCliCapture(command, argv, options.signal, extraEnv);
      return parseSearchHitsJson(stdout, source.id, options.limit);
    },
  };
}

/**
 * Open WebUI-compatible custom search: POST {query, count} → hits JSON.
 */
function createHttpProvider(source: WebSearchSource, runtimeApiKey?: string): SearchProvider {
  const baseUrl = source.baseUrl?.trim() ?? '';
  const apiKeyEnv = source.apiKeyEnv?.trim();
  return {
    id: source.id,
    async search(query, options) {
      if (!baseUrl) {
        throw new Error(`HTTP search source "${source.id}" is missing baseUrl`);
      }
      let endpoint: URL;
      try {
        endpoint = new URL(baseUrl);
      } catch {
        throw new Error(`HTTP search source "${source.id}" has invalid baseUrl: ${baseUrl}`);
      }
      const apiKey =
        runtimeApiKey ?? (apiKeyEnv ? process.env[apiKeyEnv] : undefined) ?? undefined;
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      const requestInit: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          count: Math.min(Math.max(options.limit, 1), 20),
        }),
      };
      if (options.signal) {
        requestInit.signal = options.signal;
      }
      const response = await fetch(endpoint, requestInit);
      if (!response.ok) {
        throw new Error(`HTTP search failed: HTTP ${response.status}`);
      }
      const payload = await response.text();
      return parseSearchHitsJson(payload, source.id, options.limit);
    },
  };
}

function mergeSpawnEnv(extraEnv?: Record<string, string>): NodeJS.ProcessEnv {
  if (!extraEnv) {
    return process.env;
  }
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(extraEnv)) {
    merged[key] = value;
  }
  return merged;
}

function runCliCapture(
  command: string,
  argv: string[],
  signal?: AbortSignal,
  extraEnv?: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: mergeSpawnEnv(extraEnv),
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const settle = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(value ?? '');
    };

    const onAbort = () => {
      child.kill('SIGTERM');
      settle(new Error(`CLI search aborted: ${command}`));
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', (error) => {
      settle(
        new Error(
          `CLI search failed to start "${command}": ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });
    child.on('close', (code) => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      const stdout = Buffer.concat(stdoutChunks).toString('utf8');
      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      if (code !== 0) {
        settle(
          new Error(
            `CLI search "${command}" exited ${code ?? 'null'}${stderr ? `: ${stderr.slice(0, 400)}` : ''}`,
          ),
        );
        return;
      }
      settle(undefined, stdout);
    });
  });
}

function parseSearchHitsJson(stdout: string, sourceId: string, limit: number): SearchHit[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(
      `Search source "${sourceId}" response is not JSON. Expected { hits: [...] } or an array of hits.`,
    );
  }
  const rawHits = extractHitArray(parsed);
  const max = Math.min(Math.max(limit, 1), 50);
  const hits: SearchHit[] = [];
  for (const item of rawHits) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    const urlValue =
      typeof record.url === 'string'
        ? record.url
        : typeof record.link === 'string'
          ? record.link
          : '';
    const url = urlValue.trim();
    if (!title || !url) continue;
    const snippet = typeof record.snippet === 'string' ? record.snippet : '';
    const source =
      typeof record.source === 'string' && record.source.trim() ? record.source.trim() : sourceId;
    hits.push({ title, url, snippet, source });
    if (hits.length >= max) break;
  }
  return hits;
}

function extractHitArray(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) {
    return parsed;
  }
  if (parsed && typeof parsed === 'object') {
    const hits = (parsed as { hits?: unknown }).hits;
    if (Array.isArray(hits)) {
      return hits;
    }
  }
  throw new Error('Search JSON must be an array of hits or { "hits": [...] }');
}

/**
 * Zero-config DuckDuckGo Instant Answer + HTML lite results.
 */
function createDuckDuckGoProvider(sourceId: string): SearchProvider {
  return {
    id: sourceId,
    async search(query, options) {
      const limit = Math.min(Math.max(options.limit, 1), 20);
      const hits: SearchHit[] = [];

      try {
        const instantUrl = new URL('https://api.duckduckgo.com/');
        instantUrl.searchParams.set('q', query);
        instantUrl.searchParams.set('format', 'json');
        instantUrl.searchParams.set('no_html', '1');
        instantUrl.searchParams.set('skip_disambig', '1');
        const requestInit: RequestInit = {
          headers: { Accept: 'application/json' },
        };
        if (options.signal) {
          requestInit.signal = options.signal;
        }
        const response = await fetch(instantUrl, requestInit);
        if (response.status === 200) {
          const payload = (await response.json()) as {
            AbstractText?: string;
            AbstractURL?: string;
            Heading?: string;
            RelatedTopics?: Array<
              | { Text?: string; FirstURL?: string }
              | { Topics?: Array<{ Text?: string; FirstURL?: string }> }
            >;
            Results?: Array<{ Text?: string; FirstURL?: string }>;
          };
          if (payload.AbstractURL && (payload.Heading || payload.AbstractText)) {
            hits.push({
              title: payload.Heading || payload.AbstractURL,
              url: payload.AbstractURL,
              snippet: payload.AbstractText ?? '',
              source: sourceId,
            });
          }
          const pushTopic = (topic: { Text?: string; FirstURL?: string } | undefined) => {
            if (!topic?.FirstURL || !topic.Text) {
              return;
            }
            if (hits.some((hit) => hit.url === topic.FirstURL)) {
              return;
            }
            hits.push({
              title: topic.Text.split(' - ')[0] ?? topic.Text,
              url: topic.FirstURL,
              snippet: topic.Text,
              source: sourceId,
            });
          };
          for (const topic of payload.Results ?? []) {
            pushTopic(topic);
            if (hits.length >= limit) break;
          }
          for (const topic of payload.RelatedTopics ?? []) {
            if ('Topics' in topic && Array.isArray(topic.Topics)) {
              for (const nested of topic.Topics) {
                pushTopic(nested);
                if (hits.length >= limit) break;
              }
            } else if ('FirstURL' in topic) {
              pushTopic(topic);
            }
            if (hits.length >= limit) break;
          }
        }
      } catch {
        // Fall through to HTML lite.
      }

      if (hits.length >= limit) {
        return hits.slice(0, limit);
      }

      try {
        const body = new URLSearchParams({ q: query });
        const requestInit: RequestInit = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'text/html',
            'User-Agent': 'piwin-web-search/0.1',
          },
          body: body.toString(),
        };
        if (options.signal) {
          requestInit.signal = options.signal;
        }
        const response = await fetch('https://html.duckduckgo.com/html/', requestInit);
        if (response.status === 202) {
          throw new Error(
            'DuckDuckGo blocked this search request (HTTP 202, likely bot protection or rate limiting). ' +
              'Retry later or enable another search source (brave/tavily/searxng/cli) in Settings → Web.',
          );
        }
        if (!response.ok) {
          if (hits.length > 0) {
            return hits.slice(0, limit);
          }
          throw new Error(`DuckDuckGo HTML search failed: HTTP ${response.status}`);
        }
        const html = await response.text();
        for (const hit of parseDuckDuckGoHtmlResults(html, sourceId)) {
          if (hits.some((existing) => existing.url === hit.url)) {
            continue;
          }
          hits.push(hit);
          if (hits.length >= limit) {
            break;
          }
        }
      } catch (error) {
        if (hits.length > 0) {
          return hits.slice(0, limit);
        }
        throw error;
      }

      return hits.slice(0, limit);
    },
  };
}

function parseDuckDuckGoHtmlResults(html: string, sourceId: string): SearchHit[] {
  const hits: SearchHit[] = [];
  const resultBlocks = html.split(/class="result\b/i).slice(1);
  for (const block of resultBlocks) {
    const linkMatch =
      block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ??
      block.match(/href="([^"]+)"[^>]*class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) {
      continue;
    }
    const rawHref = decodeHtmlEntities(linkMatch[1] ?? '');
    const title = stripTags(decodeHtmlEntities(linkMatch[2] ?? '')).trim();
    const url = unwrapDuckDuckGoRedirect(rawHref);
    if (!url || !title || !/^https?:\/\//i.test(url)) {
      continue;
    }
    const snippetMatch =
      block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|td|div)/i) ??
      block.match(/class="result__snippet"[^>]*>([\s\S]*?)</i);
    const snippet = stripTags(decodeHtmlEntities(snippetMatch?.[1] ?? '')).trim();
    hits.push({
      title,
      url,
      snippet,
      source: sourceId,
    });
  }
  return hits;
}

function unwrapDuckDuckGoRedirect(href: string): string {
  try {
    const parsed = new URL(href, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) {
      return decodeURIComponent(uddg);
    }
    return parsed.toString();
  } catch {
    return href;
  }
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}
