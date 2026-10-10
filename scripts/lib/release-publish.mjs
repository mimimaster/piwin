/**
 * Publishing: installers go to versioned R2 keys, then the manifest flips the
 * download page to them. The manifest is written last, after every installer
 * is confirmed reachable at its public URL with the right size.
 */
import { spawnSync } from 'node:child_process';
import { releaseObjectKey, releaseObjectUrl } from './release-manifest.mjs';
import { ReleaseStepError } from './release-step-runner.mjs';

/** Versioned keys are never overwritten, so they may be cached forever. */
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const MANIFEST_CACHE_CONTROL = 'public, max-age=60';

const SIZE_CHECK_ATTEMPTS = 5;
const SIZE_CHECK_DELAY_MS = 3000;

/**
 * @typedef {import('./release-config.mjs').ReleaseConfig} ReleaseConfig
 * @typedef {import('./release-step-runner.mjs').StepRunner} StepRunner
 */

/** @param {string} file */
export function contentTypeForFile(file) {
  if (file.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (file.endsWith('.sha256')) return 'text/plain';
  if (file.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

/**
 * rclone (S3 multipart, parallel parts, no size cap) when a remote is
 * configured and installed; otherwise wrangler, which uploads in one request
 * and refuses objects above 300 MiB.
 *
 * @param {ReleaseConfig} config
 * @returns {'rclone' | 'wrangler'}
 */
export function pickUploader(config) {
  if (!config.r2.rcloneRemote) return 'wrangler';
  const remotes = spawnSync('rclone', ['listremotes'], { encoding: 'utf8' });
  return remotes.status === 0 && remotes.stdout.split('\n').includes(`${config.r2.rcloneRemote}:`)
    ? 'rclone'
    : 'wrangler';
}

/**
 * @param {{
 *   config: ReleaseConfig, runner: StepRunner, key: string, filePath: string,
 *   cacheControl: string, cwd: string,
 * }} input
 */
export async function uploadObject(input) {
  const { config, runner, key, filePath, cacheControl } = input;
  const contentType = contentTypeForFile(key);
  if (pickUploader(config) === 'rclone') {
    await runner.run(`upload ${key}`, 'rclone', [
      'copyto',
      filePath,
      `${config.r2.rcloneRemote}:${config.r2.bucket}/${key}`,
      '--s3-upload-concurrency',
      '8',
      '--s3-chunk-size',
      '16M',
      '--s3-no-check-bucket',
      '--header-upload',
      `Cache-Control: ${cacheControl}`,
      '--header-upload',
      `Content-Type: ${contentType}`,
    ]);
    return;
  }
  await runner.run(
    `upload ${key}`,
    'npx',
    [
      '--yes',
      'wrangler@4',
      'r2',
      'object',
      'put',
      `${config.r2.bucket}/${key}`,
      '--file',
      filePath,
      '--content-type',
      contentType,
      '--cache-control',
      cacheControl,
      '--remote',
    ],
    { cwd: input.cwd },
  );
}

/**
 * @param {string} url
 * @param {number} expectedSize
 */
export async function assertPublishedSize(url, expectedSize) {
  let seen = 'no response';
  for (let attempt = 1; attempt <= SIZE_CHECK_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      seen = `${response.status} content-length=${response.headers.get('content-length')}`;
      if (response.ok && Number(response.headers.get('content-length')) === expectedSize) return;
    } catch (error) {
      seen = String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, SIZE_CHECK_DELAY_MS));
  }
  throw new ReleaseStepError(
    'publish',
    `verify ${url}`,
    `expected ${expectedSize} bytes, saw ${seen}`,
  );
}

/**
 * @param {string} publicBase
 * @param {string} manifestKey
 * @returns {Promise<unknown>} parsed manifest, or undefined before the first release
 */
export async function fetchPublishedManifest(publicBase, manifestKey) {
  // The query string only defeats intermediate caches; R2 ignores it.
  const url = `${releaseObjectUrl(publicBase, manifestKey)}?t=${Date.now()}`;
  const response = await fetch(url);
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new ReleaseStepError('publish', 'read manifest', `${url} -> ${response.status}`);
  }
  return response.json();
}

/**
 * True when this exact installer is already live: a rerun after a later step
 * failed should not push hundreds of megabytes again.
 *
 * @param {string} url
 * @param {{ size: number, sha256: string }} installer
 */
async function isInstallerPublished(url, installer) {
  try {
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok || Number(head.headers.get('content-length')) !== installer.size) return false;
    const published = await fetch(`${url}.sha256`);
    return published.ok && (await published.text()).startsWith(installer.sha256);
  } catch {
    // Unreachable CDN is treated as "not published"; the upload will surface real errors.
    return false;
  }
}

/**
 * Each installer is uploaded together with its `.sha256` sidecar.
 *
 * @param {{
 *   config: ReleaseConfig, runner: StepRunner, version: string, cwd: string,
 *   installers: { file: string, path: string, size: number, sha256: string }[],
 * }} input
 */
export async function uploadReleaseFiles(input) {
  const { config, runner, version } = input;
  await Promise.all(
    input.installers.map(async (installer) => {
      const key = releaseObjectKey(version, installer.file);
      const url = releaseObjectUrl(config.r2.publicBase, key);
      if (await isInstallerPublished(url, installer)) {
        console.log(`[${runner.lane}] already published ${url}`);
        return;
      }
      const upload = { config, runner, cacheControl: IMMUTABLE_CACHE_CONTROL, cwd: input.cwd };
      await uploadObject({ ...upload, key, filePath: installer.path });
      await uploadObject({ ...upload, key: `${key}.sha256`, filePath: `${installer.path}.sha256` });
      await assertPublishedSize(url, installer.size);
    }),
  );
}

/**
 * GitHub gets installers only for formal releases: it doubles the upload time
 * and small updates are served from R2 alone.
 *
 * @param {{ runner: StepRunner, version: string, notesPath: string, files: string[], cwd: string }} input
 */
export async function publishGithubRelease(input) {
  await input.runner.run(
    'github release',
    'gh',
    [
      'release',
      'create',
      `v${input.version}`,
      '--verify-tag',
      '--title',
      `v${input.version}`,
      '--notes-file',
      input.notesPath,
      ...input.files,
    ],
    { cwd: input.cwd },
  );
}
