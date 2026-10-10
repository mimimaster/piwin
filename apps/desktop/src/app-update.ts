/**
 * Which installer, if any, is newer than the running Desktop build.
 * Reads the same release manifest the download page uses
 * (scripts/lib/release-manifest.mjs writes it at publish time).
 */

export const RELEASE_MANIFEST_URL = 'https://dl.piwinwin.com/releases.json';
export const DOWNLOAD_PAGE_URL = 'https://docs.piwinwin.com/download';
/** tauri.conf.json stays at this version in git; only release builds get a real one. */
export const DEVELOPMENT_BUILD_VERSION = '0.0.0';

export type ReleasePlatform = 'macos-aarch64' | 'windows-x64';

export type AvailableUpdate = {
  version: string;
};

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(value: string): [number, number, number] | undefined {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Positive when `left` is newer; undefined when either side is not X.Y.Z. */
export function compareAppVersions(left: string, right: string): number | undefined {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return undefined;
  return (
    leftParts[0] - rightParts[0] || leftParts[1] - rightParts[1] || leftParts[2] - rightParts[2]
  );
}

export function releasePlatformForUserAgent(userAgent: string): ReleasePlatform | undefined {
  if (userAgent.includes('Windows')) return 'windows-x64';
  if (userAgent.includes('Macintosh')) return 'macos-aarch64';
  return undefined;
}

/**
 * The manifest keeps one "latest" per platform, so a macOS-only release is
 * never offered to a Windows install.
 */
export function findAvailableUpdate(
  manifest: unknown,
  platform: ReleasePlatform,
  currentVersion: string,
): AvailableUpdate | undefined {
  if (typeof manifest !== 'object' || manifest === null) return undefined;
  const latest = (manifest as { latest?: unknown }).latest;
  if (typeof latest !== 'object' || latest === null) return undefined;
  const entry = (latest as Record<string, unknown>)[platform];
  if (typeof entry !== 'object' || entry === null) return undefined;
  const version = (entry as { version?: unknown }).version;
  if (typeof version !== 'string') return undefined;
  const order = compareAppVersions(version, currentVersion);
  return order !== undefined && order > 0 ? { version } : undefined;
}

export async function fetchAvailableUpdate(
  currentVersion: string,
  userAgent: string,
  signal: AbortSignal,
): Promise<AvailableUpdate | undefined> {
  const platform = releasePlatformForUserAgent(userAgent);
  if (!platform || currentVersion === DEVELOPMENT_BUILD_VERSION) return undefined;
  const response = await fetch(RELEASE_MANIFEST_URL, { signal, cache: 'no-store' });
  if (!response.ok) return undefined;
  const manifest: unknown = await response.json();
  return findAvailableUpdate(manifest, platform, currentVersion);
}
