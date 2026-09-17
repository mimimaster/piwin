/** Semver used by tauri.conf.json / DMG names. Tags may include a leading `v`. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.]+)?$/;

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeDesktopPackageVersion(raw) {
  const version = String(raw ?? '')
    .trim()
    .replace(/^v/i, '');
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(`invalid desktop package version: ${raw}`);
  }
  return version;
}

/**
 * Replace the first "version" string field. tauri.conf.json keeps product
 * version at the top of the file, before bundle metadata.
 *
 * @param {string} source
 * @param {string} version
 * @returns {string}
 */
export function replaceDesktopConfigVersion(source, version) {
  if (!/"version"\s*:/.test(source)) {
    throw new Error('tauri.conf.json is missing a version field');
  }
  return source.replace(/("version"\s*:\s*")([^"]*)(")/, `$1${version}$3`);
}
