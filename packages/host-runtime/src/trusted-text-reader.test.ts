import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeTrustedRelativePath, readTrustedConfigText } from './trusted-text-reader.js';

describe('normalizeTrustedRelativePath', () => {
  it('accepts posix-relative config paths and rejects traversal or absolute input', () => {
    expect(normalizeTrustedRelativePath('config.json')).toBe('config.json');
    expect(normalizeTrustedRelativePath('sessions/s1/transcript.json')).toBe(
      'sessions/s1/transcript.json',
    );
    expect(normalizeTrustedRelativePath('../etc/passwd')).toBeNull();
    expect(normalizeTrustedRelativePath('/etc/passwd')).toBeNull();
    expect(normalizeTrustedRelativePath('C:/Windows/win.ini')).toBeNull();
    expect(normalizeTrustedRelativePath('')).toBeNull();
  });
});

describe('readTrustedConfigText', () => {
  it('reads a text file under the config root as read-only', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-trusted-text-'));
    await writeFile(join(rootDir, 'config.json'), '{"ok":true}\n', 'utf8');

    const result = await readTrustedConfigText({
      piwinRoot: rootDir,
      relativePath: 'config.json',
    });
    expect(result).toMatchObject({
      status: 'ready',
      relativePath: 'config.json',
      displayRef: '~/.piwin/config.json',
      content: '{"ok":true}\n',
      truncated: false,
      readOnly: true,
    });
  });

  it('rejects media vault relatives without reading bytes', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-trusted-media-'));
    await mkdir(join(rootDir, 'media', 'sess-1'), { recursive: true });
    await writeFile(join(rootDir, 'media', 'sess-1', 'a.png'), 'not-text');

    const result = await readTrustedConfigText({
      piwinRoot: rootDir,
      relativePath: 'media/sess-1/a.png',
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'media-vault' });
  });

  it('rejects traversal and missing files as typed unavailable states', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-trusted-deny-'));
    expect(
      await readTrustedConfigText({ piwinRoot: rootDir, relativePath: '../secret.txt' }),
    ).toMatchObject({ status: 'unavailable', reason: 'invalid-request' });
    expect(
      await readTrustedConfigText({ piwinRoot: rootDir, relativePath: 'missing.md' }),
    ).toMatchObject({ status: 'unavailable', reason: 'not-found' });
  });

  it('rejects a symlink that escapes the config root', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-trusted-link-'));
    const outsideRoot = await mkdtemp(join(tmpdir(), 'piwin-trusted-outside-'));
    const outsideFile = join(outsideRoot, 'secret.txt');
    await writeFile(outsideFile, 'classified\n', 'utf8');
    await symlink(outsideFile, join(rootDir, 'escape.txt'));

    const result = await readTrustedConfigText({
      piwinRoot: rootDir,
      relativePath: 'escape.txt',
    });
    expect(result).toMatchObject({ status: 'unavailable', reason: 'outside-config-root' });
  });

  it('flags binary files and truncates oversized text instead of forging a project read', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-trusted-bin-'));
    await writeFile(join(rootDir, 'blob.bin'), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(rootDir, 'notes.md'), 'abcdefghij', 'utf8');

    expect(
      await readTrustedConfigText({ piwinRoot: rootDir, relativePath: 'blob.bin' }),
    ).toMatchObject({ status: 'unavailable', reason: 'binary' });

    const truncated = await readTrustedConfigText({
      piwinRoot: rootDir,
      relativePath: 'notes.md',
      maxBytes: 1024,
    });
    expect(truncated.status).toBe('ready');
    if (truncated.status === 'ready') {
      expect(truncated.content).toBe('abcdefghij');
      expect(truncated.truncated).toBe(false);
    }

    const capped = await readTrustedConfigText({
      piwinRoot: rootDir,
      relativePath: 'notes.md',
      maxBytes: 4,
    });
    // maxBytes below 1024 is clamped; write a larger file to exercise truncation.
    await writeFile(join(rootDir, 'big.md'), 'x'.repeat(2048), 'utf8');
    const large = await readTrustedConfigText({
      piwinRoot: rootDir,
      relativePath: 'big.md',
      maxBytes: 1024,
    });
    expect(large).toMatchObject({
      status: 'ready',
      truncated: true,
      readOnly: true,
    });
    if (large.status === 'ready') {
      expect(large.content.length).toBe(1024);
    }
    void capped;
  });
});
