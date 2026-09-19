import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import {
  CODE_SEARCH_VIRTUAL_ROOT,
  checkSearchFolder,
  describePathFailure,
  hasUriScheme,
  isInsideRoot,
  resolveVirtualPath,
  toRepoRelativePath,
  toVirtualPath,
} from './codebase-paths.js';

const ROOT = resolve('/tmp/piwin-code-search-root');

describe('resolveVirtualPath', () => {
  it('maps the virtual root to the search root', () => {
    expect(resolveVirtualPath(ROOT, CODE_SEARCH_VIRTUAL_ROOT)).toEqual({
      ok: true,
      absolutePath: ROOT,
    });
    expect(resolveVirtualPath(ROOT, '/codebase/')).toEqual({ ok: true, absolutePath: ROOT });
  });

  it('maps nested paths under the root', () => {
    expect(resolveVirtualPath(ROOT, '/codebase/src/app.ts')).toEqual({
      ok: true,
      absolutePath: join(ROOT, 'src/app.ts'),
    });
  });

  it('normalizes backslashes so windows-style input still maps', () => {
    expect(resolveVirtualPath(ROOT, '/codebase\\src\\app.ts')).toEqual({
      ok: true,
      absolutePath: join(ROOT, 'src/app.ts'),
    });
  });

  it('rejects empty input', () => {
    expect(resolveVirtualPath(ROOT, '')).toEqual({ ok: false, failure: 'empty', value: '' });
    expect(resolveVirtualPath(ROOT, '   ')).toEqual({ ok: false, failure: 'empty', value: '   ' });
  });

  it('rejects paths outside the virtual root', () => {
    for (const candidate of ['/etc/passwd', '/workspace/src', 'src/app.ts', './src']) {
      const result = resolveVirtualPath(ROOT, candidate);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.failure).toBe('not-virtual');
      }
    }
  });

  it('rejects traversal above the search root', () => {
    const result = resolveVirtualPath(ROOT, '/codebase/../../etc/passwd');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toBe('outside-root');
    }
  });

  it('rejects a path that only looks like the root prefix', () => {
    const result = resolveVirtualPath(ROOT, '/codebases/src');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toBe('not-virtual');
    }
  });
});

describe('toVirtualPath', () => {
  it('round-trips a mapped absolute path', () => {
    const mapped = resolveVirtualPath(ROOT, '/codebase/src/app.ts');
    expect(mapped.ok).toBe(true);
    if (mapped.ok) {
      expect(toVirtualPath(ROOT, mapped.absolutePath)).toBe('/codebase/src/app.ts');
    }
    expect(toVirtualPath(ROOT, ROOT)).toBe(CODE_SEARCH_VIRTUAL_ROOT);
  });

  it('returns undefined outside the root', () => {
    expect(toVirtualPath(ROOT, '/tmp/other/file.ts')).toBeUndefined();
    expect(toVirtualPath(ROOT, '')).toBeUndefined();
  });
});

describe('toRepoRelativePath', () => {
  it('accepts the virtual form', () => {
    expect(toRepoRelativePath(ROOT, '/codebase/src/app.ts')).toBe('src/app.ts');
  });

  it('accepts a bare repo-relative path (model drops the prefix)', () => {
    expect(toRepoRelativePath(ROOT, 'src/app.ts')).toBe('src/app.ts');
    expect(toRepoRelativePath(ROOT, './src/app.ts')).toBe('src/app.ts');
  });

  it('rejects traversal and foreign absolute paths', () => {
    expect(toRepoRelativePath(ROOT, '/codebase/../../etc/passwd')).toBeUndefined();
    expect(toRepoRelativePath(ROOT, '../secrets.ts')).toBeUndefined();
    expect(toRepoRelativePath(ROOT, '/etc/passwd')).toBeUndefined();
    expect(toRepoRelativePath(ROOT, '')).toBeUndefined();
  });
});

describe('isInsideRoot', () => {
  it('accepts the root and descendants only', () => {
    expect(isInsideRoot(ROOT, ROOT)).toBe(true);
    expect(isInsideRoot(ROOT, join(ROOT, 'a/b'))).toBe(true);
    expect(isInsideRoot(ROOT, `${ROOT}-sibling`)).toBe(false);
    expect(isInsideRoot(ROOT, resolve(ROOT, '..'))).toBe(false);
  });
});

describe('hasUriScheme', () => {
  it('detects URI-looking values', () => {
    expect(hasUriScheme('file:///tmp/src')).toBe(true);
    expect(hasUriScheme('vscode://folder')).toBe(true);
    expect(hasUriScheme('https://example.com')).toBe(true);
    expect(hasUriScheme('/tmp/src')).toBe(false);
    expect(hasUriScheme('C:\\projects\\app')).toBe(false);
  });
});

describe('checkSearchFolder', () => {
  it('accepts an absolute folder path', () => {
    expect(checkSearchFolder('/tmp/project')).toEqual({
      ok: true,
      absolutePath: resolve('/tmp/project'),
    });
  });

  it('rejects blank input with the observed wording', () => {
    const result = checkSearchFolder('   ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toBe(
        'search_folder_absolute_uri cannot be empty; pass the absolute path of the folder to search in',
      );
    }
  });

  it('rejects URIs and relative paths', () => {
    const uri = checkSearchFolder('file:///tmp/project');
    expect(uri.ok).toBe(false);
    if (!uri.ok) {
      expect(uri.message).toContain('not a URI');
    }
    const relativePath = checkSearchFolder('project/src');
    expect(relativePath.ok).toBe(false);
    if (!relativePath.ok) {
      expect(relativePath.message).toContain('must be an absolute path');
    }
  });

  it('rejects non-string input', () => {
    expect(checkSearchFolder(undefined).ok).toBe(false);
    expect(checkSearchFolder(42).ok).toBe(false);
  });
});

describe('describePathFailure', () => {
  it('distinguishes empty, foreign and escaping paths', () => {
    expect(describePathFailure('file path', 'empty', '')).toBe('Error: file path cannot be empty');
    expect(describePathFailure('rg path', 'not-virtual', '/etc')).toBe(
      'Error: rg path must be under /codebase: /etc',
    );
    expect(describePathFailure('rg path', 'outside-root', '/codebase/../etc')).toBe(
      'Error: rg path must stay within /codebase: /codebase/../etc',
    );
  });
});
