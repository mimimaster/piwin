import type {
  WebConfig,
  WebDocumentExtractor,
  WebFetchResult,
  WebFetchSpillStore,
  WebFetchTruncationReason,
  WebPageRenderer,
} from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import { resolveWebConfig } from './search-provider.js';
import { resolveFetchCaps, type ResolvedFetchCaps } from './fetch-caps.js';
import { detectThinContent } from './fetch-thin.js';
import { applyFetchFallback } from './fetch-fallback.js';
import {
  anySignal,
  fetchHttpDocument,
  looksLikeHtml,
  readResponseBodyWithCap,
  validateFetchUrl,
  FETCH_USER_AGENT,
  type FetchHostResolver,
} from './fetch-transport.js';
import { fetchViaBrowserRenderer } from './fetch-browser.js';
import { tryExtractPdfStore } from './fetch-document.js';
import { attachFetchSpill } from './fetch-spill.js';
import {
  extractMarkdownTitle,
  extractOutlineFromMarkdown,
  extractReadableText,
} from './readable-extract.js';
import { normalizeFetchCacheKey, type FetchCache, type FetchStoreRecord } from './fetch-cache.js';
import { selectFetchView, type WebFetchViewInput } from './fetch-view.js';
import {
  applyFetchExtractView,
  shouldUseFetchExtract,
} from './fetch-extract-delegate.js';
import type { WebFetchExtractDelegate } from './fetch-extract-delegate.js';

export type { WebFetchViewInput } from './fetch-view.js';
export { FetchCache, normalizeFetchCacheKey } from './fetch-cache.js';
export type { FetchStoreRecord } from './fetch-cache.js';
export { validateFetchUrl, assertSafeFetchUrl } from './fetch-transport.js';
export type { FetchHostResolver } from './fetch-transport.js';
export { formatWebFetchOutput } from './web-fetch-output.js';
export { resolveFetchCaps } from './fetch-caps.js';

export type WebFetchOptions = {
  config?: Partial<WebConfig>;
  signal?: AbortSignal;
  /** Host-resolved keychain secret for this in-memory execution only. */
  apiKey?: string;
  /** Injected for tests */
  fetchImpl?: typeof fetch;
  /** Injected DNS resolver for tests */
  resolveHostAddresses?: FetchHostResolver;
  /** Max redirect hops (each revalidated). Default 5. */
  maxRedirects?: number;
  /** Shared Host cache. A hit skips the network, not permission. */
  cache?: FetchCache;
  /** Progressive-disclosure view over the cached extraction. */
  view?: WebFetchViewInput;
  /** Host-injected focused-extract model. Missing/failed extract falls back to head. */
  extractDelegate?: WebFetchExtractDelegate;
  /** Host-injected one-shot HTML renderer (ADR 0058). */
  pageRenderer?: WebPageRenderer;
  /** Host-injected PDF / document extract (Phase D). */
  documentExtractor?: WebDocumentExtractor;
  /** Host-injected full-text spill for grep / read_file. */
  spillStore?: WebFetchSpillStore;
};

/**
 * Fetch URL and extract readable text, then return a bounded view.
 * SSRF defenses: scheme/host policy, DNS private-IP reject, redirect revalidate, stream byte cap.
 */
export async function webFetch(
  url: string,
  options: WebFetchOptions = {},
): Promise<WebFetchResult> {
  const config = resolveWebConfig(options.config);
  const caps = resolveFetchCaps(config);
  const cacheKey = normalizeFetchCacheKey(url, config.fetchProvider);
  let stored: FetchStoreRecord | undefined;
  let fromCache = false;
  if (options.cache) {
    stored = options.cache.get(cacheKey, caps.cacheTtlMs);
    fromCache = stored !== undefined;
  }
  if (!stored) {
    stored = await fetchAndStore(url, config, caps, options);
  }
  const resolved = await applyFetchFallback(
    stored,
    config,
    () => retryThinFallback(url, config, caps, options),
    options.signal,
  );
  if (!fromCache || resolved !== stored) {
    options.cache?.set(cacheKey, resolved);
  }
  stored = resolved;
  const view = options.view ?? {};
  let result: WebFetchResult;
  if (stored.skipView !== true && shouldUseFetchExtract(view, options.extractDelegate)) {
    try {
      result = await applyFetchExtractView(
        stored,
        view,
        caps,
        fromCache,
        options.extractDelegate,
        options.signal,
      );
      return attachFetchSpill(result, stored, options.spillStore, options.signal);
    } catch (error) {
      if (options.signal?.aborted) {
        throw error;
      }
    }
  }
  result = selectFetchView(stored, view, caps, fromCache);
  return attachFetchSpill(result, stored, options.spillStore, options.signal);
}

