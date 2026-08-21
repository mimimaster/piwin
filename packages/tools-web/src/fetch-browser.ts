import type { WebConfig, WebPageRenderer } from '@piwin/contracts';
import type { ResolvedFetchCaps } from './fetch-caps.js';
import type { FetchStoreRecord } from './fetch-cache.js';
import { storeFromRenderedHtml } from './fetch-render.js';
import { assertSafeFetchUrl, type FetchHostResolver } from './fetch-transport.js';

export async function fetchViaBrowserRenderer(
  url: string,
  config: WebConfig,
  caps: ResolvedFetchCaps,
  options: {
    pageRenderer?: WebPageRenderer;
    resolveHostAddresses?: FetchHostResolver;
    signal?: AbortSignal;
  },
): Promise<FetchStoreRecord> {
  if (!options.pageRenderer) {
    throw new Error('web_fetch browser renderer is not configured');
  }
  const resolver = options.resolveHostAddresses;
  const validated = resolver
    ? await assertSafeFetchUrl(url, config.fetchBlockedUrlPrefixes, resolver)
    : await assertSafeFetchUrl(url, config.fetchBlockedUrlPrefixes);
  const rendered = await options.pageRenderer.renderHtml({
    url: validated,
    timeoutMs: config.fetchTimeoutMs,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const finalUrl = resolver
    ? await assertSafeFetchUrl(rendered.finalUrl, config.fetchBlockedUrlPrefixes, resolver)
    : await assertSafeFetchUrl(rendered.finalUrl, config.fetchBlockedUrlPrefixes);
  return storeFromRenderedHtml({
    requestUrl: validated,
    finalUrl,
    html: rendered.html,
    blockedPrefixes: config.fetchBlockedUrlPrefixes,
    storeMaxChars: caps.storeMaxChars,
    parseMaxChars: caps.parseMaxChars,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}
