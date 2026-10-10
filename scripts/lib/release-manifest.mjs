/**
 * `releases.json` on the download CDN: the one mutable object. Installers are
 * published under versioned, immutable keys, so the download page only has to
 * re-read this manifest — no docs rebuild and no `?v=` cache busting.
 */
import { compareReleaseVersions, parseReleaseVersion } from './release-version.mjs';

export const RELEASE_MANIFEST_SCHEMA = 1;
export const RELEASE_MANIFEST_KEY = 'releases.json';
export const RELEASE_PLATFORMS = ['macos-aarch64', 'windows-x64'];

/**
 * @typedef {{ file: string, url: string, size: number, sha256: string }} ReleaseAsset
 * @typedef {{
 *   version: string,
 *   kind: 'formal' | 'patch',
 *   date: string,
 *   commit: string,
 *   notes: { title: string, items: string[] }[],
 *   assets: Record<string, ReleaseAsset>,
 * }} ReleaseEntry
 * @typedef {{
 *   schema: number,
 *   updatedAt: string,
 *   latest: Record<string, ReleaseAsset & { version: string }>,
 *   releases: ReleaseEntry[],
 * }} ReleaseManifest
 */

/**
 * @param {string} version
 * @param {string} file
 */
export function releaseObjectKey(version, file) {
  return `releases/${version}/${file}`;
}

/**
 * @param {string} publicBase e.g. https://dl.piwinwin.com
 * @param {string} key
 */
export function releaseObjectUrl(publicBase, key) {
  return `${publicBase.replace(/\/+$/, '')}/${key}`;
}

/**
 * @param {unknown} raw parsed JSON of the currently published manifest, if any
 * @returns {ReleaseEntry[]}
 */
export function readManifestReleases(raw) {
  if (typeof raw !== 'object' || raw === null) return [];
  const releases = /** @type {{ releases?: unknown }} */ (raw).releases;
  if (!Array.isArray(releases)) return [];
  return releases.filter(
    (entry) => typeof entry === 'object' && entry !== null && parseReleaseVersion(entry.version),
  );
}

/**
 * Replace-or-insert one release, newest first. `latest` is per platform: a
 * release that skipped Windows must not take the Windows button offline.
 *
 * @param {ReleaseEntry[]} existing
 * @param {ReleaseEntry} release
 * @param {string} updatedAt ISO timestamp
 * @returns {ReleaseManifest}
 */
export function upsertRelease(existing, release, updatedAt) {
  const releases = [...existing.filter((entry) => entry.version !== release.version), release].sort(
    (left, right) => {
      const leftVersion = parseReleaseVersion(left.version);
      const rightVersion = parseReleaseVersion(right.version);
      if (!leftVersion || !rightVersion) return 0;
      return compareReleaseVersions(rightVersion, leftVersion);
    },
  );
  /** @type {ReleaseManifest['latest']} */
  const latest = {};
  for (const platform of RELEASE_PLATFORMS) {
    const newest = releases.find((entry) => entry.assets[platform]);
    const asset = newest?.assets[platform];
    if (newest && asset) latest[platform] = { version: newest.version, ...asset };
  }
  return { schema: RELEASE_MANIFEST_SCHEMA, updatedAt, latest, releases };
}
