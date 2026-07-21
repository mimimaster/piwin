import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPiwinExtensionsDir } from './paths.js';

/**
 * Copy shipped extension modules into ~/.piwin/extensions (once; never overwrite).
 */
export async function ensureBundledExtensionsInstalled(
  piwinRoot: string,
  bundledRoot?: string,
): Promise<string[]> {
  const sourceRoot =
    bundledRoot ?? join(dirname(fileURLToPath(import.meta.url)), '../bundled-extensions');
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
    if (!entryName.endsWith('.ts')) {
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
