#!/usr/bin/env node
/**
 * Assemble a standalone Host directory (WebSocket listener + worker + Node).
 * Requires `pnpm bundle:host` and `pnpm fetch:node-runtime` first.
 *
 * Output: dist/piwin-host/
 */
import { chmod, cp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distHost = join(root, 'dist-host');
const outDir = join(root, 'dist', 'piwin-host');
const binariesDir = join(root, 'apps/desktop/src-tauri/binaries');

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function detectTriple() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-gnu';
  if (platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-gnu';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  throw new Error(`unsupported host triple: ${platform}/${arch}`);
}

async function copyIfExists(from, to) {
  if (!(await pathExists(from))) {
    throw new Error(`missing ${from} — run pnpm bundle:host first`);
  }
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true, force: true });
}

async function main() {
  const required = ['host-listen.mjs', 'agent-worker.mjs', 'package.json', 'node_modules'];
  for (const name of required) {
    if (!(await pathExists(join(distHost, name)))) {
      throw new Error(`missing dist-host/${name} — run pnpm bundle:host first`);
    }
  }

  console.log('[package-host] assembling dist/piwin-host…');
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await copyIfExists(join(distHost, 'host-listen.mjs'), join(outDir, 'host-listen.mjs'));
  await copyIfExists(join(distHost, 'agent-worker.mjs'), join(outDir, 'agent-worker.mjs'));
  await copyIfExists(join(distHost, 'package.json'), join(outDir, 'package.json'));
  await copyIfExists(join(distHost, 'node_modules'), join(outDir, 'node_modules'));
  if (await pathExists(join(distHost, 'bundled-assets'))) {
    await copyIfExists(join(distHost, 'bundled-assets'), join(outDir, 'bundled-assets'));
  }

  const triple = detectTriple();
  const nodeName = triple.includes('windows')
    ? `piwin-host-${triple}.exe`
    : `piwin-host-${triple}`;
  const nodeSrc = join(binariesDir, nodeName);
  const nodeDestName = triple.includes('windows') ? 'piwin-host.exe' : 'piwin-host';
  if (await pathExists(nodeSrc)) {
    await copyIfExists(nodeSrc, join(outDir, nodeDestName));
    if (!triple.includes('windows')) {
      await chmod(join(outDir, nodeDestName), 0o755);
    }
  } else {
    console.warn(`[package-host] ${nodeSrc} missing — run pnpm fetch:node-runtime; launcher will use system node`);
  }

  await writeFile(
    join(outDir, 'start-host.sh'),
    `#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
export NODE_PATH="$ROOT/node_modules"
export PIWIN_AGENT_WORKER_SCRIPT="$ROOT/agent-worker.mjs"
if [[ -d "$ROOT/bundled-assets" ]]; then
  export PIWIN_BUNDLED_ASSETS_ROOT="$ROOT/bundled-assets"
fi
NODE="$ROOT/piwin-host"
if [[ -x "$NODE" ]]; then
  exec "$NODE" "$ROOT/host-listen.mjs"
fi
exec node "$ROOT/host-listen.mjs"
`,
    { encoding: 'utf8', mode: 0o755 },
  );

  await writeFile(
    join(outDir, 'start-host.cmd'),
    `@echo off
set ROOT=%~dp0
set NODE_PATH=%ROOT%node_modules
set PIWIN_AGENT_WORKER_SCRIPT=%ROOT%agent-worker.mjs
if exist "%ROOT%bundled-assets" set PIWIN_BUNDLED_ASSETS_ROOT=%ROOT%bundled-assets
if exist "%ROOT%piwin-host.exe" (
  "%ROOT%piwin-host.exe" "%ROOT%host-listen.mjs"
) else (
  node "%ROOT%host-listen.mjs"
)
`,
    'utf8',
  );

  await writeFile(
    join(outDir, 'README.md'),
    `# piwin Host (standalone)

Start this Host **before** opening the thin Desktop shell. Do not also open the
all-in-one Desktop app on the same machine — they cannot share \`~/.piwin\`.

\`\`\`bash
./start-host.sh
# listens on ws://127.0.0.1:8787
\`\`\`

Bind / token:

- \`PIWIN_HOST_BIND\` (default 127.0.0.1)
- \`PIWIN_HOST_PORT\` (default 8787)
- \`PIWIN_HOST_TOKEN\` required when not on loopback

Then in the shell app, connect to \`ws://127.0.0.1:8787\`.
`,
    'utf8',
  );

  const names = await readdir(outDir);
  console.log(`[package-host] done → dist/piwin-host (${names.sort().join(', ')})`);
}

main().catch((error) => {
  console.error('[package-host] failed:', error);
  process.exit(1);
});
