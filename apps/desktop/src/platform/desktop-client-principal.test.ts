import { describe, expect, it } from 'vitest';
import { readDesktopClientPrincipalId } from './desktop-client-principal.js';

describe('readDesktopClientPrincipalId', () => {
  it('returns a stable non-empty principal for this installation', () => {
    const first = readDesktopClientPrincipalId();
    const second = readDesktopClientPrincipalId();
    expect(first.length).toBeGreaterThan(0);
    expect(second).toBe(first);
  });
});
