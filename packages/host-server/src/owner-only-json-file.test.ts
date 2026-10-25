import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OwnerOnlyJsonFile } from './owner-only-json-file.js';

const directories: string[] = [];

async function tempPath(name = 'state.json'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'piwin-json-'));
  directories.push(directory);
  return join(directory, 'nested', name);
}

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('OwnerOnlyJsonFile', () => {
  it('reads undefined for a missing file', async () => {
    expect(await new OwnerOnlyJsonFile(await tempPath(), 'test file').read()).toBeUndefined();
  });

  it('writes owner-only and leaves no temp files behind', async () => {
    const path = await tempPath();
    const file = new OwnerOnlyJsonFile(path, 'test file');
    await file.write({ a: 1 });
    expect(await file.read()).toEqual({ a: 1 });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(join(path, '..'))).toEqual(['state.json']);
  });

  it('serializes writes so the last save wins', async () => {
    const file = new OwnerOnlyJsonFile(await tempPath(), 'test file');
    await Promise.all(Array.from({ length: 10 }, (_, index) => file.write({ index })));
    expect(await file.read()).toEqual({ index: 9 });
  });

  it('names the file in parse errors', async () => {
    const path = await tempPath();
    const file = new OwnerOnlyJsonFile(path, 'test file');
    await file.write({});
    await writeFile(path, '{ broken');
    await expect(file.read()).rejects.toThrow('Unable to parse test file');
  });

  it('refuses an empty path', () => {
    expect(() => new OwnerOnlyJsonFile('  ', 'test file')).toThrow('test file path is required');
  });
});
