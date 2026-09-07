/**
 * External CDP attach helpers. Product path is Playwright `connectOverCDP`
 * to a user-configured loopback endpoint — not a second MCP browser.
 */
import type { Browser } from 'playwright-core';
import { chromium } from 'playwright-core';
import { BrowserUnavailableError } from './browser-errors.js';

export type BrowserOwnership = 'owned' | 'attached';

export type BrowserConnectOverCdp = (endpoint: string) => Promise<Browser>;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0:0:0:0:0:0:0:1']);

export function defaultConnectOverCdp(endpoint: string): Promise<Browser> {
  return chromium.connectOverCDP(endpoint);
}

/**
 * Only user-configured loopback endpoints. Reject LAN/public hosts so the
 * model cannot point the Host at an arbitrary CDP server.
 */
export function assertLoopbackCdpEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (trimmed === '') {
    throw new BrowserUnavailableError('cdp endpoint is empty');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new BrowserUnavailableError('cdp endpoint is not a valid URL');
  }
  if (
    parsed.protocol !== 'http:' &&
    parsed.protocol !== 'https:' &&
    parsed.protocol !== 'ws:' &&
    parsed.protocol !== 'wss:'
  ) {
    throw new BrowserUnavailableError('cdp endpoint must be http(s) or ws(s)');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new BrowserUnavailableError('cdp endpoint must be a loopback URL');
  }
  return trimmed;
}
