import { cp, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getPiwinExtensionsDir } from './paths.js';
import { resolveBundledAssetsRoot } from './bundled-assets-root.js';

/**
 * Copy shipped extension modules into ~/.piwin/extensions.
 *
 * Supports:
 * - single-file modules: `path-guard.ts` (install once; never overwrite)
 * - package directories with `index.ts`: `pi-anthropic-auth/` (refresh when
 *   bundled package.json version / piwin.npmVersion differs)
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
      const toPath = join(targetRoot, entryName);
      if (await pathExists(toPath)) {
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
  return installed;
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
      piwin?: { npmVersion?: unknown; bundledFrom?: unknown };
    };
    const version = typeof parsed.version === 'string' ? parsed.version : '';
    const npmVersion =
      typeof parsed.piwin?.npmVersion === 'string' ? parsed.piwin.npmVersion : '';
    const from =
      typeof parsed.piwin?.bundledFrom === 'string' ? parsed.piwin.bundledFrom : '';
    const fingerprint = [from, npmVersion || version].filter(Boolean).join('@');
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
