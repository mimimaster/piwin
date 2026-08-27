import { describe, expect, it } from 'vitest';
import { resolveFileBrowseRoot } from './file-browse-root.js';

describe('resolveFileBrowseRoot', () => {
  it('prefers the opened project over the General workspace', () => {
    expect(
      resolveFileBrowseRoot({
        projectPath: '/Users/me/app',
        generalWorkspacePath: '/Users/me/.piwin/workspace',
      }),
    ).toBe('/Users/me/app');
  });

  it('falls back to the General workspace when Chat has no project', () => {
    expect(
      resolveFileBrowseRoot({
        projectPath: null,
        generalWorkspacePath: '/Users/me/.piwin/workspace',
      }),
    ).toBe('/Users/me/.piwin/workspace');
  });

  it('returns null when neither root is known', () => {
    expect(resolveFileBrowseRoot({ projectPath: '  ', generalWorkspacePath: '' })).toBeNull();
  });
});
