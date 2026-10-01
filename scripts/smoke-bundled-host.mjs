#!/usr/bin/env node
/**
 * Smoke: run bundled host-serve.mjs with --mock and expect a host/status JSONL line.
 * Requires `pnpm bundle:host` first.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hostServe = join(root, 'dist-host/host-serve.mjs');
const assetsRoot = join(root, 'dist-host/bundled-assets');

/**
 * Vendor implementation that must never be bundled: the Host serves adapters
 * through the installable plugin protocol, so ACP/xAI code lives in the
 * adapter artifact only. Legacy *recognition* strings (the v1 recipe id) are
 * allowed; these are implementation markers.
 */
const FORBIDDEN_BUNDLE_MARKERS = [
  'AcpClient',
  'JsonRpcConnection',
  'GROK_DROPPED_NOTIFICATION_METHODS',
  'normalizeGrokMediaPresentation',
  'projectGrokTurn',
  'projectGrokWorkflow',
  'grok-session-handle',
  'createGrokProcessTransport',
  '_x.ai/',
];

async function assertNoVendorImplementation() {
  const source = await readFile(hostServe, 'utf8');
  const found = FORBIDDEN_BUNDLE_MARKERS.filter((marker) => source.includes(marker));
  if (found.length > 0) {
    console.error(`[smoke-bundled-host] vendor implementation in bundle: ${found.join(', ')}`);
    return false;
  }
  console.log('[smoke-bundled-host] ok bundle carries no vendor implementation');
  try {
    await access(join(assetsRoot, 'agents', 'grok'));
    console.error('[smoke-bundled-host] bundled Grok adapter must not ship with the Host');
    return false;
  } catch {
    // Absent is the required state.
  }
  return true;
}

async function main() {
  try {
    await access(hostServe);
  } catch {
    console.error('dist-host/host-serve.mjs missing — run `pnpm bundle:host` first');
    process.exit(2);
  }

  if (!(await assertNoVendorImplementation())) process.exit(1);

  const isolatedRoot = await mkdtemp(join(tmpdir(), 'piwin-bundled-host-'));
  // The launcher may itself be the bundled Desktop (PIWIN_DESKTOP_BUNDLED=1,
  // PIWIN_ROOT=~/.piwin). The smoke owns its isolation, so it must not inherit
  // either variable — otherwise it fights the running app for the real root.
  const env = { ...process.env, PIWIN_MOCK: '1', PIWIN_ROOT: isolatedRoot,
    PIWIN_BUNDLED_ASSETS_ROOT: assetsRoot, NODE_PATH: join(root, 'dist-host/node_modules') };
  delete env.PIWIN_DESKTOP_BUNDLED;
  const child = spawn(process.execPath, [hostServe, 'host', 'serve', '--mode', 'sdk', '--mock'], {
    cwd: join(root, 'dist-host'),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let sawStatusPush = false;
  let sawStatusResponse = false;
  const timeout = setTimeout(() => {
    console.error('timeout waiting for host/status');
    child.kill('SIGKILL');
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
        sawStatusPush = true;
        console.log('[smoke-bundled-host] ok status-like:', line.slice(0, 200));
      }
      if (msg.type === 'response' && msg.command === 'host/status' && msg.success === true) {
        sawStatusResponse = true;
        console.log('[smoke-bundled-host] ok host/status response:', line.slice(0, 200));
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

  // Host JSONL accepts a HostCommand directly, not a nested transport frame.
  setTimeout(() => {
    try {
      child.stdin.write(
        JSON.stringify({
          type: 'host/status',
          id: 'smoke-1',
        }) + '\n',
      );
    } catch {
      // ignore
    }
  }, 500);

  child.on('exit', (code) => {
    clearTimeout(timeout);
    void rm(isolatedRoot, { recursive: true, force: true })
      .then(() => {
        if (sawStatusPush && sawStatusResponse) {
          process.exit(0);
        }
        console.error(
          'host exited code=' + code +
            ' without a valid host/status exchange (push=' + sawStatusPush +
            ', response=' + sawStatusResponse + ')',
        );
        process.exit(1);
      })
      .catch((error) => {
        console.error('failed to clean bundled-host smoke root', error);
        process.exit(1);
      });
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
