import type { WebConfig } from '@piwin/contracts';
import { DEFAULT_FETCH_CACHE_TTL_MS } from '@piwin/contracts';

export const FETCH_BODY_CAP_MULTIPLIER = 4;
export const FETCH_PARSE_CAP_MULTIPLIER = 2;
export const FETCH_PROGRESSIVE_BODY_MAX_BYTES = 1024 * 1024;
export const FETCH_PROGRESSIVE_PARSE_MAX_CHARS = 512 * 1024;
export const FETCH_THIN_TEXT_CHARS = 800;
export const FETCH_THIN_HTML_CHARS = 50_000;

export type ResolvedFetchCaps = {
  storeMaxChars: number;
  returnMaxChars: number;
  bodyMaxBytes: number;
  parseMaxChars: number;
  cacheTtlMs: number;
};

/**
 * Derive transport / store / return caps.
 * New fields absent → legacy `fetchMaxBytes` multipliers (body ×4, parse ×2, store = max bytes).
 * `fetchStoreMaxChars` present → progressive 1 MiB body / 512 KiB parse caps.
 */
export function resolveFetchCaps(config: WebConfig): ResolvedFetchCaps {
  const progressive = config.fetchStoreMaxChars !== undefined;
  const storeMaxChars = config.fetchStoreMaxChars ?? config.fetchMaxBytes;
  const requestedReturn = config.fetchReturnMaxChars ?? storeMaxChars;
  return {
    storeMaxChars,
    returnMaxChars: Math.min(Math.max(requestedReturn, 1), storeMaxChars),
    bodyMaxBytes: progressive
      ? FETCH_PROGRESSIVE_BODY_MAX_BYTES
      : config.fetchMaxBytes * FETCH_BODY_CAP_MULTIPLIER,
    parseMaxChars: progressive
      ? FETCH_PROGRESSIVE_PARSE_MAX_CHARS
      : config.fetchMaxBytes * FETCH_PARSE_CAP_MULTIPLIER,
    cacheTtlMs: config.fetchCacheTtlMs ?? DEFAULT_FETCH_CACHE_TTL_MS,
  };
}
