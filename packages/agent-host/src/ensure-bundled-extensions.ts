import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { getPiwinExtensionsDir } from './paths.js';
import { resolveBundledAssetsRoot } from './bundled-assets-root.js';

/**
 * Copy shipped extension modules into ~/.piwin/extensions (once; never overwrite).
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
      relativeFallback: '../bundled-extensions',
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
    if (!entryName.endsWith('.ts') || entryName.endsWith('.test.ts')) {
      continue;
    }
    const fromPath = join(sourceRoot, entryName);
    const toPath = join(targetRoot, entryName);
    try {
      if (!(await stat(fromPath)).isFile()) {
        continue;
      }
      try {
        await stat(toPath);
        continue;
      } catch {
        // missing target → copy
      }
      await cp(fromPath, toPath);
      installed.push(entryName.replace(/\.ts$/i, ''));
    } catch {
      // best-effort
    }
  }
  return installed;
}
