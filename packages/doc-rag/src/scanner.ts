import { readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type { ScanFolderResult, ScannedDocFile, ScannedFileV2 } from '@piwin/contracts';
import { detectLanguage } from './chunker.js';
import {
  DEFAULT_MAX_WALK_DEPTH,
  SKIP_DIR_NAMES,
  SKIP_FILE_NAME_PATTERNS,
} from './limits.js';
import { canonicalizeFolderPath } from './paths.js';
import type { ParserRegistry } from './parsers/registry.js';
import { createParserRegistry } from './parsers/registry.js';

export type ScanFolderOptions = {
  registry?: ParserRegistry;
};

export async function scanFolderFiles(
  folderPath: string,
  options: ScanFolderOptions = {},
): Promise<ScanFolderResult> {
  const canonical = await canonicalizeFolderPath(folderPath);
  if (!canonical) {
    throw new Error(`Folder not found: ${folderPath}`);
  }
  const registry = options.registry ?? createParserRegistry();
  const files: ScannedDocFile[] = [];
  const unsupported: ScannedFileV2[] = [];
  await walk(canonical, canonical, 0, registry, files, unsupported);
  return {
    files,
    ...(unsupported.length > 0 ? { unsupported } : {}),
    supportedExtensions: registry.getSupportedExtensions(),
  };
}

async function walk(
  root: string,
  current: string,
  depth: number,
  registry: ParserRegistry,
  files: ScannedDocFile[],
  unsupported: ScannedFileV2[],
): Promise<void> {
  if (depth > DEFAULT_MAX_WALK_DEPTH) return;
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      await walk(root, absolute, depth + 1, registry, files, unsupported);
      continue;
    }
    if (!entry.isFile()) continue;
    if (SKIP_FILE_NAME_PATTERNS.some((pattern) => pattern.test(entry.name))) continue;
    try {
      const stats = await stat(absolute);
      const relativePath = relative(root, absolute).split(sep).join('/');
      const classified = registry.classify({ relativePath, sizeBytes: stats.size });
      if (classified.support === 'supported') {
        files.push({
          relativePath,
          sizeBytes: stats.size,
          language: detectLanguage(relativePath),
        });
      } else if (classified.unsupportedReason !== 'UNSUPPORTED_FILE_TYPE') {
        unsupported.push(classified);
      }
    } catch {
      // Skip unreadable files at scan.
    }
  }
}
