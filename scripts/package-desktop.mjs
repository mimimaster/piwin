#!/usr/bin/env node
/**
 * Desktop package pipeline with one signing identity for every step:
 * host Mach-O natives (sign-host-macho) and the .app / sidecar (tauri build)
 * both read APPLE_SIGNING_IDENTITY. When it is unset on macOS, a single
 * Developer ID Application identity in the keychain is used.
 *
 * On macOS this also detaches leftover rw.*.dmg mounts, prefers a roomy
 * TMPDIR when the system disk is tight, and if tauri's codesign / bundle_dmg
 * step fails after the .app exists, re-signs and writes the DMG with hdiutil.
 */
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalDesktopDmgFileName,
  leftoverPiwinDmgImagePaths,
  leftoverRwDmgFileNames,
  newestAppPath,
  parseDfAvailBytes,
  pickPackageTempDir,
} from './lib/package-desktop-local.mjs';
import { selectPackagedAppNames, selectPackagedDmgNames } from './lib/verify-desktop-package.mjs';
import { resolveSigningIdentity } from './lib/signing-identity.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entitlementsPath = join(root, 'apps/desktop/src-tauri/Entitlements.plist');
const workspaceBundle = join(root, 'apps/desktop/src-tauri/target/release/bundle');
const extraTmpdir = existsSync('/Volumes/BigDisk') ? '/Volumes/BigDisk/tmp' : undefined;

function runPnpm(args, env) {
  return spawnSync('pnpm', args, { cwd: root, env, stdio: 'inherit' });
}

function desktopVersion() {
  const conf = JSON.parse(readFileSync(join(root, 'apps/desktop/src-tauri/tauri.conf.json'), 'utf8'));
  return typeof conf.version === 'string' ? conf.version : '0.0.0';
}

function macosBundleDirs(env) {
  const dirs = [];
  const cargoTarget = env.CARGO_TARGET_DIR?.trim();
  if (cargoTarget) dirs.push(join(cargoTarget, 'release', 'bundle', 'macos'));
  dirs.push(join(workspaceBundle, 'macos'));
  return [...new Set(dirs)];
}

function dmgBundleDirs(env) {
  return macosBundleDirs(env).map((macosDir) => join(dirname(macosDir), 'dmg'));
}

