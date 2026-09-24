import { describe, expect, it } from 'vitest';
import { isSafeRemoteCommand } from './host-server-support.js';

describe('isSafeRemoteCommand marketplace', () => {
  it('accepts read-only catalog and inventory reads', () => {
    expect(isSafeRemoteCommand({ type: 'marketplace/catalog-list', kinds: ['skill'] })).toBe(true);
    expect(isSafeRemoteCommand({ type: 'marketplace/catalog-get', entryId: 'mcp:time' })).toBe(true);
    expect(isSafeRemoteCommand({ type: 'marketplace/installed-list', sessionId: 's1' })).toBe(true);
  });

  it('rejects client paths and empty ids', () => {
    expect(
      isSafeRemoteCommand({ type: 'marketplace/installed-list', projectPath: '/Users/me/repo' }),
    ).toBe(false);
    expect(isSafeRemoteCommand({ type: 'marketplace/catalog-get', entryId: '  ' })).toBe(false);
  });
});
