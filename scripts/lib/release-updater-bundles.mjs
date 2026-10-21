/**
 * Builds and signs the in-app updater bundles (ADR 0097) on the Mac, after
 * both installer lanes finished. Signing happens only here, so the updater
 * private key never leaves this machine.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { releaseObjectKey, releaseObjectUrl } from './release-manifest.mjs';
import { MANIFEST_CACHE_CONTROL, uploadObject } from './release-publish.mjs';
import {
  buildUpdaterManifest,
  macUpdaterBundleFileName,
  updaterManifestKey,
  updaterPlatformKey,
} from './release-updater-manifest.mjs';
import { ReleaseStepError } from './release-step-runner.mjs';

const APP_NAME = 'piwin.app';

/**
 * @typedef {import('./release-config.mjs').ReleaseConfig} ReleaseConfig
 * @typedef {import('./release-step-runner.mjs').StepRunner} StepRunner
 */

/**
 * A bundle (and its `.sig`) newer than the installer it came from is reused,
 * so a rerun after a failed upload publishes the same bytes again.
 *
 * @param {string} bundlePath
 * @param {string} sourcePath
 */
function isBundleCurrent(bundlePath, sourcePath) {
  if (!existsSync(bundlePath) || !existsSync(`${bundlePath}.sig`)) return false;
  return statSync(bundlePath).mtimeMs >= statSync(sourcePath).mtimeMs;
}

/**
 * @param {string} plist `hdiutil attach -plist` output
 * @returns {string | undefined}
 */
export function parseHdiutilMountPoint(plist) {
  const match = /<key>mount-point<\/key>\s*<string>([^<]+)<\/string>/.exec(plist);
  return match?.[1];
}

/**
 * The `.app` is copied out of the notarized DMG rather than from the build
 * tree: it is the exact code Apple ticketed. `stapler staple` attaches that
 * ticket to the `.app` itself so an offline first launch after an update
 * still passes Gatekeeper.
 *
 * @param {{
 *   runner: StepRunner, dmgPath: string, outDir: string, version: string,
 *   notarized: boolean, tmpdir: string | undefined,
 * }} input
 * @returns {Promise<string>} path of the `.app.tar.gz`
 */
export async function createMacUpdaterBundle(input) {
  const { runner, dmgPath, outDir, version } = input;
  const bundlePath = join(outDir, macUpdaterBundleFileName(version));
  if (isBundleCurrent(bundlePath, dmgPath)) {
    console.log(`[${runner.lane}] reusing ${bundlePath}`);
    return bundlePath;
  }
  const workDir = mkdtempSync(join(input.tmpdir ?? outDir, 'piwin-updater-'));
  const stagingDir = join(workDir, 'staging');
  try {
    // hdiutil picks the mount point: a caller-chosen `-mountpoint` outside
    // /Volumes is refused on some volumes ("permission denied").
    const attach = await runner.run('mount dmg', 'hdiutil', [
      'attach',
      dmgPath,
      '-nobrowse',
      '-readonly',
      '-noautoopen',
      '-noverify',
      '-plist',
    ]);
    const mountPoint = parseHdiutilMountPoint(attach.output);
    if (!mountPoint) {
      throw new ReleaseStepError(runner.lane, 'mount dmg', 'hdiutil reported no mount point');
    }
    try {
      await runner.run('copy app', 'ditto', [
        join(mountPoint, APP_NAME),
        join(stagingDir, APP_NAME),
      ]);
    } finally {
      await runner.run('detach dmg', 'hdiutil', ['detach', mountPoint, '-force'], {
        allowFailure: true,
      });
    }
    const stagedApp = join(stagingDir, APP_NAME);
    if (input.notarized) {
      await runner.run('staple app', 'xcrun', ['stapler', 'staple', stagedApp]);
      await runner.run('validate app staple', 'xcrun', ['stapler', 'validate', stagedApp]);
    }
    // Tauri unpacks with the `tar` crate and drops the first path component,
    // so the archive must hold `piwin.app/...`. AppleDouble `._*` entries or
    // xattr records would land inside the bundle and break its signature.
    await runner.run(
      'archive app',
      'tar',
      ['--no-xattrs', '--no-mac-metadata', '-czf', bundlePath, '-C', stagingDir, APP_NAME],
      { env: { ...process.env, COPYFILE_DISABLE: '1' } },
    );
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  return bundlePath;
}

/**
 * Writes `<file>.sig` with the Tauri minisign key and returns its contents.
 * The password goes through the environment so it never reaches a log line.
 *
 * @param {{ runner: StepRunner, config: ReleaseConfig, filePath: string, repoRoot: string }} input
 * @returns {Promise<string>}
 */
export async function signUpdaterFile(input) {
  const { runner, config, filePath, repoRoot } = input;
  const keyPath = config.updater.privateKeyPath;
  if (!existsSync(keyPath)) {
    throw new ReleaseStepError(runner.lane, 'sign update', `missing updater key ${keyPath}`);
  }
  const sigPath = `${filePath}.sig`;
  if (!existsSync(sigPath) || statSync(sigPath).mtimeMs < statSync(filePath).mtimeMs) {
    await runner.run(
      `sign ${filePath.split('/').pop()}`,
      'pnpm',
      ['--dir', 'apps/desktop', 'exec', 'tauri', 'signer', 'sign', '-f', keyPath, filePath],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '',
        },
      },
    );
  }
  if (!existsSync(sigPath)) {
    throw new ReleaseStepError(runner.lane, 'sign update', `signer wrote no ${sigPath}`);
  }
  return readFileSync(sigPath, 'utf8');
}

