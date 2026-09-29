import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getPiwinExtensionsDir } from './paths.js';
import { resolveBundledAssetsRoot } from './bundled-assets-root.js';

/**
 * Copy shipped extension modules into ~/.piwin/extensions.
 *
 * Supports:
 * - single-file modules: `path-guard.ts` (installed once; refreshed only when
 *   the shipped `@piwin-bundled-version` is higher and the installed copy still
 *   carries the `@piwin-bundled-extension` marker — remove the marker to keep
 *   your own edits)
 * - package directories with `index.ts`: `pi-anthropic-auth/` (refresh when
 *   bundled package.json version / piwin.npmVersion differs)
 *
 * Bundled modules that are no longer in the ship set are removed from the
 * target (stale `compact.ts` next to `compact/`, or a package we stopped
 * vendoring). User-installed files without the bundled marker are left alone.
 */
export async function ensureBundledExtensionsInstalled(
  piwinRoot: string,
  bundledRoot?: string,
): Promise<string[]> {
  const sourceRoot =
    bundledRoot ??
    resolveBundledAssetsRoot({
      layoutPath: 'agent-host/bundled-extensions',
      moduleUrl: import.meta.url,
      relativeFallback: '../../agent-host/bundled-extensions',
    });
  const targetRoot = getPiwinExtensionsDir(piwinRoot);
  await mkdir(targetRoot, { recursive: true });

  let entries: string[] = [];
  try {
    entries = await readdir(sourceRoot);
  } catch {
    return [];
  }

  const installed: string[] = [];
  const shippedNames = new Set<string>();
  for (const entryName of entries) {
    const fromPath = join(sourceRoot, entryName);
    let entryStat;
    try {
      entryStat = await stat(fromPath);
    } catch {
      continue;
    }

    if (entryStat.isFile()) {
      if (!entryName.endsWith('.ts') || entryName.endsWith('.test.ts')) {
        continue;
      }
      shippedNames.add(entryName.replace(/\.ts$/i, ''));
      const toPath = join(targetRoot, entryName);
      if (!(await singleFileNeedsInstall(fromPath, toPath))) {
        continue;
      }
      try {
        await cp(fromPath, toPath);
        installed.push(entryName.replace(/\.ts$/i, ''));
      } catch {
        // best-effort
      }
      continue;
    }

    if (!entryStat.isDirectory()) {
      continue;
    }
    const indexTs = join(fromPath, 'index.ts');
    const indexJs = join(fromPath, 'index.js');
    const hasIndex = (await pathExists(indexTs)) || (await pathExists(indexJs));
    if (!hasIndex) {
      continue;
    }
    shippedNames.add(entryName);
    const toPath = join(targetRoot, entryName);
    const shouldRefresh = await packageNeedsRefresh(fromPath, toPath);
    if (!shouldRefresh) {
      continue;
    }
    try {
      await rm(toPath, { recursive: true, force: true });
      await cp(fromPath, toPath, { recursive: true });
      installed.push(entryName);
    } catch {
      // best-effort
    }
  }
  await removeUnshippedBundledExtensions(targetRoot, shippedNames);
  return installed;
}

async function removeUnshippedBundledExtensions(
  targetRoot: string,
  shippedNames: Set<string>,
): Promise<void> {
  let entries: string[] = [];
  try {
    entries = await readdir(targetRoot);
  } catch {
    return;
  }
  for (const entryName of entries) {
    const targetPath = join(targetRoot, entryName);
    let entryStat;
    try {
      entryStat = await stat(targetPath);
    } catch {
      continue;
    }
    if (entryStat.isFile() && entryName.endsWith('.ts') && !entryName.endsWith('.d.ts')) {
      const id = entryName.replace(/\.ts$/i, '');
      if (shippedNames.has(id)) {
        continue;
      }
      if (!(await fileLooksBundled(targetPath))) {
        continue;
      }
      try {
        await rm(targetPath, { force: true });
      } catch {
        // best-effort
      }
      continue;
    }
    if (!entryStat.isDirectory()) {
      continue;
    }
    if (shippedNames.has(entryName)) {
      continue;
    }
    if (!(await directoryLooksBundled(targetPath))) {
      continue;
    }
    try {
      await rm(targetPath, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  }
}

/**
 * A missing file installs. An existing one refreshes only while it is still
 * ours (bundled marker present) and older than what ships; a file without a
 * version tag counts as version 0.
 */
async function singleFileNeedsInstall(fromPath: string, toPath: string): Promise<boolean> {
  if (!(await pathExists(toPath))) {
    return true;
  }
  if (!(await fileLooksBundled(toPath))) {
    return false;
  }
  return (await readBundledVersion(fromPath)) > (await readBundledVersion(toPath));
}

const BUNDLED_VERSION_TAG = /@piwin-bundled-version\s+(\d+)/;

async function readBundledVersion(path: string): Promise<number> {
  try {
    const match = BUNDLED_VERSION_TAG.exec(await readFile(path, 'utf8'));
    return match?.[1] ? Number.parseInt(match[1], 10) : 0;
  } catch {
    return 0;
  }
}

async function fileLooksBundled(path: string): Promise<boolean> {
  try {
    const raw = await readFile(path, 'utf8');
    return raw.includes('@piwin-bundled-extension');
  } catch {
    return false;
  }
}

async function directoryLooksBundled(dir: string): Promise<boolean> {
  try {
    const raw = await readFile(join(dir, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { piwin?: { bundledFrom?: unknown } };
    if (typeof parsed.piwin?.bundledFrom === 'string' && parsed.piwin.bundledFrom.trim().length > 0) {
      return true;
    }
  } catch {
    // no package.json or unreadable
  }
  const indexTs = join(dir, 'index.ts');
  if ((await pathExists(indexTs)) && (await fileLooksBundled(indexTs))) {
    return true;
  }
  const indexJs = join(dir, 'index.js');
  return (await pathExists(indexJs)) && (await fileLooksBundled(indexJs));
}

async function packageNeedsRefresh(fromPath: string, toPath: string): Promise<boolean> {
  if (!(await pathExists(toPath))) {
    return true;
  }
  const fromVersion = await readPackageFingerprint(fromPath);
  const toVersion = await readPackageFingerprint(toPath);
  if (!fromVersion) {
    return false;
  }
  return fromVersion !== toVersion;
}

async function readPackageFingerprint(dir: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(dir, 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as {
      version?: unknown;
      piwin?: { npmVersion?: unknown; bundledFrom?: unknown; patch?: unknown };
    };
    const version = typeof parsed.version === 'string' ? parsed.version : '';
    const npmVersion =
      typeof parsed.piwin?.npmVersion === 'string' ? parsed.piwin.npmVersion : '';
    const from =
      typeof parsed.piwin?.bundledFrom === 'string' ? parsed.piwin.bundledFrom : '';
    // A piwin-local patch of a vendored package must refresh installs even
    // when the upstream npm version is unchanged.
    const patch =
      typeof parsed.piwin?.patch === 'number' && parsed.piwin.patch > 0
        ? `+piwin.${parsed.piwin.patch}`
        : '';
    const fingerprint = [from, `${npmVersion || version}${patch}`].filter(Boolean).join('@');
    return fingerprint || version || undefined;
  } catch {
    return undefined;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
