import { describe, expect, it } from 'vitest';
import {
  assertInsideMemoryRoot,
  projectKeyFromPath,
  sanitizePathSegment,
} from './paths.js';

describe('memory paths', () => {
  it('rejects path traversal', () => {
    expect(() => assertInsideMemoryRoot('/tmp/piwin/memory', '/tmp/piwin/memory/../secret')).toThrow(
      /escapes memory root/,
    );
    expect(() => assertInsideMemoryRoot('/tmp/piwin/memory', '/etc/passwd')).toThrow(
      /escapes memory root/,
    );
  });

  it('allows paths under root', () => {
    expect(assertInsideMemoryRoot('/tmp/piwin/memory', '/tmp/piwin/memory/global/a.md')).toContain(
      'global',
    );
  });

  it('rejects unsafe path segments', () => {
    expect(() => sanitizePathSegment('../x', 'id')).toThrow(/traversal/);
    expect(() => sanitizePathSegment('a/b', 'id')).toThrow(/traversal/);
  });

  it('builds stable project keys', () => {
    const keyA = projectKeyFromPath('/Users/me/proj');
    const keyB = projectKeyFromPath('/Users/me/proj');
    const keyC = projectKeyFromPath('/Users/me/other');
    expect(keyA).toBe(keyB);
    expect(keyA).not.toBe(keyC);
    expect(keyA).toMatch(/^[a-zA-Z0-9._-]+$/);
  });
});
