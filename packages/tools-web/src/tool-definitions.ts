import type { HostToolRegistration, WebConfig } from '@piwin/contracts';
import { webFetch } from './web-fetch.js';
import { webSearch } from './search-provider.js';
import type { WebRuntimeCredentials } from './runtime-credentials.js';
import type { WebSearchModelDelegate } from './model-search-delegate.js';

export function createWebToolDefinitions(
  config?: Partial<WebConfig>,
  credentials: WebRuntimeCredentials = {},
  delegate?: WebSearchModelDelegate,
): HostToolRegistration[] {
  return [
    {
      descriptor: {
        name: 'web_search',
        description:
          'Search the live web. Returns merged hits (title, url, snippet; optional source). Host may query multiple configured sources.',
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
        const result = await webSearch(query, config, signal, credentials, delegate);
        return { ok: true, output: JSON.stringify(result, null, 2) };
      },
    },
    {
      descriptor: {
        name: 'web_fetch',
        description:
          'Fetch an http(s) URL and return readable text. Use to ground claims from documentation or articles.',
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
