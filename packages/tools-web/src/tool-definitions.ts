import type { WebConfig } from '@piwin/contracts';
import { webFetch } from './web-fetch.js';
import { webSearch } from './search-provider.js';
import type { WebRuntimeCredentials } from './runtime-credentials.js';

/** Pure tool descriptors + executors for host to register with Pi. */
export type HostToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
};

export function createWebToolDefinitions(
  config?: Partial<WebConfig>,
  credentials: WebRuntimeCredentials = {},
): HostToolDefinition[] {
  return [
    {
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
      async execute(args, signal) {
        const query = String(args.query ?? '');
        const result = await webSearch(query, config, signal, credentials);
        return JSON.stringify(result, null, 2);
      },
    },
    {
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
        return JSON.stringify(result, null, 2);
      },
    },
  ];
}
