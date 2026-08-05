#!/usr/bin/env node
/**
 * Bundle the piwin host for Tauri packaging (ADR 0017 / plan S1).
 *
 * Output layout:
 *   dist-host/host-serve.mjs
 *   dist-host/node_modules/   (externals only)
 *   dist-host/bundled-assets/ (S0 layout)
 */
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distHost = join(root, 'dist-host');
const outfile = join(distHost, 'host-serve.mjs');
const workerOutfile = join(distHost, 'agent-worker.mjs');

/** Keep on disk for assets / WASM / dynamic loads (ADR 0017). */
const EXTERNAL_DEPS = {
  '@earendil-works/pi-coding-agent': '0.80.10',
  '@silvia-odwyer/photon-node': '0.3.4',
  esbuild: '0.25.12',
  'playwright-core': '1.61.1',
};

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    env: options.env ?? process.env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} failed with status ${result.status}`);
  }
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyDir(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await cp(from, to, { recursive: true, force: true });
}

async function main() {
  console.log('[bundle-host] cleaning dist-host…');
  await rm(distHost, { recursive: true, force: true });
  await mkdir(distHost, { recursive: true });

  console.log('[bundle-host] esbuild entry apps/cli/src/index.ts…');
  const result = await build({
    entryPoints: [join(root, 'apps/cli/src/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    metafile: true,
    packages: 'bundle',
    external: Object.keys(EXTERNAL_DEPS),
    banner: {
      js: "import { createRequire as __piwinCreateRequire } from 'node:module'; const require = __piwinCreateRequire(import.meta.url);",
    },
    logLevel: 'info',
  });

  console.log('[bundle-host] esbuild internal agent worker…');
  await build({
    entryPoints: [join(root, 'packages/agent-host/src/rpc-sdk-worker-entry.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: workerOutfile,
    packages: 'bundle',
    external: Object.keys(EXTERNAL_DEPS),
    logLevel: 'info',
  });

  await writeFile(
    join(distHost, 'metafile.json'),
    JSON.stringify(result.metafile, null, 2),
    'utf8',
  );

  console.log('[bundle-host] installing external packages into dist-host…');
  await writeFile(
    join(distHost, 'package.json'),
    `${JSON.stringify(
      {
        name: 'piwin-host-bundle',
        type: 'module',
        private: true,
        dependencies: EXTERNAL_DEPS,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  // Isolated install (not the monorepo workspace) so node_modules is flat enough
  // for Node to resolve externals next to host-serve.mjs.
  run('npm', ['install', '--omit=dev', '--no-package-lock', '--no-fund', '--no-audit'], {
    cwd: distHost,
    env: { ...process.env, npm_config_ignore_scripts: 'false' },
  });

  console.log('[bundle-host] copying bundled assets (S0 layout)…');
  const assetsRoot = join(distHost, 'bundled-assets');
  await mkdir(assetsRoot, { recursive: true });
  const assetCopies = [
    ['packages/agent-host/bundled-prompts', 'agent-host/bundled-prompts'],
    ['packages/agent-host/bundled-extensions', 'agent-host/bundled-extensions'],
    ['packages/theme/bundled', 'theme/bundled'],
    ['packages/pet/bundled', 'pet/bundled'],
    ['skills', 'skills'],
  ];
  for (const [fromRel, toRel] of assetCopies) {
    const from = join(root, fromRel);
    if (!(await pathExists(from))) {
      console.warn(`[bundle-host] skip missing asset source: ${fromRel}`);
      continue;
    }
    await copyDir(from, join(assetsRoot, toRel));
  }

  console.log('[bundle-host] verify critical external paths…');
  const piPkg = join(distHost, 'node_modules/@earendil-works/pi-coding-agent/package.json');
  if (!(await pathExists(piPkg))) {
    throw new Error(
      'missing @earendil-works/pi-coding-agent in dist-host/node_modules — external install failed',
    );
  }

  const photonCandidates = [
    join(distHost, 'node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm'),
    join(distHost, 'node_modules/@silvia-odwyer/photon-node/dist/photon_rs_bg.wasm'),
    join(distHost, 'node_modules/@silvia-odwyer/photon-node/pkg/photon_rs_bg.wasm'),
  ];
  let photonOk = false;
  for (const candidate of photonCandidates) {
    if (await pathExists(candidate)) {
      photonOk = true;
      console.log(`[bundle-host] photon wasm: ${relative(distHost, candidate)}`);
      break;
    }
  }
  if (!photonOk) {
    console.warn(
      '[bundle-host] photon_rs_bg.wasm not found at expected paths — image paste may fail until externals adjusted',
    );
  }

  console.log(`[bundle-host] done → ${relative(root, distHost)}`);
}

main().catch((error) => {
  console.error('[bundle-host] failed:', error);
  process.exit(1);
});
