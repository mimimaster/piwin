import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  escapesRoot,
  isRegisteredProjectRoot,
  normalizeProjectRootPath,
  resolveInsideRoot,
  resolveInsideRootWithRealpath,
} from './path-traversal.js';

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

describe('isRegisteredProjectRoot', () => {
  it('matches a resolved registered path', () => {
    const registered = ['/Users/me/work/app'];
    expect(isRegisteredProjectRoot(registered, '/Users/me/work/app')).toBe(true);
    expect(isRegisteredProjectRoot(registered, '/Users/me/work/app/')).toBe(true);
  });

  it('rejects unregistered roots including system paths', () => {
    const registered = ['/Users/me/work/app'];
    expect(isRegisteredProjectRoot(registered, '/etc')).toBe(false);
    expect(isRegisteredProjectRoot(registered, '/tmp')).toBe(false);
    expect(isRegisteredProjectRoot(registered, '/Users/me/work/app-evil')).toBe(false);
  });

  it('normalizes trailing separators consistently', () => {
    expect(normalizeProjectRootPath('/tmp/proj/')).toBe(path.resolve('/tmp/proj/'));
  });
});

describe('resolveInsideRootWithRealpath', () => {
  it('resolves an existing file under the project root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'piwin-proj-real-'));
    const filePath = path.join(root, 'docs', 'readme.md');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '# hi\n', 'utf8');

    const result = await resolveInsideRootWithRealpath(root, 'docs/readme.md');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rootReal = await realpath(root);
      expect(result.rootReal).toBe(rootReal);
      expect(result.realAbsolute).toBe(await realpath(filePath));
      expect(result.absolute).toBe(path.join(rootReal, 'docs/readme.md'));
    }
  });

  it('allows an in-root symlink that stays inside the root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'piwin-proj-link-in-'));
    const targetFile = path.join(root, 'real.md');
    await writeFile(targetFile, 'inside\n', 'utf8');
    const linkPath = path.join(root, 'alias.md');
    await symlink(targetFile, linkPath);

    const result = await resolveInsideRootWithRealpath(root, 'alias.md');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.realAbsolute).toBe(await realpath(targetFile));
    }
  });

  it('rejects a symlink that realpaths outside the project root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'piwin-proj-link-out-'));
    const outsideDir = await mkdtemp(path.join(tmpdir(), 'piwin-proj-outside-'));
    const outsideFile = path.join(outsideDir, 'secret.txt');
    await writeFile(outsideFile, 'nope\n', 'utf8');
    const linkPath = path.join(root, 'escape.txt');
    await symlink(outsideFile, linkPath);

    const result = await resolveInsideRootWithRealpath(root, 'escape.txt');
    expect(result).toEqual({
      ok: false,
      reason: 'path escapes project root via symlink',
    });
  });

  it('rejects parent traversal before touching the filesystem', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'piwin-proj-trav-'));
    const result = await resolveInsideRootWithRealpath(root, '../outside.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('relativePath must not contain ..');
    }
  });
});
