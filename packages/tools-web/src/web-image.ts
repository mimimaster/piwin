/**
 * `web_image` transport: download one representative image from a page URL or
 * a direct image URL so the Host can persist it and show it in the transcript.
 *
 * This is the only way a model can put a picture it *found* into a reply:
 * `web_search` hits carry no image field, and `web_fetch` deliberately refuses
 * non-text bodies. SSRF / size rules mirror `web_fetch` (scheme + host policy,
 * DNS private-IP reject, redirect revalidate, stream byte cap).
 *
 * SVG is rejected on purpose: an SVG is scriptable markup, not a bitmap the
 * media viewer may render next to trusted product UI.
 */

import type { WebConfig } from '@piwin/contracts';
import { resolveFetchCaps } from './fetch-caps.js';
import { anySignal, fetchHttpDocument, looksLikeHtml, type FetchHostResolver } from './fetch-transport.js';
import { extractTitleFallback } from './readable-extract.js';
import { resolveWebConfig } from './search-provider.js';

/** Bitmap types the media vault accepts for a fetched web image. */
export const WEB_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

/** One fetched image may cost at most this many bytes. */
export const MAX_WEB_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Meta tags that name a page's representative image, most specific first.
 * `og:image` wins because search/citation cards and link previews use it too.
 */
const PAGE_IMAGE_META_KEYS = [
  'og:image',
  'og:image:url',
  'og:image:secure_url',
  'twitter:image',
  'twitter:image:src',
] as const;

export type WebImageDiscovery = 'direct' | 'page';

export type FetchedWebImage = {
  /** URL the bytes actually came from (after redirects). */
  imageUrl: string;
  /** Set only when the requested URL was an HTML page. */
  pageUrl?: string;
  pageTitle?: string;
  mimeType: (typeof WEB_IMAGE_MIME_TYPES)[number];
  bytes: Uint8Array;
  discovery: WebImageDiscovery;
};

export type FetchWebImageOptions = {
  /** Page URL or direct image URL. */
  url: string;
  config?: Partial<WebConfig> | undefined;
  signal?: AbortSignal | undefined;
  resolveHostAddresses?: FetchHostResolver | undefined;
  fetchImpl?: typeof fetch | undefined;
};

/** Map a response content type onto a supported bitmap type, or reject it. */
export function normalizeWebImageMimeType(
  contentType: string,
): (typeof WEB_IMAGE_MIME_TYPES)[number] | undefined {
  const base = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  const normalized = base === 'image/jpg' ? 'image/jpeg' : base;
  return WEB_IMAGE_MIME_TYPES.find((allowed) => allowed === normalized);
}

/**
 * Pick the image a page presents as its own (`og:image` and friends), falling
 * back to the first usable `<img>`. Returns an absolute http(s) URL.
 */
export function findPageImageUrl(html: string, baseUrl: string): string | undefined {
  const metaCandidates = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attributes = readTagAttributes(tag);
    const key = (attributes['property'] ?? attributes['name'] ?? '').trim().toLowerCase();
    const content = attributes['content']?.trim();
    if (content && isPageImageMetaKey(key) && !metaCandidates.has(key)) {
      metaCandidates.set(key, content);
    }
  }
  for (const key of PAGE_IMAGE_META_KEYS) {
    const meta = metaCandidates.get(key);
    const resolved = meta === undefined ? undefined : resolveImageCandidate(meta, baseUrl);
    if (resolved) {
      return resolved;
    }
  }

  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const attributes = readTagAttributes(tag);
    const source =
      attributes['src']?.trim() || firstSrcsetCandidate(attributes['srcset']);
    const resolved = source ? resolveImageCandidate(source, baseUrl) : undefined;
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

/** Page title for tool output; never used as a file name. */
export function pageTitleForImage(html: string): string | undefined {
  const title = extractTitleFallback(html)?.trim();
  return title ? title : undefined;
}

/**
 * Fetch one image: direct bitmaps pass straight through, HTML pages are mined
 * for their representative image and that image is fetched under the same
 * SSRF and size rules.
 */
