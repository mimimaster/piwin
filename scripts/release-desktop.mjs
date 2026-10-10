#!/usr/bin/env node
/**
 * Desktop release in one command. See docs/guides/desktop-release.md.
 *
 *   node scripts/release-desktop.mjs plan    [--formal | --version X.Y.Z]
 *   node scripts/release-desktop.mjs publish [--formal | --version X.Y.Z]
 *                                            [--skip-windows] [--github] [--rebuild] [--dry-run]
 *
 * publish: commit CHANGELOG.md -> push -> build macOS (clean checkout, signed,
 * notarized) and Windows (build box) in parallel from that exact commit ->
 * upload to versioned R2 keys -> flip releases.json -> tag. `--dry-run` builds
 * origin/main without committing, notarizing, uploading, or tagging.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  countChangelogItems,
  extractChangelogSection,
  renderReleaseNotes,
} from './lib/release-changelog.mjs';
import { DEFAULT_RELEASE_CONFIG_PATH, resolveReleaseConfig } from './lib/release-config.mjs';
import {
  buildMacInstaller,
  buildWindowsInstaller,
  fileSha256,
} from './lib/release-installer-lanes.mjs';
import {
  RELEASE_MANIFEST_KEY,
  readManifestReleases,
  releaseObjectKey,
  releaseObjectUrl,
  upsertRelease,
} from './lib/release-manifest.mjs';
import { printPlan, runPreflight } from './lib/release-plan.mjs';
import {
  MANIFEST_CACHE_CONTROL,
  fetchPublishedManifest,
  publishGithubRelease,
  uploadObject,
  uploadReleaseFiles,
} from './lib/release-publish.mjs';
import { createStepRunner } from './lib/release-step-runner.mjs';
import {
  formatReleaseVersion,
  latestReleaseVersion,
  nextReleaseVersion,
  parseReleaseVersion,
  releaseKind,
} from './lib/release-version.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const changelogPath = join(repoRoot, 'CHANGELOG.md');
const UNTAGGED_DRAFT_COMMITS = 100;
const flags = new Set(process.argv.slice(3).filter((arg) => arg.startsWith('--')));

/** @param {string} message */
function fail(message) {
  console.error(`[release] ${message}`);
  process.exit(1);
}

/**
 * @param {string[]} args
 * @param {{ allowFailure?: boolean }} [options]
 */
function git(args, options = {}) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0 && !options.allowFailure) {
    fail(`git ${args.join(' ')} failed:\n${result.stderr}`);
  }
  return result.status === 0 ? result.stdout.trim() : '';
}

/** @param {string} name */
function flagValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function loadConfig() {
  const configPath = process.env.PIWIN_RELEASE_CONFIG ?? DEFAULT_RELEASE_CONFIG_PATH;
  const raw = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : undefined;
  if (!raw) console.warn(`[release] no release config at ${configPath}; using public defaults`);
  return resolveReleaseConfig(raw, { repoRoot });
}

function resolveTarget() {
  // Released versions are whatever is tagged on origin or locally. Tags are
  // listed, not fetched: fetching would fail on (or clobber) a local tag that
  // points somewhere else.
  git(['fetch', 'origin', '--prune']);
  const remoteTags = git(['ls-remote', '--tags', 'origin'])
    .split('\n')
    .map((line) => line.split('refs/tags/')[1]?.replace(/\^\{\}$/, '') ?? '');
  const latest = latestReleaseVersion([...remoteTags, ...git(['tag', '--list']).split('\n')]);
  const explicit = flagValue('--version');
  const parsed = explicit ? parseReleaseVersion(explicit) : undefined;
  if (explicit && !parsed) fail(`--version must be X.Y.Z, got ${explicit}`);
  const target = parsed ?? nextReleaseVersion(latest, flags.has('--formal') ? 'formal' : 'patch');
  const version = formatReleaseVersion(target);
  const section = existsSync(changelogPath)
    ? extractChangelogSection(readFileSync(changelogPath, 'utf8'), version)
    : undefined;
  return {
    version,
    kind: releaseKind(target),
    lastVersion: latest ? formatReleaseVersion(latest) : undefined,
    section,
    date: section?.date ?? new Date().toLocaleDateString('sv-SE'),
  };
}

/**
 * Commits since the last release tag, when that tag is part of this history;
 * otherwise a bounded recent window so the draft stays readable.
 *
 * @param {string | undefined} lastVersion
 */
