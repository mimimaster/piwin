#!/usr/bin/env node
/**
 * Ensure Tauri `externalBin` + `resources` paths exist for cargo test / dev.
 * Real content is produced by `pnpm bundle:host` + `pnpm fetch:node-runtime`.
 */
import { mkdir, writeFile, access, copyFile, chmod } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distHost = join(root, 'dist-host');
const binaries = join(root, 'apps/desktop/src-tauri/binaries');

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(join(distHost, 'node_modules'), { recursive: true });
  await mkdir(join(distHost, 'bundled-assets'), { recursive: true });
  if (!(await exists(join(distHost, 'host-serve.mjs')))) {
    await writeFile(
      join(distHost, 'host-serve.mjs'),
      "// placeholder — run `pnpm bundle:host` before package:desktop\n",
      'utf8',
    );
  }
  if (!(await exists(join(distHost, 'package.json')))) {
    await writeFile(
      join(distHost, 'package.json'),
      `${JSON.stringify({ name: 'piwin-host-bundle', type: 'module', private: true }, null, 2)}\n`,
      'utf8',
    );
  }

  await mkdir(binaries, { recursive: true });
  // If no triple binary yet, fetch (needs network) or leave for package:desktop.
  const hasBinary = spawnSync('ls', [binaries], { encoding: 'utf8' })
    .stdout?.includes('piwin-host-');
  if (!hasBinary) {
    console.log('[ensure-packaging] no piwin-host binary — run pnpm fetch:node-runtime');
  }
  console.log('[ensure-packaging] ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
