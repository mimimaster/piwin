#!/usr/bin/env node
/**
 * Inspect a packaged all-in-one macOS app: sidecar Node, Host JS, LanceDB
 * native, and code signature. Does not launch the GUI.
 *
 * Tauri removes macos/*.app after writing the DMG. When the .app is gone,
 * attach the DMG read-only and inspect the nested bundle — that is the
 * artifact CI uploads.
 */
import { mkdirSync, rmSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  interpretCodesignDump,
  isPlaceholderHostServe,
  packagedAppLayout,
  resolvePackagedVerifyTarget,
  selectPackagedAppNames,
  selectPackagedDmgNames,
} from './lib/verify-desktop-package.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function requireDeveloperId() {
  return process.argv.includes('--require-developer-id') || process.env.PIWIN_REQUIRE_DEVELOPER_ID === '1';
}

function bundleRootFromEnv() {
  const cargoTarget = process.env.CARGO_TARGET_DIR?.trim();
  if (cargoTarget) return join(cargoTarget, 'release', 'bundle');
  return join(root, 'apps/desktop/src-tauri/target/release/bundle');
}

async function readDirNames(dir) {
  try {
    return await readdir(dir);
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    if (code === 'ENOENT') return [];
    throw new Error(`cannot read bundle directory ${dir}${code ? ` (${code})` : ''}`);
  }
}

async function assertFile(path, label) {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new Error(`missing ${label}: ${path}`);
  }
  if (!info.isFile()) {
    throw new Error(`${label} is not a file: ${path}`);
  }
  return info;
}

async function assertDirectory(path, label) {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new Error(`missing ${label}: ${path}`);
  }
  if (!info.isDirectory()) {
    throw new Error(`${label} is not a directory: ${path}`);
  }
  return info;
}

function inspectCodesign(appPath) {
  const result = spawnSync('codesign', ['-d', '--verbose=2', appPath], { encoding: 'utf8' });
  const dump = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.status !== 0 && !dump.includes('Executable=')) {
    throw new Error(`codesign -d failed for ${appPath}: ${dump.trim() || result.status}`);
  }
  return interpretCodesignDump(dump);
}

function verifyDeveloperIdSignature(appPath) {
  const result = spawnSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(
      `codesign --verify failed for ${appPath}:\n${result.stderr || result.stdout || result.status}`,
    );
  }
}

function attachDmg(dmgPath, mountPoint) {
  rmSync(mountPoint, { recursive: true, force: true });
  mkdirSync(mountPoint, { recursive: true });
  const result = spawnSync(
    'hdiutil',
    ['attach', dmgPath, '-nobrowse', '-readonly', '-mountpoint', mountPoint],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    rmSync(mountPoint, { recursive: true, force: true });
    throw new Error(
      `hdiutil attach failed for ${dmgPath}: ${(result.stderr || result.stdout || result.status).toString().trim()}`,
    );
  }
}

function detachMount(mountPoint) {
  spawnSync('hdiutil', ['detach', mountPoint, '-force'], { encoding: 'utf8' });
  rmSync(mountPoint, { recursive: true, force: true });
}

async function inspectApp(appPath, dmgPath) {
  const layout = packagedAppLayout(appPath);

  await assertDirectory(appPath, 'app bundle');
  const macosBinary = await assertFile(layout.macosBinary, 'desktop binary');
  const sidecar = await assertFile(layout.sidecarNode, 'bundled Node sidecar');
  const hostServe = await assertFile(layout.hostServe, 'host-serve.mjs');
  await assertFile(layout.agentWorker, 'agent-worker.mjs');
  await assertFile(layout.hostPackageJson, 'host package.json');
  await assertDirectory(layout.bundledAssets, 'bundled-assets');
  await assertFile(layout.lancedbNative, 'LanceDB darwin-arm64 native');
  const dmg = await assertFile(dmgPath, 'dmg');

  if (isPlaceholderHostServe(hostServe.size)) {
    throw new Error(
      `host-serve.mjs is a packaging placeholder (${hostServe.size} bytes). Run pnpm bundle:host before tauri build.`,
    );
  }

  const signature = inspectCodesign(appPath);
  console.log(`[verify-desktop-package] app ${appPath}`);
  console.log(`[verify-desktop-package] dmg ${dmgPath} (${dmg.size} bytes)`);
  console.log(`[verify-desktop-package] desktop binary ${macosBinary.size} bytes`);
  console.log(`[verify-desktop-package] sidecar ${sidecar.size} bytes`);
  console.log(`[verify-desktop-package] host-serve.mjs ${hostServe.size} bytes`);
  console.log(
    `[verify-desktop-package] signature developerId=${signature.developerId} adhoc=${signature.adhoc} identity=${signature.identity ?? '(none)'} team=${signature.teamId ?? '(none)'}`,
  );

  if (signature.developerId) {
    verifyDeveloperIdSignature(appPath);
    console.log('[verify-desktop-package] codesign --verify --deep --strict ok');
  } else if (requireDeveloperId()) {
    throw new Error(
      'Developer ID signature required (PIWIN_REQUIRE_DEVELOPER_ID=1) but the .app is ad-hoc / unsigned. Import APPLE_CERTIFICATE or run on a Mac whose keychain has Developer ID Application.',
    );
  } else {
    console.warn(
      '[verify-desktop-package] WARNING: ad-hoc or unsigned build. macOS will treat each build as a new app and re-prompt Desktop / external-volume access.',
    );
  }
}

async function main() {
  const bundleRoot = bundleRootFromEnv();
  const macosDir = join(bundleRoot, 'macos');
  const dmgDir = join(bundleRoot, 'dmg');
  const appNames = selectPackagedAppNames(await readDirNames(macosDir));
  const dmgNames = selectPackagedDmgNames(await readDirNames(dmgDir));
  const target = resolvePackagedVerifyTarget(appNames, dmgNames);

  if (target.kind === 'missing-dmg') {
    throw new Error(`expected a .dmg in ${dmgDir}`);
  }
  if (target.kind === 'ambiguous-app') {
    throw new Error(`expected one .app in ${macosDir}, found: ${target.appNames.join(', ')}`);
  }

  const dmgPath = join(dmgDir, target.dmgName);
  if (target.kind === 'app') {
    await inspectApp(join(macosDir, target.appName), dmgPath);
    console.log('[verify-desktop-package] ok');
    return;
  }

  const mountPoint = join(tmpdir(), `piwin-verify-dmg-${process.pid}`);
  console.log(`[verify-desktop-package] .app missing after DMG bundle; attaching ${dmgPath}`);
  attachDmg(dmgPath, mountPoint);
  try {
    const mountedApps = selectPackagedAppNames(await readDirNames(mountPoint));
    if (mountedApps.length !== 1) {
      throw new Error(
        `expected one .app in ${dmgPath}, found: ${mountedApps.join(', ') || '(none)'}`,
      );
    }
    const mountedApp = mountedApps[0];
    if (!mountedApp) {
      throw new Error(`expected one .app in ${dmgPath}, found: (none)`);
    }
    await inspectApp(join(mountPoint, mountedApp), dmgPath);
    console.log('[verify-desktop-package] ok');
  } finally {
    detachMount(mountPoint);
  }
}

main().catch((error) => {
  console.error('[verify-desktop-package] failed:', error);
  process.exit(1);
});