/**
 * @typedef {{ platform: string, file: string, path: string, signature: string }} UpdaterBundle
 */

/**
 * macOS gets a new `.app.tar.gz`; Windows updates run the published NSIS
 * installer, which only needs a signature.
 *
 * @param {{
 *   runner: StepRunner, config: ReleaseConfig, repoRoot: string, version: string,
 *   outDir: string, notarized: boolean,
 *   mac: { path: string } | undefined, windows: { path: string, file: string } | undefined,
 * }} input
 * @returns {Promise<UpdaterBundle[]>}
 */
export async function prepareUpdaterBundles(input) {
  const { runner, config, repoRoot, version } = input;
  /** @type {UpdaterBundle[]} */
  const bundles = [];
  if (input.mac) {
    const path = await createMacUpdaterBundle({
      runner,
      dmgPath: input.mac.path,
      outDir: input.outDir,
      version,
      notarized: input.notarized,
      tmpdir: config.packageTmpdir,
    });
    const signature = await signUpdaterFile({ runner, config, filePath: path, repoRoot });
    bundles.push({ platform: 'macos-aarch64', file: macUpdaterBundleFileName(version), path, signature });
  }
  if (input.windows) {
    const signature = await signUpdaterFile({
      runner,
      config,
      filePath: input.windows.path,
      repoRoot,
    });
    bundles.push({
      platform: 'windows-x64',
      file: input.windows.file,
      path: input.windows.path,
      signature,
    });
  }
  return bundles;
}

/**
 * Called after every bundle is uploaded and verified, before `releases.json`:
 * an install must never be offered a bundle that is not live yet.
 *
 * @param {{
 *   runner: StepRunner, config: ReleaseConfig, cwd: string, version: string,
 *   outDir: string, notes: string, pubDate: string, bundles: UpdaterBundle[],
 * }} input
 */
export async function publishUpdaterManifests(input) {
  for (const bundle of input.bundles) {
    const updaterPlatform = updaterPlatformKey(bundle.platform);
    const manifest = buildUpdaterManifest({
      version: input.version,
      notes: input.notes,
      pubDate: input.pubDate,
      updaterPlatform,
      url: releaseObjectUrl(input.config.r2.publicBase, releaseObjectKey(input.version, bundle.file)),
      signature: bundle.signature,
    });
    const manifestPath = join(input.outDir, `updater-${updaterPlatform}.json`);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await uploadObject({
      config: input.config,
      runner: input.runner,
      key: updaterManifestKey(updaterPlatform),
      filePath: manifestPath,
      cacheControl: MANIFEST_CACHE_CONTROL,
      cwd: input.cwd,
    });
  }
}
