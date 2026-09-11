/**
 * Durable folder knowledge-base registry (`<piwinRoot>/knowledge/bases.json`).
 * Notes are implicit and never stored here. Derived state is never persisted.
 */
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { writeTextFileAtomic } from '@piwin/session';
import { canonicalizeFolderPath, folderKey, listSourcePathSidecars } from '@piwin/doc-rag';
import { folderKnowledgeBaseId } from '@piwin/contracts';
import { getNotesRoot } from '@piwin/notes';
import { getPiwinKnowledgeBasesPath, getPiwinRoot } from './paths.js';

export const KNOWLEDGE_BASE_REGISTRY_VERSION = 1;

export type KnowledgeBaseRegistryRecord = {
  name: string;
  folderPath: string;
  createdAt: string;
  lastUsedAt?: string;
};

export type KnowledgeBaseRemovedRecord = {
  folderKey: string;
  removedAt: string;
};

export type KnowledgeBaseRegistryDocument = {
  version: number;
  folders: KnowledgeBaseRegistryRecord[];
  removed: KnowledgeBaseRemovedRecord[];
};

const writeChains = new Map<string, Promise<void>>();

function emptyDocument(): KnowledgeBaseRegistryDocument {
  return { version: KNOWLEDGE_BASE_REGISTRY_VERSION, folders: [], removed: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFolderRecord(value: unknown): KnowledgeBaseRegistryRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.name !== 'string' || value.name.trim().length === 0) return null;
  if (typeof value.folderPath !== 'string' || value.folderPath.trim().length === 0) return null;
  if (typeof value.createdAt !== 'string' || value.createdAt.trim().length === 0) return null;
  const record: KnowledgeBaseRegistryRecord = {
    name: value.name.trim(),
    folderPath: value.folderPath.trim(),
    createdAt: value.createdAt,
  };
  if (typeof value.lastUsedAt === 'string' && value.lastUsedAt.trim().length > 0) {
    record.lastUsedAt = value.lastUsedAt;
  }
  return record;
}

function parseDocument(raw: string, filePath: string): KnowledgeBaseRegistryDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`Knowledge base registry is corrupt: ${filePath}`, { cause: error });
  }
  if (!isRecord(parsed)) {
    throw new Error(`Knowledge base registry is corrupt: ${filePath}`);
  }
  if (parsed.version !== undefined && parsed.version !== KNOWLEDGE_BASE_REGISTRY_VERSION) {
    throw new Error(
      `Knowledge base registry version ${String(parsed.version)} is not supported: ${filePath}`,
    );
  }
  if (parsed.folders !== undefined && !Array.isArray(parsed.folders)) {
    throw new Error(`Knowledge base registry is corrupt: ${filePath}`);
  }
  if (parsed.removed !== undefined && !Array.isArray(parsed.removed)) {
    throw new Error(`Knowledge base registry is corrupt: ${filePath}`);
  }
  const folders: KnowledgeBaseRegistryRecord[] = [];
  for (const item of parsed.folders ?? []) {
    const record = parseFolderRecord(item);
    if (!record) {
      throw new Error(`Knowledge base registry is corrupt: ${filePath}`);
    }
    folders.push(record);
  }
  const removed: KnowledgeBaseRemovedRecord[] = [];
  for (const item of parsed.removed ?? []) {
    const record = parseRemovedRecord(item);
    if (!record) {
      throw new Error(`Knowledge base registry is corrupt: ${filePath}`);
    }
    removed.push(record);
  }
  return { version: KNOWLEDGE_BASE_REGISTRY_VERSION, folders, removed };
}

function parseRemovedRecord(value: unknown): KnowledgeBaseRemovedRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.folderKey !== 'string' || value.folderKey.trim().length === 0) return null;
  if (typeof value.removedAt !== 'string' || value.removedAt.trim().length === 0) return null;
  return { folderKey: value.folderKey.trim(), removedAt: value.removedAt };
}

