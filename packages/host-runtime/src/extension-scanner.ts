import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
  createDefaultExtensionsConfig,
  normalizeResourceId,
  type ExtensionSource,
  type ExtensionSummary,
  type ExtensionsConfig,
} from '@piwin/contracts';
import { createExtensionRevisionStore } from '@piwin/extensions';
import { getPiwinExtensionsDir } from './paths.js';

export type ScanExtensionsOptions = {
  piwinRoot: string;
  projectPath?: string;
  extensionsConfig?: ExtensionsConfig;
};

/**
 * List extension entry modules for UI/CLI without executing them.
 * Layout mirrors Pi: flat .ts files and package index.ts directories.
 */
export async function scanExtensions(options: ScanExtensionsOptions): Promise<ExtensionSummary[]> {
  const config = options.extensionsConfig ?? createDefaultExtensionsConfig();
  const disabled = new Set(config.disabledIds.map((id) => id.toLowerCase()));
  const results: ExtensionSummary[] = [];
  const managedIds = new Set<string>();
  const managedRecords = await createExtensionRevisionStore(options.piwinRoot).listRecords();
  for (const record of managedRecords) {
    const selected =
      record.revisions.find((revision) => revision.contentRevision === record.selectedRevision) ??
      [...record.revisions]
        .filter((revision) => revision.state === 'installed')
        .sort((left, right) => right.installedAt.localeCompare(left.installedAt))[0];
    if (!selected) continue;
    managedIds.add(record.id);
    results.push({
      id: record.id,
      name: record.name,
      description: record.description,
      source: 'user',
      path: selected.entryPath,
      enabled: record.configuredEnabled && selected.state === 'installed',
      managed: true,
      contentRevision: selected.contentRevision,
      ...(selected.version ? { version: selected.version } : {}),
      configuredEnabled: record.configuredEnabled,
      ...(record.selectedRevision ? { selectedRevision: record.selectedRevision } : {}),
    });
  }
  const roots: Array<{ path: string; source: ExtensionSource }> = [
    { path: getPiwinExtensionsDir(options.piwinRoot), source: 'user' },
  ];
  if (options.projectPath) {
    roots.push({
      path: join(options.projectPath, '.pi', 'extensions'),
      source: 'project',
    });
  }
  for (const extra of config.extraPaths) {
    if (extra.trim().length > 0) {
      roots.push({ path: expandHome(extra), source: 'mapped' });
    }
  }

  for (const rootEntry of roots) {
    for (const extension of await scanExtensionRoot(rootEntry.path, rootEntry.source)) {
      // A managed user revision is authoritative for its id. Project/mapped
      // resources remain visible so precedence diagnostics can explain a
      // collision instead of silently deleting project intent.
      if (extension.source === 'user' && managedIds.has(extension.id)) {
        continue;
      }
      const enabled = !disabled.has(extension.id.toLowerCase());
      results.push({ ...extension, enabled, configuredEnabled: enabled });
    }
  }

  return results.sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Collect absolute entry paths Pi should receive as additionalExtensionPaths.
 * Disabled ids are excluded here so ResourceLoader never loads them.
 */
export function collectExtensionEntryPaths(options: {
  piwinRoot: string;
  projectPath?: string;
  extraPaths?: string[];
  disabledIds?: string[];
  discovered: ExtensionSummary[];
}): string[] {
  const disabled = new Set((options.disabledIds ?? []).map((id) => id.toLowerCase()));
  const paths: string[] = [];
  const seenIds = new Set<string>();
  for (const extension of options.discovered) {
    if (!extension.enabled || (!extension.managed && disabled.has(extension.id.toLowerCase()))) {
      continue;
    }
    const id = extension.id.toLowerCase();
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    paths.push(extension.path);
  }
  return [...new Set(paths)];
}

async function scanExtensionRoot(
  rootPath: string,
  source: ExtensionSource,
): Promise<ExtensionSummary[]> {
  const absoluteRoot = resolve(expandHome(rootPath));
  let entries: string[] = [];
  try {
    entries = await readdir(absoluteRoot);
  } catch {
    return [];
  }

  if (source === 'mapped') {
    const single = await tryReadExtensionEntry(absoluteRoot, source);
    if (single) {
      return [single];
    }
  }

  const extensions: ExtensionSummary[] = [];
  for (const entryName of entries) {
    const entryPath = join(absoluteRoot, entryName);
    let entryStat;
    try {
      entryStat = await stat(entryPath);
    } catch {
      continue;
    }
    if (entryStat.isFile() && entryName.endsWith('.ts') && !entryName.endsWith('.d.ts')) {
      const nameHint = entryName.slice(0, -3);
      const parsed = await buildExtensionSummary(entryPath, nameHint, source);
      if (parsed) {
        extensions.push(parsed);
      }
      continue;
    }
    if (entryStat.isDirectory()) {
      const indexPath = join(entryPath, 'index.ts');
      try {
        if ((await stat(indexPath)).isFile()) {
          const parsed = await buildExtensionSummary(indexPath, entryName, source, entryPath);
          if (parsed) {
            extensions.push(parsed);
          }
        }
      } catch {
        // no index.ts
      }
    }
  }
  return extensions;
}

async function tryReadExtensionEntry(
  absolutePath: string,
  source: ExtensionSource,
): Promise<ExtensionSummary | null> {
  try {
    const entryStat = await stat(absolutePath);
    if (entryStat.isFile() && absolutePath.endsWith('.ts')) {
      const name = basename(absolutePath).slice(0, -3);
      return buildExtensionSummary(absolutePath, name, source);
    }
    if (entryStat.isDirectory()) {
      const indexPath = join(absolutePath, 'index.ts');
      try {
        if ((await stat(indexPath)).isFile()) {
          return buildExtensionSummary(indexPath, basename(absolutePath), source, absolutePath);
        }
      } catch {
        return null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function buildExtensionSummary(
  entryPath: string,
  nameHint: string,
  source: ExtensionSource,
  directoryPath?: string,
): Promise<ExtensionSummary | null> {
  const name = nameHint.trim();
  if (!name) {
    return null;
  }
  const id = normalizeResourceId(name);
  const description = await readExtensionDescription(entryPath);
  const pathForLoader = directoryPath ?? entryPath;
  const resolvedSource: ExtensionSource =
    source === 'user' && (await isBundledMarker(entryPath)) ? 'bundled' : source;
  return {
    id,
    name,
    description,
    source: resolvedSource,
    path: pathForLoader,
    enabled: true,
    configuredEnabled: true,
  };
}

async function isBundledMarker(entryPath: string): Promise<boolean> {
  try {
    const raw = await readFile(entryPath, 'utf8');
    return raw.includes('@piwin-bundled-extension');
  } catch {
    return false;
  }
}

async function readExtensionDescription(entryPath: string): Promise<string> {
  try {
    const raw = await readFile(entryPath, 'utf8');
    const start = raw.indexOf('/**');
    const end = start === -1 ? -1 : raw.indexOf('*/', start + 3);
    if (start !== -1 && end !== -1) {
      const body = raw.slice(start + 3, end);
      const lines = body
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('*')) {
            return trimmed.slice(1).trim();
          }
          return trimmed;
        })
        .filter((line) => line.length > 0 && !line.startsWith('@'));
      if (lines[0]) {
        return lines[0];
      }
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//')) {
        const comment = trimmed.slice(2).trim();
        if (comment.length > 0) {
          return comment;
        }
      }
    }
  } catch {
    // ignore
  }
  return '(extension)';
}

function expandHome(pathValue: string): string {
  if (pathValue.startsWith('~/')) {
    return join(homedir(), pathValue.slice(2));
  }
  return pathValue;
}
