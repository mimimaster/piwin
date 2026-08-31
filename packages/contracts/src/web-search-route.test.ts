import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEARCH_ROUTE_POLICY,
  inferSearchRoutePolicy,
  isSearchRoutePolicy,
} from './web.js';

describe('inferSearchRoutePolicy', () => {
  it('packing default with no sources is native-first', () => {
    expect(DEFAULT_SEARCH_ROUTE_POLICY).toBe('native-first');
    expect(inferSearchRoutePolicy(undefined, [])).toBe('native-first');
  });

  it('keeps an explicit policy even when sources are enabled', () => {
    expect(
      inferSearchRoutePolicy('native-only', [{ enabled: true }]),
    ).toBe('native-only');
  });

  it('does not rewrite enabled external sources when policy was omitted', () => {
    expect(
      inferSearchRoutePolicy(undefined, [{ enabled: true }]),
    ).toBe('external-first');
  });

  it('rejects unknown policy strings', () => {
    expect(isSearchRoutePolicy('parallel')).toBe(false);
    expect(inferSearchRoutePolicy('parallel', [])).toBe('native-first');
  });
});
