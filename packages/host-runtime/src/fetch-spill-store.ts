/** Session-disk spill of a full `web_fetch` extract for grep / read_file. */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { WebFetchSpillStore } from '@piwin/contracts';

export function createSessionFetchSpillStore(sessionDir: string): WebFetchSpillStore {
  return {
    async write(input) {
      const dir = join(sessionDir, 'fetch-spills');
      await mkdir(dir, { recursive: true });
      const name = `${createHash('sha256').update(input.url).digest('hex').slice(0, 16)}.txt`;
      const path = join(dir, name);
      await writeFile(path, input.text, 'utf8');
      return path;
    },
  };
}