export async function fetchWebImage(options: FetchWebImageOptions): Promise<FetchedWebImage> {
  const config = resolveWebConfig(options.config);
  const caps = resolveFetchCaps(config);
  const maxBytes = Math.min(caps.bodyMaxBytes, MAX_WEB_IMAGE_BYTES);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  const signal = options.signal
    ? anySignal([options.signal, controller.signal])
    : controller.signal;
  try {
    const document = await fetchDocument(options, config, maxBytes, signal);
    const directMimeType = normalizeWebImageMimeType(document.contentType);
    if (directMimeType) {
      return {
        imageUrl: document.finalUrl,
        mimeType: directMimeType,
        bytes: requireImageBytes(document.rawBytes),
        discovery: 'direct',
      };
    }
    if (!document.contentType.toLowerCase().includes('html') && !looksLikeHtml(document.rawText)) {
      throw new Error(`unsupported content-type for image: ${document.contentType}`);
    }
    const imageTarget = findPageImageUrl(document.rawText, document.finalUrl);
    if (!imageTarget) {
      throw new Error(`no usable image found on page: ${document.finalUrl}`);
    }
    const imageDocument = await fetchDocument(
      { ...options, url: imageTarget },
      config,
      maxBytes,
      signal,
    );
    const pageMimeType = normalizeWebImageMimeType(imageDocument.contentType);
    if (!pageMimeType) {
      throw new Error(`not a supported image: ${imageDocument.contentType} (${imageTarget})`);
    }
    const pageTitle = pageTitleForImage(document.rawText);
    return {
      imageUrl: imageDocument.finalUrl,
      pageUrl: document.finalUrl,
      ...(pageTitle !== undefined ? { pageTitle } : {}),
      mimeType: pageMimeType,
      bytes: requireImageBytes(imageDocument.rawBytes),
      discovery: 'page',
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Model-facing output: facts plus the rule that the user already sees it. */
export function formatWebImageOutput(result: FetchedWebImage, mediaId: string): string {
  const lines = [
    'status: success',
    `imageUrl: ${result.imageUrl}`,
  ];
  if (result.pageUrl) {
    lines.push(`pageUrl: ${result.pageUrl}`);
  }
  if (result.pageTitle) {
    lines.push(`pageTitle: ${result.pageTitle}`);
  }
  lines.push(`mimeType: ${result.mimeType}`);
  lines.push(`byteSize: ${String(result.bytes.byteLength)}`);
  lines.push(`mediaId: ${mediaId}`);
  lines.push(
    'note: the image is already attached to this message and visible to the user. Do not repeat the URL as markdown or paste base64.',
  );
  return lines.join('\n');
}

async function fetchDocument(
  options: FetchWebImageOptions,
  config: WebConfig,
  maxBytes: number,
  signal: AbortSignal,
) {
  return fetchHttpDocument({
    url: options.url,
    blockedPrefixes: config.fetchBlockedUrlPrefixes,
    bodyMaxBytes: maxBytes,
    signal,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.resolveHostAddresses
      ? { resolveHostAddresses: options.resolveHostAddresses }
      : {}),
  });
}

function requireImageBytes(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength === 0) {
    throw new Error('image response was empty');
  }
  return bytes;
}

function isPageImageMetaKey(key: string): boolean {
  return (PAGE_IMAGE_META_KEYS as readonly string[]).includes(key);
}

function readTagAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([a-zA-Z][a-zA-Z0-9:_-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match = pattern.exec(tag);
  while (match) {
    const name = (match[1] ?? '').toLowerCase();
    const value = match[2] ?? match[3] ?? '';
    if (name && attributes[name] === undefined) {
      attributes[name] = value;
    }
    match = pattern.exec(tag);
  }
  return attributes;
}

function firstSrcsetCandidate(srcset: string | undefined): string | undefined {
  if (!srcset) {
    return undefined;
  }
  const first = srcset.split(',')[0]?.trim();
  const url = first?.split(/\s+/)[0];
  return url ? url : undefined;
}

function resolveImageCandidate(raw: string, baseUrl: string): string | undefined {
  const value = raw.trim().replace(/&amp;/g, '&');
  if (!value || value.startsWith('data:')) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value, baseUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }
  if (/\.svgz?$/i.test(url.pathname)) {
    return undefined;
  }
  return url.toString();
}
