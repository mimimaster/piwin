import { lookup as dnsLookup } from 'node:dns/promises';
import { isPrivateOrLocalHostname, isPrivateOrLocalIpAddress } from './private-address.js';

export const FETCH_USER_AGENT = 'piwin-web-fetch/0.1';
const DEFAULT_MAX_REDIRECTS = 5;

export type FetchHostResolver = (hostname: string) => Promise<string[]>;

export type BoundedResponseBody = {
  buffer: Uint8Array;
  truncated: boolean;
};

export type FetchedDocument = {
  finalUrl: string;
  contentType: string;
  byteSize: number;
  rawText: string;
  rawBytes: Uint8Array;
  bodyTruncated: boolean;
};

export function validateFetchUrl(url: string, blockedPrefixes: string[]): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`invalid url: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`only http/https allowed: ${url}`);
  }
  const lower = url.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  for (const prefix of blockedPrefixes) {
    const blocked = prefix.toLowerCase();
    if (lower.startsWith(blocked) || host === blocked || host.endsWith(`.${blocked}`)) {
      throw new Error(`url blocked by policy: ${url}`);
    }
  }
  if (isPrivateOrLocalHostname(host)) {
    throw new Error(`private or local fetch blocked: ${url}`);
  }
  return parsed.toString();
}

export async function assertSafeFetchUrl(
  url: string,
  blockedPrefixes: string[],
  resolveHostAddresses: FetchHostResolver = defaultResolveHostAddresses,
): Promise<string> {
  const validated = validateFetchUrl(url, blockedPrefixes);
  const hostname = new URL(validated).hostname;
  if (!isPrivateOrLocalIpAddress(hostname)) {
    const addresses = await resolveHostAddresses(hostname);
    for (const address of addresses) {
      if (isPrivateOrLocalIpAddress(address)) {
        throw new Error(`SSRF blocked: ${hostname} resolves to private address ${address}`);
      }
    }
  }
  return validated;
}

export async function defaultResolveHostAddresses(hostname: string): Promise<string[]> {
  if (isPrivateOrLocalIpAddress(hostname)) {
    return [hostname];
  }
  try {
    const results = await dnsLookup(hostname, { all: true, verbatim: true });
    return results.map((entry) => entry.address);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DNS lookup failed for ${hostname}: ${message}`);
  }
}

export function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 256).toLowerCase();
  return head.includes('<html') || head.includes('<!doctype html') || head.includes('<body');
}

export function anySignal(signals: AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

export async function readResponseBodyWithCap(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<BoundedResponseBody> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength <= maxBytes) {
      return { buffer, truncated: false };
    }
    return { buffer: buffer.slice(0, maxBytes), truncated: true };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      if (signal.aborted) {
        throw new Error('fetch aborted');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      if (value.byteLength > remaining) {
        if (remaining > 0) {
          chunks.push(value.slice(0, remaining));
          total += remaining;
        }
        truncated = true;
        try {
          await reader.cancel('byte-cap');
        } catch {
          // The bounded prefix is already safe to return; cancellation is best effort.
        }
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { buffer: merged, truncated };
}

export async function fetchHttpDocument(options: {
  url: string;
  blockedPrefixes: string[];
  bodyMaxBytes: number;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  resolveHostAddresses?: FetchHostResolver;
  maxRedirects?: number;
  headers?: Record<string, string>;
}): Promise<FetchedDocument> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const resolveHost = options.resolveHostAddresses ?? defaultResolveHostAddresses;
  let currentUrl = await assertSafeFetchUrl(options.url, options.blockedPrefixes, resolveHost);
  let response: Response | null = null;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    response = await fetchImpl(currentUrl, {
      redirect: 'manual',
      signal: options.signal,
      headers: {
        'User-Agent': FETCH_USER_AGENT,
        ...options.headers,
      },
    });

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`redirect missing location from ${currentUrl}`);
      }
      if (hop === maxRedirects) {
        throw new Error(`too many redirects (>${maxRedirects})`);
      }
      const nextUrl = new URL(location, currentUrl).toString();
      currentUrl = await assertSafeFetchUrl(nextUrl, options.blockedPrefixes, resolveHost);
      continue;
    }

    break;
  }

  if (!response) {
    throw new Error('fetch produced no response');
  }
  if (!response.ok) {
    throw new Error(`fetch failed: HTTP ${response.status} for ${currentUrl}`);
  }

  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const boundedBody = await readResponseBodyWithCap(response, options.bodyMaxBytes, options.signal);
  return {
    finalUrl: response.url || currentUrl,
    contentType,
    byteSize: boundedBody.buffer.byteLength,
    rawBytes: boundedBody.buffer,
    rawText: new TextDecoder('utf-8', { fatal: false }).decode(boundedBody.buffer),
    bodyTruncated: boundedBody.truncated,
  };
}
