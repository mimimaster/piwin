#!/usr/bin/env node
/**
 * Smoke: run bundled host-serve.mjs with --mock and expect a host/status JSONL line.
 * Requires `pnpm bundle:host` first.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hostServe = join(root, 'dist-host/host-serve.mjs');
const assetsRoot = join(root, 'dist-host/bundled-assets');

async function main() {
  try {
    await access(hostServe);
  } catch {
    console.error('dist-host/host-serve.mjs missing — run `pnpm bundle:host` first');
    process.exit(2);
  }

  const child = spawn(process.execPath, [hostServe, 'host', 'serve', '--mode', 'sdk', '--mock'], {
    cwd: join(root, 'dist-host'),
    env: {
      ...process.env,
      PIWIN_MOCK: '1',
      PIWIN_BUNDLED_ASSETS_ROOT: assetsRoot,
      NODE_PATH: join(root, 'dist-host/node_modules'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let sawStatus = false;
  const timeout = setTimeout(() => {
    console.error('timeout waiting for host/status');
    child.kill('SIGKILL');
    process.exit(1);
  }, 20_000);

  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    try {
      const msg = JSON.parse(line);
      // Accept host/status, an embedded status inside event/push frames, a
      // batched push frame, or any status-like payload.
      const containsStatus =
        msg.type === 'host/status' ||
        (msg.type === 'event' && msg.event?.type === 'host/status') ||
        (msg.type === 'push' && msg.push?.type === 'host/status') ||
        (msg.type === 'push/batch' &&
          Array.isArray(msg.items) &&
          msg.items.some((item) => item?.push?.type === 'host/status')) ||
        msg.ready === true;
      if (containsStatus || (typeof msg.ready === 'boolean' && msg.mock === true)) {
        sawStatus = true;
        console.log('[smoke-bundled-host] ok status-like:', line.slice(0, 200));
        clearTimeout(timeout);
        child.kill('SIGTERM');
      }
    } catch {
      // ignore non-JSON
    }
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
  });

  // Send a status request if the host is request/response oriented
  setTimeout(() => {
    try {
      child.stdin.write(
        `${JSON.stringify({
          type: 'command',
          requestId: 'smoke-1',
          command: { type: 'host/status' },
        })}\n`,
      );
    } catch {
      // ignore
    }
  }, 500);

  child.on('exit', (code) => {
    clearTimeout(timeout);
    if (sawStatus) {
      process.exit(0);
    }
    console.error(`host exited code=${code} without host/status`);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
