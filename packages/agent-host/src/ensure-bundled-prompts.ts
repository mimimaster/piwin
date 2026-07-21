import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPiwinPromptsDir } from './paths.js';

/**
 * Copy shipped prompt templates into ~/.piwin/prompts (once; never overwrite).
 */
export async function ensureBundledPromptsInstalled(
  piwinRoot: string,
  bundledRoot?: string,
): Promise<string[]> {
  const sourceRoot =
    bundledRoot ?? join(dirname(fileURLToPath(import.meta.url)), '../bundled-prompts');
  const targetRoot = getPiwinPromptsDir(piwinRoot);
  await mkdir(targetRoot, { recursive: true });

  let entries: string[] = [];
  try {
    entries = await readdir(sourceRoot);
  } catch {
    return [];
  }

  const installed: string[] = [];
  for (const entryName of entries) {
    if (!entryName.endsWith('.md')) {
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
        // missing → copy
      }
      await cp(fromPath, toPath);
      installed.push(entryName.replace(/\.md$/i, ''));
    } catch {
      // best-effort
    }
  }
  return installed;
}
