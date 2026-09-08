import { afterEach, describe, expect, it } from 'vitest';
import { resolveProjectEntryAbsolutePath } from './file-tree-path';
import {
  clearRemoteProjectRootsForTests,
  rememberRemoteProjectRoot,
} from './remote-session-hydrate';

describe('resolveProjectEntryAbsolutePath', () => {
  afterEach(() => {
    clearRemoteProjectRootsForTests();
  });

  it('joins posix project paths and normalizes separators', () => {
    expect(resolveProjectEntryAbsolutePath('/workspace/', 'src\\index.ts')).toBe(
      '/workspace/src/index.ts',
    );
  });

  it('preserves Windows separators for Windows project paths', () => {
    expect(resolveProjectEntryAbsolutePath('C:\\workspace\\', 'src/index.ts')).toBe(
      'C:\\workspace\\src\\index.ts',
    );
  });

  it('handles a filesystem root without adding a duplicate separator', () => {
    expect(resolveProjectEntryAbsolutePath('/', 'README.md')).toBe('/README.md');
  });

  it('uses Host pathStyle when the project key is an opaque remote id without a remembered root', () => {
    expect(
      resolveProjectEntryAbsolutePath('project-aaaaaaaaaaaaaaaaaaaaaaaa', 'src/index.ts', 'windows'),
    ).toBe('project-aaaaaaaaaaaaaaaaaaaaaaaa\\src\\index.ts');
    expect(
      resolveProjectEntryAbsolutePath('project-aaaaaaaaaaaaaaaaaaaaaaaa', 'src\\index.ts', 'posix'),
    ).toBe('project-aaaaaaaaaaaaaaaaaaaaaaaa/src/index.ts');
  });

  it('joins through the remembered Host root for an opaque remote project id', () => {
    rememberRemoteProjectRoot('project-aaaaaaaaaaaaaaaaaaaaaaaa', '/Users/me/piwin');
    expect(
      resolveProjectEntryAbsolutePath(
        'project-aaaaaaaaaaaaaaaaaaaaaaaa',
        'docs/design/proto-v3-mobile.html',
        'posix',
      ),
    ).toBe('/Users/me/piwin/docs/design/proto-v3-mobile.html');
  });
});
