import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  canonicalizeFolderPath,
  canonicalizeFolderPathSync,
  folderKey,
  isPathConfined,
  isSafeRelativePath,
  getDocIndexPath,
} from './paths.js';

describe('paths', () => {
  describe('folderKey', () => {
    it('is 16 hex chars and stable', () => {
      const key = folderKey('/home/user/docs');
      expect(key).toMatch(/^[0-9a-f]{16}$/);
      expect(folderKey('/home/user/docs')).toBe(key);
      expect(folderKey('/home/user/other')).not.toBe(key);
    });
  });

  describe('getDocIndexPath', () => {
    it('places sqlite under doc-rag/<key>/', () => {
      const path = getDocIndexPath('/home/user/docs');
      expect(path).toMatch(/doc-rag\/[0-9a-f]{16}\/doc-index\.sqlite3$/);
    });
  });

  describe('canonicalizeFolderPathSync', () => {
    it('strips trailing separator', () => {
      expect(canonicalizeFolderPathSync('/foo/bar/')).toBe('/foo/bar');
      expect(canonicalizeFolderPathSync('/foo/bar')).toBe('/foo/bar');
    });
    it('handles undefined, null, and empty input safely', () => {
      expect(canonicalizeFolderPathSync(undefined)).toBe('');
      expect(canonicalizeFolderPathSync(null)).toBe('');
      expect(canonicalizeFolderPathSync('')).toBe('');
    });
  });

  describe('canonicalizeFolderPath', () => {
    let tmp: string;
    beforeEach: void 0;
    it('returns null for missing path', async () => {
      const result = await canonicalizeFolderPath(join(tmpdir(), 'does-not-exist-xyz'));
      expect(result).toBeNull();
    });
    it('returns null for undefined, null, or empty input without throwing', async () => {
      expect(await canonicalizeFolderPath(undefined)).toBeNull();
      expect(await canonicalizeFolderPath(null)).toBeNull();
      expect(await canonicalizeFolderPath('')).toBeNull();
      expect(await canonicalizeFolderPath('   ')).toBeNull();
    });
    it('resolves real path for existing folder', async () => {
      tmp = await mkdtemp(join(tmpdir(), 'piwin-paths-'));
      try {
        const result = await canonicalizeFolderPath(tmp);
        expect(result).toBeTruthy();
        expect(result).not.toMatch(/\/$/);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('isSafeRelativePath', () => {
    it('rejects absolute, backslash, .. segments, empty, too long', () => {
      expect(isSafeRelativePath('')).toBe(false);
      expect(isSafeRelativePath('/etc/passwd')).toBe(false);
      expect(isSafeRelativePath('\\etc\\passwd')).toBe(false);
      expect(isSafeRelativePath('../escape')).toBe(false);
      expect(isSafeRelativePath('foo/../bar')).toBe(false);
      expect(isSafeRelativePath('a'.repeat(2000))).toBe(false);
    });
    it('accepts normal relative paths', () => {
      expect(isSafeRelativePath('docs/intro.md')).toBe(true);
      expect(isSafeRelativePath('src/app.ts')).toBe(true);
      expect(isSafeRelativePath('a/b/c.txt')).toBe(true);
    });
  });

  describe('isPathConfined', () => {
    let root: string;
    let tmp: string;
    it('rejects paths outside the folder', async () => {
      tmp = await mkdtemp(join(tmpdir(), 'piwin-confine-'));
      root = join(tmp, 'root');
      await mkdir(root, { recursive: true });
      await writeFile(join(root, 'inside.txt'), 'x');
      try {
        expect(await isPathConfined(root, 'inside.txt')).toBe(true);
        expect(await isPathConfined(root, '../outside.txt')).toBe(false);
        expect(await isPathConfined(root, '/etc/passwd')).toBe(false);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    });
  });
});
