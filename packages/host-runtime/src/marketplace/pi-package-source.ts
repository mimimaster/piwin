/**
 * The only Pi package sources the Host installs on a user gesture: a valid npm
 * name (optionally pinned to an exact version), https://github.com/<o>/<r>, or
 * an existing absolute directory on the Host. Shared by
 * `marketplace/package-install` and the agent's `capability_install` (whose
 * catalog sources are never local).
 */
import { statSync } from 'node:fs';
import { isAbsolute, normalize } from 'node:path';
import type { MarketplacePiPackageSource } from '@piwin/contracts';
import { isExactNpmVersion, isNpmPackageName, normalizeRepositoryUrl } from '@piwin/marketplace';

const GITHUB_SEGMENT = /^[A-Za-z0-9_.-]+$/;

/**
 * Returns the Pi PackageManager source string (`npm:<name>[@<ver>]`,
 * `git:github.com/o/r`, or an absolute local directory).
 */
export function resolvePiPackageSource(
  source: MarketplacePiPackageSource,
): string {
  if (source.kind === 'npm') {
    const packageName = source.packageName.trim();
    if (!isNpmPackageName(packageName)) {
      throw new Error('Invalid npm package name');
    }
    if (source.version === undefined) {
      return `npm:${packageName}`;
    }
    if (!isExactNpmVersion(source.version)) {
      throw new Error('npm version must be an exact version like 1.2.3');
    }
    return `npm:${packageName}@${source.version.trim()}`;
  }

  if (source.kind === 'local') {
    return resolveLocalPackageDirectory(source.path);
  }

  const normalized = normalizeRepositoryUrl(source.repositoryUrl);
  if (!normalized) {
    throw new Error('Invalid GitHub repository URL');
  }
  const repository = new URL(normalized);
  const segments = repository.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (
    repository.protocol !== 'https:' ||
    repository.hostname.toLowerCase() !== 'github.com' ||
    segments.length !== 2 ||
    !segments[0] ||
    !segments[1] ||
    !GITHUB_SEGMENT.test(segments[0]) ||
    !GITHUB_SEGMENT.test(segments[1]) ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error('Only https://github.com/<owner>/<repository> package URLs are supported');
  }
  return `git:github.com/${segments[0]}/${segments[1]}`;
}

function resolveLocalPackageDirectory(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed || !isAbsolute(trimmed)) {
    throw new Error('Local package path must be an absolute directory on the Host');
  }
  const directory = normalize(trimmed);
  let isDirectory = false;
  try {
    isDirectory = statSync(directory).isDirectory();
  } catch {
    // Reported below as a user-facing error; the stat failure itself has no extra detail worth leaking.
  }
  if (!isDirectory) {
    throw new Error(`Local package directory not found on the Host: ${directory}`);
  }
  return directory;
}
