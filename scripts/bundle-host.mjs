#!/usr/bin/env node
/**
 * Bundle the piwin host for Tauri packaging (ADR 0017 / plan S1).
 *
 * Output layout:
 *   dist-host/host-serve.mjs + cli-chunk-*.mjs
 *   dist-host/node_modules/   (externals only)
 *   dist-host/bundled-assets/ (S0 layout)
 */
import { build } from 'esbuild';
import { bundleCliEntry } from './lib/bundle-cli-entry.mjs';
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  formatPruneReport,
  pruneHostNodeModules,
} from './lib/prune-host-node-modules.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distHost = join(root, 'dist-host');
const workerOutfile = join(distHost, 'agent-worker.mjs');

/** Keep on disk for assets / WASM / native / dynamic loads (ADR 0017). */
const EXTERNAL_DEPS = {
  '@earendil-works/pi-coding-agent': '0.84.2',
  '@earendil-works/pi-codemode': '1.1.0',
  '@silvia-odwyer/photon-node': '0.3.4',
  '@medv/finder': '4.0.2',
  esbuild: '0.25.12',
  'playwright-core': '1.61.1',
  // Keep native PTY bindings and spawn-helper on disk. The pinned beta fixes
  // missing executable permissions in 1.1.0's macOS prebuilds (upstream #919).
  'node-pty': '1.2.0-beta.12',
  // Native libvips bindings cannot be inlined by esbuild.
  sharp: '0.35.4',
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


function formatMb(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function dirSize(dir) {
  if (!(await pathExists(dir))) return 0;
  let total = 0;
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      try {
        if (entry.isDirectory()) await walk(full);
        else total += (await lstat(full)).size;
      } catch {
        // ignore racing paths
      }
    }
  }
  await walk(dir);
  return total;
}

