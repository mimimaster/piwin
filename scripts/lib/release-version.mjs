/**
 * Desktop release numbering. The git tag `vX.Y.Z` is the only version
 * authority: tauri.conf.json stays 0.0.0 in git and both build machines apply
 * the release version to a clean checkout of the tagged commit.
 *
 * X.Y.0 is a formal release ("正式版"); X.Y.Z with Z > 0 is a small update.
 */

const RELEASE_TAG_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

/**
 * @typedef {{ major: number, minor: number, patch: number }} ReleaseVersion
 * @typedef {'formal' | 'patch'} ReleaseKind
 */

/**
 * @param {string} raw tag or bare version; anything that is not plain X.Y.Z is rejected
 * @returns {ReleaseVersion | undefined}
 */
export function parseReleaseVersion(raw) {
  const match = RELEASE_TAG_PATTERN.exec(String(raw ?? '').trim());
  if (!match) return undefined;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** @param {ReleaseVersion} version */
export function formatReleaseVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/**
 * @param {ReleaseVersion} left
 * @param {ReleaseVersion} right
 */
export function compareReleaseVersions(left, right) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

/**
 * Highest X.Y.Z among tags; non-release tags such as `1.0-preview` are ignored.
 *
 * @param {string[]} tags
 * @returns {ReleaseVersion | undefined}
 */
export function latestReleaseVersion(tags) {
  /** @type {ReleaseVersion | undefined} */
  let latest;
  for (const tag of tags) {
    const version = parseReleaseVersion(tag);
    if (version && (!latest || compareReleaseVersions(version, latest) > 0)) latest = version;
  }
  return latest;
}

/**
 * @param {ReleaseVersion | undefined} latest
 * @param {ReleaseKind} kind
 * @returns {ReleaseVersion}
 */
export function nextReleaseVersion(latest, kind) {
  const base = latest ?? { major: 0, minor: 0, patch: 0 };
  if (kind === 'formal') return { major: base.major, minor: base.minor + 1, patch: 0 };
  return { major: base.major, minor: base.minor, patch: base.patch + 1 };
}

/**
 * @param {ReleaseVersion} version
 * @returns {ReleaseKind}
 */
export function releaseKind(version) {
  return version.patch === 0 ? 'formal' : 'patch';
}

/**
 * Tauri names bundles after productName (`piwin`); the public download name is
 * `piwinwin`. Versioned public names are never overwritten once published.
 *
 * @param {string} version
 */
export function installerFileNames(version) {
  return {
    macos: { built: `piwin_${version}_aarch64.dmg`, published: `piwinwin_${version}_aarch64.dmg` },
    windows: {
      built: `piwin_${version}_x64-setup.exe`,
      published: `piwinwin_${version}_x64-setup.exe`,
    },
  };
}
