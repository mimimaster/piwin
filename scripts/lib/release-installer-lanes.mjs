/**
 * The two installer lanes. Each builds from a clean checkout of the exact
 * release commit and leaves one publicly named installer in `outDir`, plus a
 * marker so a rerun after a failed upload does not rebuild.
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { copyFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  WINDOWS_BUILD_SCRIPT_NAME,
  macGateFailures,
  windowsBuildScript,
  windowsInstallerScpPath,
} from './release-build-commands.mjs';
import { installerFileNames } from './release-version.mjs';
import { ReleaseStepError } from './release-step-runner.mjs';

const SSH_OPTIONS = [
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=15',
  '-o',
  'ServerAliveInterval=30',
  '-o',
  'ServerAliveCountMax=240',
];

/**
 * @typedef {import('./release-config.mjs').ReleaseConfig} ReleaseConfig
 * @typedef {import('./release-step-runner.mjs').StepRunner} StepRunner
 * @typedef {{ path: string, file: string, reused: boolean, notarized: boolean }} BuiltInstaller
 */

/** @param {string} path */
export function fileSha256(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** @param {string} installerPath */
function markerPath(installerPath) {
  return `${installerPath}.built.json`;
}

/**
 * @param {string} installerPath
 * @param {{ commit: string, version: string, notarized: boolean }} expected
 */
function isAlreadyBuilt(installerPath, expected) {
  if (!existsSync(installerPath) || !existsSync(markerPath(installerPath))) return false;
  try {
    const marker = JSON.parse(readFileSync(markerPath(installerPath), 'utf8'));
    return (
      marker.commit === expected.commit &&
      marker.version === expected.version &&
      (marker.notarized === true || !expected.notarized)
    );
  } catch {
    // An unreadable marker only costs a rebuild.
    return false;
  }
}

/**
 * @param {{ runner: StepRunner, dmgPath: string }} input
 */
async function assertMacGate({ runner, dmgPath }) {
  const quiet = { allowFailure: true };
  const codesign = await runner.run(
    'gate codesign',
    'codesign',
    ['-dv', '--verbose=2', dmgPath],
    quiet,
  );
  const stapler = await runner.run(
    'gate stapler',
    'xcrun',
    ['stapler', 'validate', dmgPath],
    quiet,
  );
  const spctl = await runner.run(
    'gate spctl',
    'spctl',
    ['--assess', '--type', 'open', '--context', 'context:primary-signature', '-v', dmgPath],
    quiet,
  );
  const failures = macGateFailures({
    codesign: codesign.output,
    staplerOk: stapler.code === 0,
    spctl: spctl.output,
  });
  if (failures.length > 0) {
    throw new ReleaseStepError(runner.lane, 'notarization gate', failures.join('\n'));
  }
  return spctl.output.trim();
}

/**
 * @param {{
 *   repoRoot: string, config: ReleaseConfig, commit: string, version: string,
 *   outDir: string, notarize: boolean, rebuild: boolean, runner: StepRunner,
 * }} input
 * @returns {Promise<BuiltInstaller & { gate: string | undefined }>}
 */
export async function buildMacInstaller(input) {
  const { repoRoot, config, commit, version, outDir, notarize, runner } = input;
  const names = installerFileNames(version).macos;
  const dmgPath = join(outDir, names.published);
  if (!input.rebuild && isAlreadyBuilt(dmgPath, { commit, version, notarized: notarize })) {
    console.log(`[${runner.lane}] reusing ${dmgPath}`);
    const gate = notarize ? await assertMacGate({ runner, dmgPath }) : undefined;
    return { path: dmgPath, file: names.published, reused: true, notarized: notarize, gate };
  }
  if (notarize && !config.apple) {
    throw new ReleaseStepError(
      runner.lane,
      'preflight',
      'apple.apiKey / apple.apiIssuer missing in release config',
    );
  }

  const checkout = config.macCheckout;
  if (!existsSync(join(checkout, '.git'))) {
    await runner.run(
      'create release checkout',
      'git',
      ['worktree', 'add', '--detach', checkout, commit],
      {
        cwd: repoRoot,
      },
    );
  }
  await runner.run('reset checkout', 'git', ['reset', '--hard', commit], { cwd: checkout });
  const head = await runner.run('verify checkout', 'git', ['rev-parse', 'HEAD'], { cwd: checkout });
  if (head.output.trim() !== commit) {
    throw new ReleaseStepError(
      runner.lane,
      'verify checkout',
      `HEAD ${head.output.trim()} != ${commit}`,
    );
  }

  const env = { ...process.env, PIWIN_REQUIRE_DEVELOPER_ID: '1' };
  // Output must land in this checkout's own target dir, not a shared one.
  delete env.CARGO_TARGET_DIR;
  if (config.apple?.signingIdentity) env.APPLE_SIGNING_IDENTITY = config.apple.signingIdentity;
  if (config.packageTmpdir) env.PIWIN_PACKAGE_TMPDIR = config.packageTmpdir;
  const inCheckout = { cwd: checkout, env };

  await runner.run('pnpm install', 'pnpm', ['install', '--frozen-lockfile'], inCheckout);
  await runner.run(
    'apply version',
    'node',
    ['scripts/apply-desktop-version.mjs', version],
    inCheckout,
  );
  await runner.run('package desktop', 'pnpm', ['package:desktop'], inCheckout);
  await runner.run('verify package', 'pnpm', ['verify:desktop-package'], inCheckout);

  const builtDmg = join(checkout, 'apps/desktop/src-tauri/target/release/bundle/dmg', names.built);
  if (!existsSync(builtDmg)) {
    throw new ReleaseStepError(runner.lane, 'collect dmg', `missing ${builtDmg}`);
  }
  await copyFile(builtDmg, dmgPath);

  let gate;
  if (notarize && config.apple) {
    const keyPath =
      config.apple.apiKeyPath ??
      join(homedir(), '.appstoreconnect', 'private_keys', `AuthKey_${config.apple.apiKey}.p8`);
    await runner.run('notarize + staple', 'bash', ['scripts/notarize-macos-dmg.sh', dmgPath], {
      cwd: checkout,
      env: {
        ...env,
        APPLE_API_KEY: config.apple.apiKey,
        APPLE_API_ISSUER: config.apple.apiIssuer,
        APPLE_API_KEY_PATH: keyPath,
        PIWIN_REQUIRE_NOTARIZED: '1',
      },
    });
    gate = await assertMacGate({ runner, dmgPath });
  }
  writeFileSync(
    markerPath(dmgPath),
    `${JSON.stringify({ commit, version, notarized: notarize })}\n`,
  );
  return { path: dmgPath, file: names.published, reused: false, notarized: notarize, gate };
}

/**
 * @param {{
 *   config: ReleaseConfig, commit: string, version: string,
 *   outDir: string, rebuild: boolean, runner: StepRunner,
 * }} input
 * @returns {Promise<BuiltInstaller>}
 */
export async function buildWindowsInstaller(input) {
  const { config, commit, version, outDir, runner } = input;
  const names = installerFileNames(version).windows;
  const exePath = join(outDir, names.published);
  if (!input.rebuild && isAlreadyBuilt(exePath, { commit, version, notarized: false })) {
    console.log(`[${runner.lane}] reusing ${exePath}`);
    return { path: exePath, file: names.published, reused: true, notarized: false };
  }
  if (!config.windows) {
    throw new ReleaseStepError(
      runner.lane,
      'preflight',
      'windows.ssh / windows.dir missing in release config',
    );
  }

  const scriptPath = join(outDir, WINDOWS_BUILD_SCRIPT_NAME);
  writeFileSync(scriptPath, windowsBuildScript({ dir: config.windows.dir, commit, version }));
  await runner.run('copy build script', 'scp', [
    '-o',
    'BatchMode=yes',
    scriptPath,
    `${config.windows.ssh}:${WINDOWS_BUILD_SCRIPT_NAME}`,
  ]);
  const remote = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${WINDOWS_BUILD_SCRIPT_NAME}`;
  const build = await runner.run('remote build', 'ssh', [
    ...SSH_OPTIONS,
    config.windows.ssh,
    remote,
  ]);
  if (!build.output.includes(`[release-win] HEAD=${commit}`)) {
    throw new ReleaseStepError(
      runner.lane,
      'remote build',
      'build box did not confirm the release commit',
    );
  }
  const remoteFile = windowsInstallerScpPath(config.windows.dir, names.built);
  await runner.run('copy installer', 'scp', [
    '-o',
    'BatchMode=yes',
    `${config.windows.ssh}:${remoteFile}`,
    exePath,
  ]);
  const { size } = await stat(exePath);
  if (size === 0) throw new ReleaseStepError(runner.lane, 'copy installer', `${exePath} is empty`);
  writeFileSync(markerPath(exePath), `${JSON.stringify({ commit, version, notarized: false })}\n`);
  return { path: exePath, file: names.published, reused: false, notarized: false };
}
