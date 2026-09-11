/**
 * Host-owned pi-agent dir + one-way merge of missing Pi CLI oauth keys.
 * Only the default product root (~/.piwin) may ingest ~/.pi/agent/auth.json.
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getPiAgentDir, getPiwinPiAgentDir, getPiwinRoot, isDefaultPiwinRoot } from './paths.js';

export type ImportLegacyPiAuthResult = 'imported' | 'already-present' | 'skipped';

export async function ensureHostPiAgentDir(piwinRoot?: string): Promise<string> {
  const destinationDir = getPiwinPiAgentDir(getPiwinRoot(piwinRoot));
  await mkdir(destinationDir, { recursive: true });
  try {
    await chmod(destinationDir, 0o700);
  } catch {
    // Directory mode is best-effort on filesystems that reject chmod.
  }
  return destinationDir;
}

export async function importLegacyPiSubscriptionAuthIfNeeded(options: {
  piwinRoot?: string;
  legacyAuthPath?: string;
  defaultProductRoot?: string;
} = {}): Promise<ImportLegacyPiAuthResult> {
  const root = getPiwinRoot(options.piwinRoot);
  const destinationDir = await ensureHostPiAgentDir(root);
  const defaultProductRoot = options.defaultProductRoot ?? join(homedir(), '.piwin');
  if (!isDefaultPiwinRoot(root, defaultProductRoot)) {
    return 'skipped';
  }
  const destinationAuthPath = join(destinationDir, 'auth.json');
  const legacyAuthPath = options.legacyAuthPath ?? join(getPiAgentDir(), 'auth.json');
  const merged = await mergeMissingOauthProviderKeys({
    sourcePath: legacyAuthPath,
    destinationPath: destinationAuthPath,
  });
  return merged;
}

export async function mergeMissingOauthProviderKeys(options: {
  sourcePath: string;
  destinationPath: string;
}): Promise<ImportLegacyPiAuthResult> {
  const source = await readAuthObject(options.sourcePath);
  if (!source) {
    return 'skipped';
  }
  const destination = (await readAuthObject(options.destinationPath)) ?? {};
  const copiedIds = copyMissingOauthKeys(source, destination);
  if (copiedIds.length === 0) {
    return Object.keys(destination).length > 0 ? 'already-present' : 'skipped';
  }
  await writeFile(options.destinationPath, `${JSON.stringify(destination, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  try {
    await chmod(options.destinationPath, 0o600);
  } catch {
    // File mode is best-effort on filesystems that reject chmod.
  }
  return 'imported';
}

export function copyMissingOauthKeys(
  source: Record<string, unknown>,
  destination: Record<string, unknown>,
): string[] {
  const copied: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (!isOauthAuthEntry(value)) {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(destination, key)) {
      continue;
    }
    destination[key] = value;
    copied.push(key);
  }
  return copied;
}

export function listOauthProviderIds(auth: Record<string, unknown> | null): string[] {
  if (!auth) {
    return [];
  }
  return Object.entries(auth)
    .filter(([, value]) => isOauthAuthEntry(value))
    .map(([key]) => key);
}

export async function readAuthObject(pathValue: string): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(pathValue, 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isOauthAuthEntry(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.type === 'oauth' || record.kind === 'oauth';
}
