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
      prepareArgs: (rawArguments, _context, signal) => {
        if (signal.aborted) {
          return {
            ok: false,
            result: { ok: false, code: 'aborted', message: 'tool preparation aborted' },
          };
        }
        if (typeof rawArguments.query !== 'string' || rawArguments.query.trim().length === 0) {
          return {
            ok: false,
            result: { ok: false, code: 'invalid-input', message: 'query is required' },
          };
        }
        return { ok: true, arguments: { ...rawArguments, query: rawArguments.query.trim() } };
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
            return undefined;
          }
        },
      },
      prepareArgs: (rawArguments, _context, signal) => {
        if (signal.aborted) {
          return {
            ok: false,
            result: { ok: false, code: 'aborted', message: 'tool preparation aborted' },
          };
        }
        if (typeof rawArguments.url !== 'string' || rawArguments.url.trim().length === 0) {
          return {
            ok: false,
            result: { ok: false, code: 'invalid-input', message: 'url is required' },
          };
        }
        const url = rawArguments.url.trim();
        try {
          const parsed = new URL(url);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return {
              ok: false,
              result: { ok: false, code: 'invalid-input', message: 'url must be http(s)' },
            };
          }
        } catch {
          return {
            ok: false,
            result: { ok: false, code: 'invalid-input', message: 'url is invalid' },
          };
        }
        return { ok: true, arguments: { ...rawArguments, url } };
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
