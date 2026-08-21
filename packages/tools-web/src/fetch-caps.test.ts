import { describe, expect, it } from 'vitest';
import { createDefaultWebConfig } from '@piwin/contracts';
import {
  FETCH_PROGRESSIVE_BODY_MAX_BYTES,
  FETCH_PROGRESSIVE_PARSE_MAX_CHARS,
  resolveFetchCaps,
} from './fetch-caps.js';

function withoutProgressiveFields() {
  const legacy = { ...createDefaultWebConfig() };
  delete legacy.fetchReturnMaxChars;
  delete legacy.fetchStoreMaxChars;
  delete legacy.fetchCacheTtlMs;
  return legacy;
}

describe('resolveFetchCaps', () => {
  it('derives legacy multipliers from fetchMaxBytes when new fields are absent', () => {
    const caps = resolveFetchCaps({ ...withoutProgressiveFields(), fetchMaxBytes: 200 });
    expect(caps.storeMaxChars).toBe(200);
    expect(caps.returnMaxChars).toBe(200);
    expect(caps.bodyMaxBytes).toBe(800);
    expect(caps.parseMaxChars).toBe(400);
  });

  it('uses progressive body/parse caps when fetchStoreMaxChars is set', () => {
    const caps = resolveFetchCaps(createDefaultWebConfig());
    expect(caps.storeMaxChars).toBe(200_000);
    expect(caps.returnMaxChars).toBe(18_000);
    expect(caps.bodyMaxBytes).toBe(FETCH_PROGRESSIVE_BODY_MAX_BYTES);
    expect(caps.parseMaxChars).toBe(FETCH_PROGRESSIVE_PARSE_MAX_CHARS);
  });

  it('clamps return window to the store cap', () => {
    const caps = resolveFetchCaps({
      ...createDefaultWebConfig(),
      fetchStoreMaxChars: 1000,
      fetchReturnMaxChars: 5000,
    });
    expect(caps.returnMaxChars).toBe(1000);
  });
});
