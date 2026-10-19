import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, it } from 'vitest';

const execute = promisify(execFile);
describe('bundled OpenCode Zen', () => {
  it.each(['provider', 'zen-catalog', 'zen-request'])('passes the upstream offline %s checks', async (suite) => {
    // Run the preserved node:test suites against the shipped package and real
    // Host peers, including the native SSE parser and failed-catalog clearing.
    await execute(process.execPath, ['--test', `test/${suite}.check.mjs`], {
      cwd: fileURLToPath(new URL('../bundled-extensions/piwin-opencode-zen/', import.meta.url)),
    });
  });
});
