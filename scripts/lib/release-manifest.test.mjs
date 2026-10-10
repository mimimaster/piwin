import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readManifestReleases,
  releaseObjectKey,
  releaseObjectUrl,
  upsertRelease,
} from './release-manifest.mjs';

/**
 * @param {string} version
 * @param {string[]} platforms
 */
function release(version, platforms) {
  return {
    version,
    kind: /** @type {'formal' | 'patch'} */ (version.endsWith('.0') ? 'formal' : 'patch'),
    date: '2026-10-08',
    commit: 'abc',
    notes: [],
    assets: Object.fromEntries(
      platforms.map((platform) => [
        platform,
        {
          file: `${platform}-${version}`,
          url: `https://dl/${version}/${platform}`,
          size: 1,
          sha256: 'f',
        },
      ]),
    ),
  };
}

test('object keys are versioned and URLs tolerate a trailing slash', () => {
  const key = releaseObjectKey('0.1.1', 'piwinwin_0.1.1_aarch64.dmg');
  assert.equal(key, 'releases/0.1.1/piwinwin_0.1.1_aarch64.dmg');
  assert.equal(releaseObjectUrl('https://dl.piwinwin.com/', key), `https://dl.piwinwin.com/${key}`);
});

test('upsertRelease sorts newest first and replaces a republished version', () => {
  const first = upsertRelease([], release('0.1.9', ['macos-aarch64', 'windows-x64']), 't1');
  const second = upsertRelease(
    first.releases,
    release('0.1.10', ['macos-aarch64', 'windows-x64']),
    't2',
  );
  const third = upsertRelease(second.releases, release('0.1.9', ['macos-aarch64']), 't3');
  assert.deepEqual(
    third.releases.map((entry) => entry.version),
    ['0.1.10', '0.1.9'],
  );
  assert.deepEqual(Object.keys(third.releases[1]?.assets ?? {}), ['macos-aarch64']);
  assert.equal(third.updatedAt, 't3');
});

test('latest is per platform: a macOS-only release keeps the older Windows installer live', () => {
  const base = upsertRelease([], release('0.2.0', ['macos-aarch64', 'windows-x64']), 't1');
  const manifest = upsertRelease(base.releases, release('0.2.1', ['macos-aarch64']), 't2');
  assert.equal(manifest.latest['macos-aarch64']?.version, '0.2.1');
  assert.equal(manifest.latest['windows-x64']?.version, '0.2.0');
  assert.equal(manifest.latest['windows-x64']?.url, 'https://dl/0.2.0/windows-x64');
});

test('readManifestReleases survives a missing or malformed manifest', () => {
  assert.deepEqual(readManifestReleases(undefined), []);
  assert.deepEqual(readManifestReleases({ releases: 'nope' }), []);
  assert.deepEqual(
    readManifestReleases({ releases: [{ version: 'junk' }, null, release('0.1.1', [])] }).length,
    1,
  );
});
