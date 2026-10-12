import { describe, expect, it } from 'vitest';
import { isSupportedNode } from './node-version-guard.js';

describe('isSupportedNode', () => {
  it('accepts 22.19 and newer, rejects older', () => {
    expect(isSupportedNode('v22.19.0')).toBe(true);
    expect(isSupportedNode('22.20.1')).toBe(true);
    expect(isSupportedNode('24.0.0')).toBe(true);
    expect(isSupportedNode('22.18.9')).toBe(false);
    expect(isSupportedNode('20.19.2')).toBe(false);
  });
});
