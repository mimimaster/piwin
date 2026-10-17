import { describe, expect, it } from 'vitest';
import { resolveExternalCatalogProjectPath } from './grok-catalog-sync.js';

describe('resolveExternalCatalogProjectPath', () => {
  const roots = ['/Users/me/piwin', '/Users/me/notes'];

  it('maps a cwd onto the longest matching registered project', () => {
    expect(resolveExternalCatalogProjectPath('/Users/me/piwin/apps/desktop', roots)).toBe(
      '/Users/me/piwin',
    );
  });

  it('leaves unmatched Grok sessions in Conversations instead of No Repo', () => {
    expect(resolveExternalCatalogProjectPath('/tmp/vendor', roots)).toBe('');
    expect(resolveExternalCatalogProjectPath(undefined, roots)).toBe('');
  });
});