export function knowledgeBaseRegistryPath(piwinRoot?: string): string {
  return getPiwinKnowledgeBasesPath(getPiwinRoot(piwinRoot));
}

export async function loadKnowledgeBaseRegistry(
  piwinRoot?: string,
): Promise<KnowledgeBaseRegistryDocument> {
  const filePath = knowledgeBaseRegistryPath(piwinRoot);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNotFoundError(error)) return emptyDocument();
    throw error;
  }
  if (raw.trim().length === 0) return emptyDocument();
  return parseDocument(raw, filePath);
}

export async function saveKnowledgeBaseRegistry(
  piwinRoot: string | undefined,
  document: KnowledgeBaseRegistryDocument,
): Promise<void> {
  const filePath = knowledgeBaseRegistryPath(piwinRoot);
  const previous = writeChains.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    await mkdir(dirname(filePath), { recursive: true });
    await writeTextFileAtomic(
      filePath,
      `${JSON.stringify(
        {
          version: KNOWLEDGE_BASE_REGISTRY_VERSION,
          folders: document.folders,
          removed: document.removed,
        },
        null,
        2,
      )}\n`,
    );
  });
  writeChains.set(filePath, next);
  await next;
}

export function folderRecordId(record: KnowledgeBaseRegistryRecord): string {
  return folderKnowledgeBaseId(folderKey(record.folderPath));
}

export function findFolderRecord(
  document: KnowledgeBaseRegistryDocument,
  folderPath: string,
): KnowledgeBaseRegistryRecord | undefined {
  return document.folders.find((record) => record.folderPath === folderPath);
}

export function findFolderRecordById(
  document: KnowledgeBaseRegistryDocument,
  baseId: string,
): KnowledgeBaseRegistryRecord | undefined {
  return document.folders.find((record) => folderRecordId(record) === baseId);
}

/**
 * Register any `doc-rag/<folderKey>/.source-path` folders that are not already
 * in the registry. Idempotent. Missing source folders are still registered.
 * Returns whether the on-disk registry changed.
 */
export async function recoverKnowledgeBaseRegistry(piwinRoot?: string): Promise<boolean> {
  const document = await loadKnowledgeBaseRegistry(piwinRoot);
  const sidecars = await listSourcePathSidecars(getPiwinRoot(piwinRoot));
  const knownPaths = new Set(document.folders.map((record) => record.folderPath));
  const knownIds = new Set(document.folders.map((record) => folderRecordId(record)));
  const removedKeys = new Set(document.removed.map((record) => record.folderKey));
  const notesKey = await notesFolderKey(piwinRoot);
  const now = new Date().toISOString();
  let changed = false;
  for (const sidecar of sidecars) {
    if (removedKeys.has(sidecar.folderKey)) continue;
    if (notesKey !== undefined && sidecar.folderKey === notesKey) continue;
    const id = folderKnowledgeBaseId(sidecar.folderKey);
    if (knownPaths.has(sidecar.folderPath) || knownIds.has(id)) continue;
    const name = defaultFolderBaseName(sidecar.folderPath);
    document.folders.push({
      name,
      folderPath: sidecar.folderPath,
      createdAt: now,
    });
    knownPaths.add(sidecar.folderPath);
    knownIds.add(id);
    changed = true;
  }
  if (changed) {
    await saveKnowledgeBaseRegistry(piwinRoot, document);
  }
  return changed;
}

export async function notesFolderKey(piwinRoot?: string): Promise<string | undefined> {
  const notesRoot = getNotesRoot(getPiwinRoot(piwinRoot));
  const canonical = await canonicalizeFolderPath(notesRoot);
  if (!canonical) return undefined;
  return folderKey(canonical);
}

export function defaultFolderBaseName(folderPath: string): string {
  const trimmed = folderPath.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/).filter((part) => part.length > 0);
  const last = parts[parts.length - 1];
  return last && last.length > 0 ? last : 'folder';
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
