import type {
  HostToolRegistration,
  WebConfig,
  WebDocumentExtractor,
  WebFetchExtractDelegate,
  WebFetchSpillStore,
  WebPageRenderer,
} from '@piwin/contracts';
import {
  formatWebFetchOutput,
  webFetch,
  type FetchCache,
  type WebFetchViewInput,
} from './web-fetch.js';
import type { FetchHostResolver } from './fetch-transport.js';
import { webSearch } from './search-provider.js';
import type { WebRuntimeCredentials } from './runtime-credentials.js';
import type { WebSearchModelDelegate } from './model-search-delegate.js';

export function createWebToolDefinitions(
  config?: Partial<WebConfig>,
  credentials: WebRuntimeCredentials = {},
  delegate?: WebSearchModelDelegate,
  fetchCache?: FetchCache,
  extractDelegate?: WebFetchExtractDelegate,
  pageRenderer?: WebPageRenderer,
  resolveHostAddresses?: FetchHostResolver,
  documentExtractor?: WebDocumentExtractor,
  spillStore?: WebFetchSpillStore,
): HostToolRegistration[] {
  return [
    {
      descriptor: {
        name: 'web_search',
        description:
          'Search the live web. Returns merged hits (title, url, snippet; optional source). Host may query multiple configured sources. After search, read a page with web_fetch; for long pages use outline or offset instead of fetching again from scratch.',
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
          'Fetch an http(s) URL and return readable text (not raw HTML). Pass query to extract about 4000 characters relevant to that question when a fetch delegate is configured; otherwise the start of the page is returned. For long pages use outline:true, offset/nextOffset, or spillPath with read_file/grep. PDFs are extracted when the Host document extractor is available.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'HTTP(S) URL to fetch' },
            query: {
              type: 'string',
              description:
                'What you want from the page. When a fetch delegate is configured, returns a focused excerpt instead of the page head.',
            },
            offset: {
              type: 'number',
              description: 'Character offset into the cached extraction. Use nextOffset from a prior result.',
            },
            maxChars: {
              type: 'number',
              description: 'Maximum characters of body text to return for this call.',
            },
            outline: {
              type: 'boolean',
              description: 'If true, return only the heading outline, not the body.',
            },
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
        const prepared: Record<string, unknown> = { ...rawArguments, url };
        if (rawArguments.query !== undefined) {
          if (typeof rawArguments.query !== 'string' || rawArguments.query.trim().length === 0) {
            return {
              ok: false,
              result: { ok: false, code: 'invalid-input', message: 'query must be a non-empty string' },
            };
          }
          prepared.query = rawArguments.query.trim();
        }
        if (rawArguments.offset !== undefined) {
          if (
            typeof rawArguments.offset !== 'number' ||
            !Number.isFinite(rawArguments.offset) ||
            rawArguments.offset < 0
          ) {
            return {
              ok: false,
              result: { ok: false, code: 'invalid-input', message: 'offset must be a non-negative number' },
            };
          }
          prepared.offset = Math.floor(rawArguments.offset);
        }
        if (rawArguments.maxChars !== undefined) {
          if (
            typeof rawArguments.maxChars !== 'number' ||
            !Number.isFinite(rawArguments.maxChars) ||
            rawArguments.maxChars < 1
          ) {
            return {
              ok: false,
              result: { ok: false, code: 'invalid-input', message: 'maxChars must be a positive number' },
            };
          }
          prepared.maxChars = Math.floor(rawArguments.maxChars);
        }
        if (rawArguments.outline !== undefined) {
          if (typeof rawArguments.outline !== 'boolean') {
            return {
              ok: false,
              result: { ok: false, code: 'invalid-input', message: 'outline must be a boolean' },
            };
          }
        }
        return { ok: true, arguments: prepared };
      },
      async execute(args, signal) {
        const url = String(args.url ?? '');
        const view: WebFetchViewInput = {};
        if (typeof args.query === 'string' && args.query.trim()) {
          view.query = args.query.trim();
        }
        if (typeof args.offset === 'number') {
          view.offset = args.offset;
        }
        if (typeof args.maxChars === 'number') {
          view.maxChars = args.maxChars;
        }
        if (args.outline === true) {
          view.outline = true;
        }
        const fetchOptions: Parameters<typeof webFetch>[1] = { view };
        if (config) {
          fetchOptions.config = config;
        }
        if (signal) {
          fetchOptions.signal = signal;
        }
        if (credentials.fetchApiKey) {
          fetchOptions.apiKey = credentials.fetchApiKey;
        }
        if (fetchCache) {
          fetchOptions.cache = fetchCache;
        }
        if (extractDelegate) {
          fetchOptions.extractDelegate = extractDelegate;
        }
        if (pageRenderer) {
          fetchOptions.pageRenderer = pageRenderer;
        }
        if (resolveHostAddresses) {
          fetchOptions.resolveHostAddresses = resolveHostAddresses;
        }
        if (documentExtractor) {
          fetchOptions.documentExtractor = documentExtractor;
        }
        if (spillStore) {
          fetchOptions.spillStore = spillStore;
        }
        const result = await webFetch(url, fetchOptions);
        return { ok: true, output: formatWebFetchOutput(result) };
      },
    },
  ];
}