function listDir(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function detachLeftoverDmgs() {
  const info = spawnSync('hdiutil', ['info'], { encoding: 'utf8' });
  const imagePaths = leftoverPiwinDmgImagePaths(`${info.stdout ?? ''}\n${info.stderr ?? ''}`);
  for (const imagePath of imagePaths) {
    console.log(`[package-desktop] detaching leftover ${imagePath}`);
    spawnSync('hdiutil', ['detach', imagePath, '-force'], { stdio: 'inherit' });
  }
}

function removeLeftoverRwFiles(env) {
  for (const macosDir of macosBundleDirs(env)) {
    for (const name of leftoverRwDmgFileNames(listDir(macosDir))) {
      const filePath = join(macosDir, name);
      console.log(`[package-desktop] removing leftover ${filePath}`);
      try {
        unlinkSync(filePath);
      } catch {
        // Already gone after detach.
      }
    }
  }
}

function applyPackageTempDir(env) {
  const df = spawnSync('df', ['-kP', '/'], { encoding: 'utf8' });
  const systemAvailBytes = parseDfAvailBytes(df.stdout ?? '');
  const chosen = pickPackageTempDir({
    envTmpdir: env.PIWIN_PACKAGE_TMPDIR,
    platform: process.platform,
    systemAvailBytes,
    extraTmpdir,
    osTmpdir: tmpdir(),
  });
  mkdirSync(chosen, { recursive: true });
  env.TMPDIR = chosen;
  env.TMP = chosen;
  console.log(`[package-desktop] TMPDIR=${chosen}`);
}

function resolveIdentity(env) {
  const resolved = resolveSigningIdentity({
    envIdentity: env.APPLE_SIGNING_IDENTITY,
    findIdentityOutput: () =>
      spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
        .stdout ?? '',
  });
  if (resolved.kind === 'ambiguous') {
    console.error(
      `[package-desktop] several Developer ID identities; set APPLE_SIGNING_IDENTITY to one of:\n  ${resolved.candidates.join('\n  ')}`,
    );
    process.exit(1);
  }
  if (resolved.kind === 'none') {
    console.warn(
      '[package-desktop] WARNING: no Developer ID identity; building ad-hoc. macOS will treat every build as a new app and re-prompt for Desktop / external-volume access.',
    );
    return undefined;
  }
  env.APPLE_SIGNING_IDENTITY = resolved.identity;
  console.log(`[package-desktop] signing as ${resolved.identity} (from ${resolved.kind})`);
  return resolved.identity;
}

function findBuiltApp(env) {
  /** @type {{ path: string, mtimeMs: number }[]} */
  const apps = [];
  for (const macosDir of macosBundleDirs(env)) {
    for (const name of selectPackagedAppNames(listDir(macosDir))) {
      const appPath = join(macosDir, name);
      try {
        apps.push({ path: appPath, mtimeMs: statSync(appPath).mtimeMs });
      } catch {
        // Skip vanished paths.
      }
    }
  }
  return newestAppPath(apps);
}

function codesign(args) {
  const result = spawnSync('codesign', args, { stdio: 'inherit' });
  return result.status === 0;
}

function signAppBundle(appPath, identity) {
  const host = join(appPath, 'Contents/MacOS/piwin-host');
  const desktop = join(appPath, 'Contents/MacOS/piwin-desktop');
  const timestamped = ['--force', '--options', 'runtime', '--timestamp', '--sign', identity];
  if (existsSync(host) && !codesign([...timestamped, host])) return false;
  if (existsSync(desktop) && !codesign([...timestamped, '--entitlements', entitlementsPath, desktop])) {
    return false;
  }
  return codesign([...timestamped, '--entitlements', entitlementsPath, appPath]);
}

function recoverDmg(env, identity) {
  const appPath = findBuiltApp(env);
  if (!appPath) {
    console.error('[package-desktop] recover skipped: no .app after tauri failure');
    return false;
  }
  console.log(`[package-desktop] recovering from ${appPath}`);
  if (identity && !signAppBundle(appPath, identity)) {
    console.error('[package-desktop] recover codesign failed');
    return false;
  }

  const staging = join(env.TMPDIR || tmpdir(), 'piwin-dmg-staging');
  const stagingSrc = join(staging, 'src');
  const stagedApp = join(stagingSrc, 'piwin.app');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(stagingSrc, { recursive: true });
  cpSync(appPath, stagedApp, { recursive: true });

  const dmgName = canonicalDesktopDmgFileName(desktopVersion(), process.arch);
  const primaryDmgDir = dmgBundleDirs(env)[0] ?? join(workspaceBundle, 'dmg');
  mkdirSync(primaryDmgDir, { recursive: true });
  const dmgPath = join(primaryDmgDir, dmgName);
  const create = spawnSync(
    'hdiutil',
    ['create', '-volname', 'piwin', '-srcfolder', stagingSrc, '-ov', '-format', 'UDZO', dmgPath],
    { stdio: 'inherit' },
  );
  if (create.status !== 0) {
    console.error('[package-desktop] recover hdiutil create failed');
    return false;
  }
  if (identity) {
    codesign(['--force', '--sign', identity, dmgPath]);
  }

  const workspaceDmg = join(workspaceBundle, 'dmg', dmgName);
  if (workspaceDmg !== dmgPath) {
    mkdirSync(dirname(workspaceDmg), { recursive: true });
    copyFileSync(dmgPath, workspaceDmg);
  }
  rmSync(staging, { recursive: true, force: true });
  console.log(`[package-desktop] recovered DMG ${dmgPath}`);
  return true;
}

function printArtifacts(env) {
  const dmgName = canonicalDesktopDmgFileName(desktopVersion(), process.arch);
  const dmgCandidates = dmgBundleDirs(env).map((dir) => join(dir, dmgName));
  dmgCandidates.push(join(workspaceBundle, 'dmg', dmgName));
  const foundDmg = dmgCandidates.find((path) => existsSync(path));
  const foundApp = findBuiltApp(env);
  if (foundDmg) {
    const size = statSync(foundDmg).size;
    console.log(`[package-desktop] dmg ${foundDmg} (${Math.round(size / 1024 / 1024)}M)`);
  } else {
    const extras = dmgBundleDirs(env).flatMap((dir) =>
      selectPackagedDmgNames(listDir(dir)).map((name) => join(dir, name)),
    );
    if (extras[0]) console.log(`[package-desktop] dmg ${extras[0]}`);
    else console.warn('[package-desktop] no DMG found');
  }
  if (foundApp) console.log(`[package-desktop] app ${foundApp}`);
}

const env = { ...process.env };
let identity;
if (process.platform === 'darwin') {
  identity = resolveIdentity(env);
  detachLeftoverDmgs();
  removeLeftoverRwFiles(env);
  applyPackageTempDir(env);
}

const steps = [['bundle:host'], ['fetch:node-runtime'], ['sign:host-macho']];
for (const args of steps) {
  const result = runPnpm(args, env);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const tauri = runPnpm(['--dir', 'apps/desktop', 'package', ...process.argv.slice(2)], env);
if (tauri.status !== 0) {
  if (process.platform === 'darwin' && recoverDmg(env, identity)) {
    printArtifacts(env);
    process.exit(0);
  }
  process.exit(tauri.status ?? 1);
}
printArtifacts(env);
