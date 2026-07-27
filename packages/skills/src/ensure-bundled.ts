import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveBundledAssetsRoot } from './bundled-assets-root.js';

export async function ensureBundledSkillsInstalled(
  piwinRoot: string,
  bundledRoot?: string,
): Promise<string[]> {
  const sourceRoot =
    bundledRoot ??
    resolveBundledAssetsRoot({
      layoutPath: 'skills',
      moduleUrl: import.meta.url,
      relativeFallback: '../../../skills',
    });
  const targetRoot = join(piwinRoot, 'skills');
  await mkdir(targetRoot, { recursive: true });
  let entries: string[] = [];
  try {
    entries = await readdir(sourceRoot);
  } catch {
    return [];
  }
  const installed: string[] = [];
  for (const entry of entries) {
    const from = join(sourceRoot, entry);
    const to = join(targetRoot, entry);
    try {
      if (!(await stat(from)).isDirectory()) continue;
      try {
        await stat(to);
        continue;
      } catch {
        /* copy */
      }
      await cp(from, to, { recursive: true });
      installed.push(entry);
    } catch {
      /* ignore */
    }
  }
  return installed;
}
