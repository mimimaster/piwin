// Read-only recovery of native Pi usage during an already running experiment.
// No requests are sent and no configuration, sessions, or source are changed.
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { readNativeSessions } from './native-sessions.mjs';
const output = resolve(import.meta.dirname, '../../../docs/research/scout-codemode-oauth-2026-10-11/native-recovery');
await mkdir(output, { recursive: true });
const deadline = Date.now() + 30 * 60_000;
while (Date.now() < deadline) {
  for (const name of (await readdir(tmpdir())).filter(name => name.startsWith('piwin-ab-host-'))) {
    const root = join(tmpdir(), name);
    try {
      const evidence = await readNativeSessions(root);
      if (evidence.sessions.length) await writeFile(join(output, `${name}.json`), JSON.stringify(evidence, null, 2));
    } catch (error) { if (!['ENOENT','ENOTDIR'].includes(error.code)) console.error(error.message); }
  }
  await new Promise(resolve => setTimeout(resolve, 250));
}
