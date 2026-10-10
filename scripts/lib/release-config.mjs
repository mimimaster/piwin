/**
 * Machine-specific release facts (build box address, Apple key ids, checkout
 * paths) live outside this public repo, in a JSON file next to the local
 * release skill. Only public facts have defaults here.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_RELEASE_CONFIG_PATH = join(
  homedir(),
  '.piwin',
  'skills',
  'piwin-desktop-release',
  'release.config.json',
);

/**
 * @typedef {{
 *   macCheckout: string,
 *   packageTmpdir: string | undefined,
 *   apple: { signingIdentity: string | undefined, apiKey: string, apiIssuer: string, apiKeyPath: string | undefined } | undefined,
 *   windows: { ssh: string, dir: string } | undefined,
 *   r2: { bucket: string, publicBase: string, rcloneRemote: string | undefined },
 * }} ReleaseConfig
 */

/** @param {unknown} value */
function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** @param {unknown} value */
function asRecord(value) {
  return typeof value === 'object' && value !== null
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * @param {unknown} raw parsed config file, or undefined when it does not exist
 * @param {{ repoRoot: string }} context
 * @returns {ReleaseConfig}
 */
export function resolveReleaseConfig(raw, context) {
  const root = asRecord(raw);
  const apple = asRecord(root.apple);
  const windows = asRecord(root.windows);
  const r2 = asRecord(root.r2);
  const apiKey = optionalString(apple.apiKey);
  const apiIssuer = optionalString(apple.apiIssuer);
  const windowsSsh = optionalString(windows.ssh);
  const windowsDir = optionalString(windows.dir);
  return {
    // A sibling of the dev tree: releases build from a clean checkout so
    // uncommitted work never ships and the dev tree stays usable meanwhile.
    macCheckout: optionalString(root.macCheckout) ?? `${context.repoRoot}-release`,
    packageTmpdir: optionalString(root.packageTmpdir),
    apple:
      apiKey && apiIssuer
        ? {
            signingIdentity: optionalString(apple.signingIdentity),
            apiKey,
            apiIssuer,
            apiKeyPath: optionalString(apple.apiKeyPath),
          }
        : undefined,
    windows: windowsSsh && windowsDir ? { ssh: windowsSsh, dir: windowsDir } : undefined,
    r2: {
      bucket: optionalString(r2.bucket) ?? 'piwin-downloads',
      publicBase: optionalString(r2.publicBase) ?? 'https://dl.piwinwin.com',
      rcloneRemote: optionalString(r2.rcloneRemote),
    },
  };
}
