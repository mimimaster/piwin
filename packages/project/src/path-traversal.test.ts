import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { escapesRoot, resolveInsideRoot } from './path-traversal.js';

describe('escapesRoot', () => {
  it('returns false for the root itself', () => {
    expect(escapesRoot('/home/u/project', '/home/u/project')).toBe(false);
  });

  it('returns false for a path inside the root', () => {
    expect(escapesRoot('/home/u/project', '/home/u/project/src/index.ts')).toBe(false);
  });

  it('returns false for a nested directory inside the root', () => {
    expect(escapesRoot('/home/u/project', '/home/u/project/a/b/c')).toBe(false);
  });

  it('returns true for a sibling directory (.. escape)', () => {
    expect(escapesRoot('/home/u/project', '/home/u/other')).toBe(true);
  });

  it('returns true for a parent directory', () => {
    expect(escapesRoot('/home/u/project', '/home/u')).toBe(true);
  });

  it('returns true for an absolute path on a different root', () => {
    expect(escapesRoot('/home/u/project', '/etc/passwd')).toBe(true);
  });

  it('does not match sibling names that share a prefix (no naive prefix)', () => {
    // /home/u/project-evil must NOT be treated as inside /home/u/project
    expect(escapesRoot('/home/u/project', '/home/u/project-evil')).toBe(true);
  });

  it('normalizes .. segments in the candidate before comparing', () => {
    expect(escapesRoot('/home/u/project', '/home/u/project/sub/../../other')).toBe(true);
  });

  it('normalizes . segments in the candidate', () => {
    expect(escapesRoot('/home/u/project', '/home/u/project/./src')).toBe(false);
  });

  it('treats a candidate that resolves back to root as not escaping', () => {
    expect(escapesRoot('/home/u/project', '/home/u/project/sub/..')).toBe(false);
  });
});

describe('resolveInsideRoot', () => {
  const root = path.resolve('/home/u/project');

  it('resolves a simple relative path to an absolute path inside root', () => {
    const result = resolveInsideRoot(root, 'src/index.ts');
    expect(result).toEqual({ ok: true, absolute: path.join(root, 'src/index.ts') });
  });

  it('resolves empty input to the root itself', () => {
    const result = resolveInsideRoot(root, '');
    expect(result).toEqual({ ok: true, absolute: root });
  });

  it('strips a leading slash from the relative input', () => {
    const result = resolveInsideRoot(root, '/src/index.ts');
    expect(result).toEqual({ ok: true, absolute: path.join(root, 'src/index.ts') });
  });

  it('strips a trailing slash from the relative input', () => {
    const result = resolveInsideRoot(root, 'src/');
    expect(result).toEqual({ ok: true, absolute: path.join(root, 'src') });
  });

  it('normalizes backslashes to forward slashes', () => {
    const result = resolveInsideRoot(root, 'src\\index.ts');
    expect(result).toEqual({ ok: true, absolute: path.join(root, 'src/index.ts') });
  });

  it('rejects a relative path containing .. with a stable reason', () => {
    const result = resolveInsideRoot(root, '../outside');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('relativePath must not contain ..');
    }
  });

  it('rejects a relative path with an embedded .. segment', () => {
    const result = resolveInsideRoot(root, 'sub/../../outside');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('relativePath must not contain ..');
    }
  });

  it('re-anchors an absolute-looking input under root (leading slash stripped)', () => {
    // Matches project-commands.ts behavior: leading slashes are stripped so
    // `/etc/passwd` is treated as a relative `etc/passwd` under root, not as
    // an escape. Genuine absolute escapes are detected by escapesRoot.
    const result = resolveInsideRoot(root, '/etc/passwd');
    expect(result).toEqual({ ok: true, absolute: path.join(root, 'etc/passwd') });
  });

  it('accepts a deeply nested project-internal relative path', () => {
    const result = resolveInsideRoot(root, 'a/b/c/d/file.ts');
    expect(result).toEqual({
      ok: true,
      absolute: path.join(root, 'a/b/c/d/file.ts'),
    });
  });
});
