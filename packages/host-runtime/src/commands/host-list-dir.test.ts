import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleHostListDir } from './host-list-dir.js';

describe('handleHostListDir', () => {
  it('lists directories and files under the requested path', async () => {
    const rootDir = await mkdtemp(join(os.tmpdir(), 'piwin-host-list-dir-'));
    await mkdir(join(rootDir, 'alpha'));
    await mkdir(join(rootDir, 'beta'));
    await writeFile(join(rootDir, 'readme.txt'), 'skip me');
    await mkdir(join(rootDir, 'node_modules'));

    const response = await handleHostListDir({ type: 'host/list-dir', path: rootDir }, 'list-1');
    expect(response.success).toBe(true);
    if (!response.success) {
      throw new Error(response.error);
    }
    const data = response.data as {
      path: string;
      parentPath: string | null;
      homePath: string;
      entries: Array<{ name: string; kind: string; path: string }>;
    };
    expect(data.path).toBe(await realpath(rootDir));
    expect(data.parentPath).toBeTruthy();
    expect(data.homePath).toBe(os.homedir());
    expect(data.entries.map((entry) => entry.name)).toEqual([
      'alpha',
      'beta',
      'node_modules',
      'readme.txt',
    ]);
    expect(data.entries.find((entry) => entry.name === 'readme.txt')?.kind).toBe('file');
    expect(data.entries.find((entry) => entry.name === 'alpha')?.kind).toBe('directory');
  });

  it('defaults to the Host home directory when path is omitted', async () => {
    const response = await handleHostListDir({ type: 'host/list-dir' }, 'list-home');
    expect(response.success).toBe(true);
    if (!response.success) {
      throw new Error(response.error);
    }
    const data = response.data as { path: string; homePath: string };
    expect(data.path).toBe(await realpath(os.homedir()));
    expect(data.homePath).toBe(os.homedir());
  });

  it('rejects a file path', async () => {
    const rootDir = await mkdtemp(join(os.tmpdir(), 'piwin-host-list-dir-file-'));
    const filePath = join(rootDir, 'only.txt');
    await writeFile(filePath, 'nope');
    const response = await handleHostListDir({ type: 'host/list-dir', path: filePath }, 'list-file');
    expect(response.success).toBe(false);
  });

  it('includes dotfiles when includeHidden is set', async () => {
    const rootDir = await mkdtemp(join(os.tmpdir(), 'piwin-host-list-dir-hidden-'));
    await mkdir(join(rootDir, '.piwin'));
    await writeFile(join(rootDir, '.env'), 'x=1');
    await writeFile(join(rootDir, 'visible.txt'), 'ok');

    const hidden = await handleHostListDir(
      { type: 'host/list-dir', path: rootDir, includeHidden: true },
      'list-hidden',
    );
    expect(hidden.success).toBe(true);
    if (!hidden.success) throw new Error(hidden.error);
    const hiddenNames = (hidden.data as { entries: Array<{ name: string }> }).entries.map(
      (entry) => entry.name,
    );
    expect(hiddenNames).toContain('.piwin');
    expect(hiddenNames).toContain('.env');

    const visible = await handleHostListDir({ type: 'host/list-dir', path: rootDir }, 'list-visible');
    expect(visible.success).toBe(true);
    if (!visible.success) throw new Error(visible.error);
    const visibleNames = (visible.data as { entries: Array<{ name: string }> }).entries.map(
      (entry) => entry.name,
    );
    expect(visibleNames).not.toContain('.piwin');
    expect(visibleNames).toContain('visible.txt');
  });
});