async function main() {
  console.log('[bundle-host] cleaning dist-host…');
  await rm(distHost, { recursive: true, force: true });
  await mkdir(distHost, { recursive: true });

  console.log('[bundle-host] esbuild entry apps/cli/src/index.ts…');
  const result = await bundleCliEntry({ root, outdir: distHost, external: Object.keys(EXTERNAL_DEPS) });

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

  console.log('[bundle-host] esbuild standalone Host Server (host-listen.mjs)…');
  await build({
    entryPoints: [join(root, 'apps/host/src/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: join(distHost, 'host-listen.mjs'),
    packages: 'bundle',
    external: Object.keys(EXTERNAL_DEPS),
    banner: {
      js: "import { createRequire as __piwinCreateRequire } from 'node:module'; const require = __piwinCreateRequire(import.meta.url);",
    },
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
    ['packages/host-runtime/bundled/model-catalog', 'model-catalog'],
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
  for (const dependency of Object.keys(EXTERNAL_DEPS)) {
    const packagePath = join(distHost, 'node_modules', dependency, 'package.json');
    if (!(await pathExists(packagePath))) {
      throw new Error(
        'missing ' + dependency + ' in dist-host/node_modules — external install failed',
      );
    }
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

  const nodeModulesDir = join(distHost, 'node_modules');
  const beforePrune = await dirSize(nodeModulesDir);
  console.log(
    `[bundle-host] pruning dist-host/node_modules (before ${formatMb(beforePrune)})…`,
  );
  const pruneReport = await pruneHostNodeModules(nodeModulesDir);
  console.log(formatPruneReport(pruneReport));
  const afterPrune = await dirSize(nodeModulesDir);
  console.log(
    `[bundle-host] node_modules after prune ${formatMb(afterPrune)} (saved ${formatMb(Math.max(0, beforePrune - afterPrune))})`,
  );

  // RPC worker must sit beside host-serve.mjs (import.meta.url resolution).
  if (!(await pathExists(workerOutfile))) {
    throw new Error('missing dist-host/agent-worker.mjs after esbuild — bundle incomplete');
  }
  if (!(await pathExists(join(distHost, 'host-listen.mjs')))) {
    throw new Error('missing dist-host/host-listen.mjs after esbuild — bundle incomplete');
  }

  await verifyPinnedExternalVersions(distHost);
  await smokeCodemodeSandbox(distHost);
  await smokeNativeExternals(distHost);

  console.log(`[bundle-host] done → ${relative(root, distHost)}`);
}

async function verifyPinnedExternalVersions(distHost) {
  const expected = {
    '@earendil-works/pi-coding-agent': '0.84.2',
    '@earendil-works/pi-ai': '0.84.2',
    '@earendil-works/pi-codemode': '1.1.0',
  };
  for (const [name, version] of Object.entries(expected)) {
    const packagePath = join(distHost, 'node_modules', name, 'package.json');
    if (name === '@earendil-works/pi-ai' && !(await pathExists(packagePath))) {
      continue;
    }
    const parsed = JSON.parse(await readFile(packagePath, 'utf8'));
    if (parsed.version !== version) {
      throw new Error(`${name} bundle version ${parsed.version} !== ${version}`);
    }
  }
}

async function smokeCodemodeSandbox(distHost) {
  const worker = join(
    distHost,
    'node_modules/@earendil-works/pi-codemode/dist/runtime/worker.js',
  );
  const wasmCandidates = [
    join(distHost, 'node_modules/quickjs-wasi/quickjs.wasm'),
    join(
      distHost,
      'node_modules/@earendil-works/pi-codemode/node_modules/quickjs-wasi/quickjs.wasm',
    ),
  ];
  if (!(await pathExists(worker))) {
    throw new Error('missing pi-codemode worker after prune');
  }
  let wasmPath;
  for (const candidate of wasmCandidates) {
    if (await pathExists(candidate)) {
      wasmPath = candidate;
      break;
    }
  }
  if (!wasmPath) {
    throw new Error('missing quickjs-wasi/quickjs.wasm after prune');
  }
  console.log(`[bundle-host] codemode worker: ${relative(distHost, worker)}`);
  console.log(`[bundle-host] codemode wasm: ${relative(distHost, wasmPath)}`);
  await runSmokeScript(distHost, 'codemode-smoke.mjs', [
      "import { CodemodeSandbox, loadQuickJSWasm } from '@earendil-works/pi-codemode';",
      "import { pathToFileURL } from 'node:url';",
      'const sandbox = new CodemodeSandbox({',
      '  timeoutMs: 10000,',
      '  memoryLimitBytes: 32 * 1024 * 1024,',
      `  wasm: loadQuickJSWasm(${JSON.stringify(wasmPath)}),`,
      `  workerUrl: pathToFileURL(${JSON.stringify(worker)}),`,
      "  tools: [{ name: 'echo', async execute(args) { return args; } }],",
      '});',
      'try {',
      "  const result = await sandbox.execute('return await tools.echo({ n: 1 })');",
      '  if (!result.ok || result.value?.n !== 1) {',
      '    console.error(result);',
      '    process.exit(1);',
      '  }',
      "  console.log('[bundle-host] codemode sandbox smoke ok');",
      '} finally {',
      '  await sandbox.close();',
      '}',
  ]);
}

/**
 * Loads each native external the prune pass trims around (node-pty-foreign,
 * sharp-wasm-fallback), so an over-eager prune rule fails the bundle here
 * instead of at a user's first terminal or image paste.
 */
async function smokeNativeExternals(distHost) {
  await runSmokeScript(distHost, 'native-externals-smoke.mjs', [
    "import sharp from 'sharp';",
    "import 'node-pty';",
    'const png = await sharp({',
    "  create: { width: 2, height: 2, channels: 3, background: '#ffffff' },",
    '}).png().toBuffer();',
    "if (png.length === 0) throw new Error('sharp produced an empty image');",
    "console.log('[bundle-host] native externals smoke ok (sharp, node-pty)');",
  ]);
}

/** Runs a throwaway ESM script from dist-host so it resolves the bundle's own node_modules. */
async function runSmokeScript(distHost, fileName, lines) {
  const scriptPath = join(distHost, fileName);
  await writeFile(scriptPath, `${lines.join('\n')}\n`, 'utf8');
  try {
    run('node', [scriptPath], { cwd: distHost });
  } finally {
    await rm(scriptPath, { force: true });
  }
}

main().catch((error) => {
  console.error('[bundle-host] failed:', error);
  process.exit(1);
});
