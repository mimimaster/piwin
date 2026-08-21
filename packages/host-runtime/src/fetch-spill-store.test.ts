import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionFetchSpillStore } from './fetch-spill-store.js';

describe('createSessionFetchSpillStore', () => {
  it('writes the extract under the session fetch-spills directory', async () => {
    const sessionDir = await mkdtemp(join(tmpdir(), 'piwin-fetch-spill-'));
    const store = createSessionFetchSpillStore(sessionDir);
    const path = await store.write({
      url: 'https://example.com/long',
      text: 'full extracted page',
    });
    expect(path.startsWith(join(sessionDir, 'fetch-spills'))).toBe(true);
    expect(await readFile(path, 'utf8')).toBe('full extracted page');
    const again = await store.write({
      url: 'https://example.com/long',
      text: 'updated',
    });
    expect(again).toBe(path);
    expect(await readFile(path, 'utf8')).toBe('updated');
  });
});
