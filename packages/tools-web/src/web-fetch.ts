import { lookup as dnsLookup } from 'node:dns/promises';
import type { WebConfig, WebFetchResult } from '@piwin/contracts';
import { createDefaultWebConfig } from '@piwin/contracts';
import { isPrivateOrLocalHostname, isPrivateOrLocalIpAddress } from './private-address.js';
import { resolveWebConfig } from './search-provider.js';

export type WebFetchOptions = {
  config?: Partial<WebConfig>;
  signal?: AbortSignal;
  /** Injected for tests */
  fetchImpl?: typeof fetch;
  /** Injected DNS resolver for tests */
  resolveHostAddresses?: (hostname: string) => Promise<string[]>;
  /** Max redirect hops (each revalidated). Default 5. */
  maxRedirects?: number;
};

const DEFAULT_MAX_REDIRECTS = 5;

/**
 * Fetch URL and extract readable text.
 * SSRF defenses: scheme/host policy, DNS private-IP reject, redirect revalidate, stream byte cap.
 */
export async function webFetch(
  url: string,
  options: WebFetchOptions = {},
): Promise<WebFetchResult> {
  const config = resolveWebConfig(options.config);
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const resolveHost =
    options.resolveHostAddresses ?? defaultResolveHostAddresses;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.fetchTimeoutMs);
  const signal = options.signal
    ? anySignal([options.signal, controller.signal])
    : controller.signal;

  try {
    let currentUrl = await assertSafeFetchUrl(
      url,
      config.fetchBlockedUrlPrefixes,
      resolveHost,
    );
    let response: Response | null = null;

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      response = await fetchImpl(currentUrl, {
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': 'piwin-web-fetch/0.1' },
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
        currentUrl = await assertSafeFetchUrl(
          nextUrl,
          config.fetchBlockedUrlPrefixes,
          resolveHost,
        );
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
    const hardCap = config.fetchMaxBytes * 4;
    const buffer = await readResponseBodyWithCap(response, hardCap, signal);
    const byteSize = buffer.byteLength;
    const rawText = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    const finalUrl = response.url || currentUrl;

    if (contentType.includes('text/html') || looksLikeHtml(rawText)) {
      const extracted = await extractReadableText(rawText, finalUrl);
      const truncated = extracted.text.length > config.fetchMaxBytes;
      return {
        url: validateFetchUrl(url, config.fetchBlockedUrlPrefixes),
        finalUrl,
        title: extracted.title,
        text: truncated ? extracted.text.slice(0, config.fetchMaxBytes) : extracted.text,
        contentType,
        byteSize,
        truncated,
      };
    }

    if (
      contentType.startsWith('text/') ||
      contentType.includes('json') ||
      contentType.includes('xml')
    ) {
      const truncated = rawText.length > config.fetchMaxBytes;
      return {
        url: validateFetchUrl(url, config.fetchBlockedUrlPrefixes),
        finalUrl,
        title: null,
        text: truncated ? rawText.slice(0, config.fetchMaxBytes) : rawText,
        contentType,
        byteSize,
        truncated,
      };
    }

    throw new Error(`unsupported content-type for fetch: ${contentType}`);
  } finally {
    clearTimeout(timeout);
  }
}

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
  resolveHostAddresses: (hostname: string) => Promise<string[]> = defaultResolveHostAddresses,
): Promise<string> {
  const validated = validateFetchUrl(url, blockedPrefixes);
  const hostname = new URL(validated).hostname;
  // Literal IPs already covered by validateFetchUrl; still resolve hostnames.
  if (!isPrivateOrLocalIpAddress(hostname)) {
    const addresses = await resolveHostAddresses(hostname);
    for (const address of addresses) {
      if (isPrivateOrLocalIpAddress(address)) {
        throw new Error(
          `SSRF blocked: ${hostname} resolves to private address ${address}`,
        );
      }
    }
  }
  return validated;
}

async function defaultResolveHostAddresses(hostname: string): Promise<string[]> {
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

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function readResponseBodyWithCap(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error(`response too large: ${buffer.byteLength} bytes (cap ${maxBytes})`);
    }
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) {
        throw new Error('fetch aborted');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('byte-cap');
        throw new Error(`response too large: >${maxBytes} bytes (stream cap)`);
      }
      chunks.push(value);
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
  return merged;
}

function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 256).toLowerCase();
  return head.includes('<html') || head.includes('<!doctype html') || head.includes('<body');
}

async function extractReadableText(
  html: string,
  baseUrl: string,
): Promise<{ title: string | null; text: string }> {
  try {
    const linkedom = await import('linkedom');
    const readability = await import('@mozilla/readability');
    const dom = linkedom.parseHTML(html);
    const document = dom.document;
    const base = document.createElement('base');
    base.setAttribute('href', baseUrl);
    document.head?.appendChild(base);
    const reader = new readability.Readability(document as never);
    const article = reader.parse();
    if (article?.textContent?.trim()) {
      return {
        title: article.title ?? null,
        text: article.textContent.trim(),
      };
    }
  } catch {
    // optional deps missing or parse failed
  }
  return {
    title: extractTitleFallback(html),
    text: stripHtml(html),
  };
}

function extractTitleFallback(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1]?.replace(/\s+/g, ' ').trim() || null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function anySignal(signals: AbortSignal[]): AbortSignal {
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

export function createDefaultFetchConfig(): WebConfig {
  return createDefaultWebConfig();
}
