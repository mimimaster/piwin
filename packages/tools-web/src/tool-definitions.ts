import type { HostToolRegistration, WebConfig } from '@piwin/contracts';
import { webFetch } from './web-fetch.js';
import { webSearch } from './search-provider.js';
import type { WebRuntimeCredentials } from './runtime-credentials.js';

export function createWebToolDefinitions(
  config?: Partial<WebConfig>,
  credentials: WebRuntimeCredentials = {},
): HostToolRegistration[] {
  return [
    {
      descriptor: {
        name: 'web_search',
        description:
          'Search the web for current information. Host may query multiple configured sources and merge hits (URL-deduped). Returns titles, URLs, and snippets; optional per-hit source tags.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
          },
          required: ['query'],
        },
      },
      family: 'web-search',
      permissionSpec: {
        action: 'network:web_search',
        risk: 'network',
        rememberable: true,
        subjectBuilder: () => ({ kind: 'web-search' }),
      },
      async execute(args, signal) {
        const query = String(args.query ?? '');
        const result = await webSearch(query, config, signal, credentials);
        return { ok: true, output: JSON.stringify(result, null, 2) };
      },
    },
    {
      descriptor: {
        name: 'web_fetch',
        description:
          'Fetch a URL and extract readable text content. Use for documentation and articles.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'HTTP(S) URL to fetch' },
          },
          required: ['url'],
        },
      },
      family: 'web-fetch',
      permissionSpec: {
        action: 'network:web_fetch',
        risk: 'network',
        rememberable: true,
        subjectBuilder: (args) => {
          const target = String(args.url ?? '');
          try {
            return { kind: 'web-fetch', host: new URL(target).hostname.toLowerCase() };
          } catch {
            return { kind: 'web-fetch', host: target };
          }
        },
      },
      async execute(args, signal) {
        const url = String(args.url ?? '');
        const fetchOptions: Parameters<typeof webFetch>[1] = {};
        if (config) {
          fetchOptions.config = config;
        }
        if (signal) {
          fetchOptions.signal = signal;
        }
        if (credentials.fetchApiKey) {
          fetchOptions.apiKey = credentials.fetchApiKey;
        }
        const result = await webFetch(url, fetchOptions);
        return { ok: true, output: JSON.stringify(result, null, 2) };
      },
    },
  ];
}