function changelogRange(lastVersion) {
  const tag = `v${lastVersion}`;
  const reachable =
    lastVersion !== undefined &&
    spawnSync('git', ['merge-base', '--is-ancestor', tag, 'HEAD'], { cwd: repoRoot }).status === 0;
  return reachable ? [`${tag}..HEAD`] : ['-n', String(UNTAGGED_DRAFT_COMMITS), 'HEAD'];
}

async function plan() {
  const config = loadConfig();
  const target = resolveTarget();
  const subjects = git(['log', '--format=%s', ...changelogRange(target.lastVersion)]);
  printPlan({
    ...target,
    commit: git(['rev-parse', 'HEAD']),
    commitSubjects: subjects ? subjects.split('\n') : [],
    dirtyCount: git(['status', '--porcelain']).split('\n').filter(Boolean).length,
    unpushedCount: Number(git(['rev-list', '--count', 'origin/main..HEAD'])),
    checks: await runPreflight(config, { skipWindows: flags.has('--skip-windows') }),
  });
}

/**
 * Commit the release notes (and nothing else) and push, so both build
 * machines can check out one published commit.
 *
 * @param {string} version
 */
function commitAndPushChangelog(version) {
  if (git(['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') fail('publish must run on main');
  if (git(['status', '--porcelain', '--', 'CHANGELOG.md'])) {
    git(['add', 'CHANGELOG.md']);
    git(['commit', '--only', '-m', `release: v${version}`, '--', 'CHANGELOG.md']);
  }
  git(['push', 'origin', 'main']);
  const head = git(['rev-parse', 'HEAD']);
  if (git(['rev-parse', 'origin/main']) !== head) fail('origin/main is not at HEAD after push');
  return head;
}

/**
 * @param {{ version: string, dryRun: boolean }} input
 */
function resolveReleaseCommit({ version, dryRun }) {
  if (dryRun) return git(['rev-parse', 'origin/main']);
  // A tag that already exists means an earlier run got as far as tagging:
  // resume that exact commit instead of moving the version to a new one.
  const tagged = git(['rev-parse', '-q', '--verify', `refs/tags/v${version}^{commit}`], {
    allowFailure: true,
  });
  return tagged || commitAndPushChangelog(version);
}

async function publish() {
  const dryRun = flags.has('--dry-run');
  const skipWindows = flags.has('--skip-windows');
  const config = loadConfig();
  const target = resolveTarget();
  const { version, kind } = target;
  if (!dryRun && (!target.section || countChangelogItems(target.section) === 0)) {
    fail(`CHANGELOG.md has no entries for ${version}; run "plan" and write them first`);
  }

  const blocking = (await runPreflight(config, { skipWindows })).filter(
    (check) => check.blocking && !check.ok && !(dryRun && check.label.startsWith('公证')),
  );
  if (blocking.length > 0) {
    fail(blocking.map((check) => `${check.label}: ${check.detail}`).join('\n'));
  }

  const commit = resolveReleaseCommit({ version, dryRun });
  const outDir = join(repoRoot, 'dist', 'release', version);
  mkdirSync(outDir, { recursive: true });
  console.log(`[release] v${version} (${kind}) from ${commit}${dryRun ? ' — dry run' : ''}`);
  console.log(`[release] artifacts and logs in ${outDir}`);

  const startedAt = Date.now();
  const macRunner = createStepRunner({ lane: 'mac', logPath: join(outDir, 'mac.log') });
  const winRunner = createStepRunner({ lane: 'win', logPath: join(outDir, 'windows.log') });
  const rebuild = flags.has('--rebuild');
  const [mac, windows] = await Promise.allSettled([
    buildMacInstaller({
      repoRoot,
      config,
      commit,
      version,
      outDir,
      notarize: !dryRun,
      rebuild,
      runner: macRunner,
    }),
    skipWindows
      ? Promise.resolve(undefined)
      : buildWindowsInstaller({ config, commit, version, outDir, rebuild, runner: winRunner }),
  ]);
  for (const lane of [mac, windows]) {
    if (lane.status === 'rejected') console.error(String(lane.reason?.message ?? lane.reason));
  }
  if (mac.status === 'rejected' || windows.status === 'rejected') {
    fail('a build lane failed; finished lanes are kept and reused on the next run');
  }

  /** @type {Record<string, import('./lib/release-manifest.mjs').ReleaseAsset>} */
  const assets = {};
  /** @type {{ file: string, path: string, size: number, sha256: string }[]} */
  const installers = [];
  const built = [
    { platform: 'macos-aarch64', installer: mac.value },
    { platform: 'windows-x64', installer: windows.value },
  ];
  for (const { platform, installer } of built) {
    if (!installer) continue;
    // Hash only now: stapling rewrites the DMG.
    const sha256 = await fileSha256(installer.path);
    const size = statSync(installer.path).size;
    writeFileSync(`${installer.path}.sha256`, `${sha256}  ${installer.file}\n`);
    const key = releaseObjectKey(version, installer.file);
    assets[platform] = {
      file: installer.file,
      url: releaseObjectUrl(config.r2.publicBase, key),
      size,
      sha256,
    };
    installers.push({ file: installer.file, path: installer.path, size, sha256 });
  }

  const buildSeconds = Math.round((Date.now() - startedAt) / 1000);
  if (dryRun) {
    printSummary({
      version,
      commit,
      assets,
      gate: mac.value.gate,
      buildSeconds,
      runners: [macRunner, winRunner],
    });
    console.log('[release] dry run: nothing committed, notarized, uploaded, or tagged');
    return;
  }

  const publishRunner = createStepRunner({ lane: 'publish', logPath: join(outDir, 'publish.log') });
  await uploadReleaseFiles({ config, runner: publishRunner, version, installers, cwd: repoRoot });

  const manifest = upsertRelease(
    readManifestReleases(await fetchPublishedManifest(config.r2.publicBase, RELEASE_MANIFEST_KEY)),
    { version, kind, date: target.date, commit, notes: target.section?.groups ?? [], assets },
    new Date().toISOString(),
  );
  const manifestPath = join(outDir, RELEASE_MANIFEST_KEY);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await uploadObject({
    config,
    runner: publishRunner,
    key: RELEASE_MANIFEST_KEY,
    filePath: manifestPath,
    cacheControl: MANIFEST_CACHE_CONTROL,
    cwd: repoRoot,
  });

  if (!git(['rev-parse', '-q', '--verify', `refs/tags/v${version}`], { allowFailure: true })) {
    git(['tag', `v${version}`, commit]);
  }
  git(['push', 'origin', `v${version}`]);

  if (kind === 'formal' || flags.has('--github')) {
    const notesPath = join(outDir, 'notes.md');
    writeFileSync(notesPath, `${target.section ? renderReleaseNotes(target.section) : ''}\n`);
    await publishGithubRelease({
      runner: publishRunner,
      version,
      notesPath,
      files: installers.flatMap((entry) => [entry.path, `${entry.path}.sha256`]),
      cwd: repoRoot,
    });
  }

  printSummary({
    version,
    commit,
    assets,
    gate: mac.value.gate,
    buildSeconds,
    runners: [macRunner, winRunner, publishRunner],
  });
}

/**
 * @param {{
 *   version: string, commit: string, gate: string | undefined, buildSeconds: number,
 *   assets: Record<string, import('./lib/release-manifest.mjs').ReleaseAsset>,
 *   runners: import('./lib/release-step-runner.mjs').StepRunner[],
 * }} summary
 */
function printSummary(summary) {
  console.log(`\n[release] v${summary.version} @ ${summary.commit}`);
  for (const [platform, asset] of Object.entries(summary.assets)) {
    console.log(
      `  ${platform}  ${(asset.size / 1024 / 1024).toFixed(1)} MiB  sha256 ${asset.sha256}`,
    );
    console.log(`    ${asset.url}`);
  }
  if (summary.gate) console.log(`  gatekeeper: ${summary.gate.split('\n').join(' | ')}`);
  console.log(`  build wall time ${summary.buildSeconds}s; step timings:`);
  for (const runner of summary.runners) {
    for (const { step, seconds } of runner.timings) {
      if (seconds >= 5) console.log(`    [${runner.lane}] ${step} ${seconds}s`);
    }
  }
}

const command = process.argv[2];
const commands = { plan, publish };
const handler = commands[/** @type {keyof typeof commands} */ (command)];
if (!handler)
  fail('usage: release-desktop.mjs <plan|publish> [--formal | --version X.Y.Z] [options]');
else {
  handler().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
