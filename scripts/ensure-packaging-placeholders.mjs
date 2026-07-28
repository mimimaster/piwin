#!/usr/bin/env node
/**
 * Ensure Tauri `externalBin` + `resources` paths exist for cargo / tauri dev.
 * - dist-host stubs: enough for tauri build-script path checks
 * - piwin-host-<triple>: auto-fetch Node LTS if missing (needs network once)
 *
 * Real host JS for packaged apps still comes from `pnpm bundle:host`.
 */
import { mkdir, writeFile, access, readdir } from 'node:fs/promises';
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

async function hasHostBinary() {
  if (!(await exists(binaries))) {
    return false;
  }
  const names = await readdir(binaries);
  return names.some((name) => name.startsWith('piwin-host-') || name === 'piwin-host' || name === 'piwin-host.exe');
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
  if (!(await hasHostBinary())) {
    console.log('[ensure-packaging] piwin-host binary missing — fetching Node LTS…');
    const result = spawnSync(process.execPath, [join(root, 'scripts/fetch-node-runtime.mjs')], {
      cwd: root,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      throw new Error(
        'failed to fetch piwin-host binary. Run: pnpm fetch:node-runtime (needs network once)',
      );
    }
  }

  console.log('[ensure-packaging] ok');
}

main().catch((error) => {
  console.error('[ensure-packaging]', error);
  process.exit(1);
});
