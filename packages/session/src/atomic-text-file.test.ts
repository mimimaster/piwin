import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeTextFileAtomic } from './atomic-text-file.js';

describe('writeTextFileAtomic', () => {
  it('creates a new file with the provided contents', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-atomic-create-'));
    const filePath = join(directory, 'document.json');

    await writeTextFileAtomic(filePath, '{"ok":true}\n');

    expect(await readFile(filePath, 'utf8')).toBe('{"ok":true}\n');
  });

  it('replaces an existing file without leaving a partial final document', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'piwin-atomic-replace-'));
    const filePath = join(directory, 'document.json');
    await writeFile(filePath, '{"version":1,"sessions":[{"id":"keep-me"}]}\n', 'utf8');

    await writeTextFileAtomic(filePath, '{"version":2,"sessions":[{"id":"replaced"}]}\n');

    expect(await readFile(filePath, 'utf8')).toBe(
      '{"version":2,"sessions":[{"id":"replaced"}]}\n',
    );
  });
});