async function fetchAndStore(
  url: string,
  config: WebConfig,
  caps: ResolvedFetchCaps,
  options: WebFetchOptions,
): Promise<FetchStoreRecord> {
  if (config.fetchProvider === 'jina') {
    return fetchViaJina(url, config, caps, options);
  }
  if (config.fetchProvider === 'firecrawl') {
    return fetchViaFirecrawl(url, config, caps, options);
  }
  return fetchViaSupermarkdown(url, config, caps, options);
}

async function retryThinFallback(
  url: string,
  config: WebConfig,
  caps: ResolvedFetchCaps,
  options: WebFetchOptions,
): Promise<FetchStoreRecord> {
  if (config.fetchFallback === 'jina') {
    return fetchViaJina(url, { ...config, fetchProvider: 'jina' }, caps, options);
  }
  if (config.fetchFallback === 'browser') {
    return fetchViaBrowserRenderer(url, config, caps, options);
  }
  throw new Error('web_fetch fallback is not configured');
}

async function fetchViaSupermarkdown(
  url: string,
  config: WebConfig,
  caps: ResolvedFetchCaps,
  options: WebFetchOptions,
): Promise<FetchStoreRecord> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  const signal = options.signal
    ? anySignal([options.signal, controller.signal])
    : controller.signal;
  try {
    const document = await fetchHttpDocument({
      url,
      blockedPrefixes: config.fetchBlockedUrlPrefixes,
      bodyMaxBytes: caps.bodyMaxBytes,
      signal,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      ...(options.resolveHostAddresses ? { resolveHostAddresses: options.resolveHostAddresses } : {}),
      ...(options.maxRedirects !== undefined ? { maxRedirects: options.maxRedirects } : {}),
    });

    const pdfStore = await tryExtractPdfStore({
      requestUrl: url,
      document,
      blockedPrefixes: config.fetchBlockedUrlPrefixes,
      caps,
      ...(options.documentExtractor ? { extractor: options.documentExtractor } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (pdfStore) {
      return pdfStore;
    }

    if (document.contentType.includes('text/html') || looksLikeHtml(document.rawText)) {
      if (signal.aborted) {
        throw new Error('fetch timed out before page parsing');
      }
      const parseTruncated = document.rawText.length > caps.parseMaxChars;
      const htmlToParse = parseTruncated
        ? document.rawText.slice(0, caps.parseMaxChars)
        : document.rawText;
      const extracted = await extractReadableText(htmlToParse, document.finalUrl, signal);
      const storeSlice = sliceStoredText(extracted.text, caps.storeMaxChars);
      const truncated = document.bodyTruncated || parseTruncated || storeSlice.truncated;
      const truncationReason = resolveTruncationReason({
        bodyTruncated: document.bodyTruncated,
        parseTruncated,
        textTruncated: storeSlice.truncated,
      });
      const thinContent = detectThinContent(extracted.text, htmlToParse);
      return {
        url: validateFetchUrl(url, config.fetchBlockedUrlPrefixes),
        finalUrl: document.finalUrl,
        title: extracted.title,
        text: storeSlice.text,
        contentType: document.contentType,
        byteSize: document.byteSize,
        truncated,
        outline: extracted.outline,
        provider: 'supermarkdown',
        ...(truncationReason ? { truncationReason } : {}),
        ...(thinContent ? { thinContent: true } : {}),
      };
    }

    if (
      document.contentType.startsWith('text/') ||
      document.contentType.includes('json') ||
      document.contentType.includes('xml')
    ) {
      const storeSlice = sliceStoredText(document.rawText, caps.storeMaxChars);
      const truncated = document.bodyTruncated || storeSlice.truncated;
      const truncationReason = resolveTruncationReason({
        bodyTruncated: document.bodyTruncated,
        parseTruncated: false,
        textTruncated: storeSlice.truncated,
      });
      return {
        url: validateFetchUrl(url, config.fetchBlockedUrlPrefixes),
        finalUrl: document.finalUrl,
        title: null,
        text: storeSlice.text,
        contentType: document.contentType,
        byteSize: document.byteSize,
        truncated,
        outline: [],
        provider: 'supermarkdown',
        ...(truncationReason ? { truncationReason } : {}),
      };
    }

    throw new Error(`unsupported content-type for fetch: ${document.contentType}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaJina(
  url: string,
  config: WebConfig,
  caps: ResolvedFetchCaps,
  options: WebFetchOptions,
): Promise<FetchStoreRecord> {
  const validated = validateFetchUrl(url, config.fetchBlockedUrlPrefixes);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  const signal = options.signal
    ? anySignal([options.signal, controller.signal])
    : controller.signal;
  try {
    const headers: Record<string, string> = {
      Accept: 'text/plain',
      'User-Agent': FETCH_USER_AGENT,
      'X-Return-Format': 'markdown',
    };
    const apiKey =
      options.apiKey ??
      process.env[config.fetchApiKeyEnv] ??
      process.env.JINA_API_KEY ??
      process.env.JINA_READER_API_KEY;
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    const response = await (options.fetchImpl ?? fetch)(`https://r.jina.ai/${validated}`, {
      headers,
      signal,
    });
    if (!response.ok) {
      throw new Error(`Jina Reader failed: HTTP ${response.status} for ${validated}`);
    }
    const boundedBody = await readResponseBodyWithCap(response, caps.bodyMaxBytes, signal);
    const rawText = new TextDecoder('utf-8', { fatal: false }).decode(boundedBody.buffer);
    const storeSlice = sliceStoredText(rawText, caps.storeMaxChars);
    const truncated = boundedBody.truncated || storeSlice.truncated;
    const truncationReason = resolveTruncationReason({
      bodyTruncated: boundedBody.truncated,
      parseTruncated: false,
      textTruncated: storeSlice.truncated,
    });
    return {
      url: validated,
      finalUrl: validated,
      title: extractMarkdownTitle(rawText),
      text: storeSlice.text,
      contentType: response.headers.get('content-type') ?? 'text/markdown',
      byteSize: boundedBody.buffer.byteLength,
      truncated,
      outline: extractOutlineFromMarkdown(rawText),
      provider: 'jina',
      ...(truncationReason ? { truncationReason } : {}),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchViaFirecrawl(
  url: string,
  config: WebConfig,
  caps: ResolvedFetchCaps,
  options: WebFetchOptions,
): Promise<FetchStoreRecord> {
  const validated = validateFetchUrl(url, config.fetchBlockedUrlPrefixes);
  const apiKey =
    options.apiKey ?? process.env[config.fetchApiKeyEnv] ?? process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error(
      `Missing API key env ${config.fetchApiKeyEnv} (or FIRECRAWL_API_KEY) for Firecrawl`,
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  const signal = options.signal
    ? anySignal([options.signal, controller.signal])
    : controller.signal;
  try {
    const response = await (options.fetchImpl ?? fetch)('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: validated,
        formats: ['markdown'],
      }),
      signal,
    });
    if (!response.ok) {
      throw new Error(`Firecrawl scrape failed: HTTP ${response.status} for ${validated}`);
    }
    const boundedBody = await readResponseBodyWithCap(response, caps.bodyMaxBytes, signal);
    const contentType = response.headers.get('content-type') ?? 'application/json';
    if (boundedBody.truncated) {
      return {
        url: validated,
        finalUrl: validated,
        title: null,
        text: `Firecrawl response exceeded the ${caps.bodyMaxBytes}-byte provider envelope limit; retry with the supermarkdown or jina fetch provider.`,
        contentType,
        byteSize: boundedBody.buffer.byteLength,
        truncated: true,
        truncationReason: 'response-limit',
        outline: [],
        provider: 'firecrawl',
        skipView: true,
      };
    }
    const payload = JSON.parse(
      new TextDecoder('utf-8', { fatal: false }).decode(boundedBody.buffer),
    ) as {
      success?: boolean;
      data?: {
        markdown?: string;
        metadata?: { title?: string; sourceURL?: string };
      };
    };
    const markdown = payload.data?.markdown ?? '';
    if (!markdown.trim()) {
      throw new Error(`Firecrawl returned empty markdown for ${validated}`);
    }
    const storeSlice = sliceStoredText(markdown, caps.storeMaxChars);
    return {
      url: validated,
      finalUrl: payload.data?.metadata?.sourceURL ?? validated,
      title: payload.data?.metadata?.title ?? extractMarkdownTitle(markdown),
      text: storeSlice.text,
      contentType: 'text/markdown',
      byteSize: new TextEncoder().encode(markdown).byteLength,
      truncated: storeSlice.truncated,
      outline: extractOutlineFromMarkdown(markdown),
      provider: 'firecrawl',
      ...(storeSlice.truncated ? { truncationReason: 'text-limit' as const } : {}),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function sliceStoredText(text: string, storeMaxChars: number): { text: string; truncated: boolean } {
  if (text.length <= storeMaxChars) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, storeMaxChars), truncated: true };
}

function resolveTruncationReason(flags: {
  bodyTruncated: boolean;
  parseTruncated: boolean;
  textTruncated: boolean;
}): WebFetchTruncationReason | undefined {
  if (flags.bodyTruncated) {
    return 'response-limit';
  }
  if (flags.parseTruncated) {
    return 'parse-limit';
  }
  if (flags.textTruncated) {
    return 'text-limit';
  }
  return undefined;
}

export function createDefaultFetchConfig(): WebConfig {
  return createDefaultWebConfig();
}
