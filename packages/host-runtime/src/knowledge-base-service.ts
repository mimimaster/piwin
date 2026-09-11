/**
 * Knowledge-base registry operations + derived summaries.
 * Host-runtime owns this; commands and tools share it.
 */
import { mkdir, stat } from 'node:fs/promises';
import {
  NOTES_KNOWLEDGE_BASE_ID,
  parseKnowledgeBaseId,
  type KnowledgeBaseKind,
  type KnowledgeBaseSummary,
  type PiwinConfig,
} from '@piwin/contracts';
import {
  canonicalizeFolderPath,
  folderKey,
  type FolderRag,
} from '@piwin/doc-rag';
import { getNotesRoot, type NoteStore } from '@piwin/notes';
import type { CardStore } from '@piwin/flashcards';
import {
  defaultFolderBaseName,
  findFolderRecord,
  findFolderRecordById,
  folderRecordId,
  loadKnowledgeBaseRegistry,
  recoverKnowledgeBaseRegistry,
  saveKnowledgeBaseRegistry,
  type KnowledgeBaseRegistryRecord,
} from './knowledge-base-registry.js';
import { deriveFolderKnowledgeBaseState } from './knowledge-base-state.js';
import { getPiwinRoot } from './paths.js';

export const NOTES_KNOWLEDGE_BASE_NAME = 'Notes';

export type NotesServices = {
  store: NoteStore;
};

export type KnowledgeBaseRuntime = {
  piwinRoot?: string;
  getFolderRag: () => Promise<FolderRag>;
  getNotesServices?: () => Promise<NotesServices>;
  loadConfig: () => Promise<PiwinConfig>;
  isIndexing?: (folderKey: string) => boolean;
  getCardStore?: () => Promise<CardStore>;
};

export async function listKnowledgeBaseSummaries(
  runtime: KnowledgeBaseRuntime,
): Promise<KnowledgeBaseSummary[]> {
  await recoverKnowledgeBaseRegistry(runtime.piwinRoot);
  const rag = await runtime.getFolderRag();
  const config = await runtime.loadConfig();
  const notesEnabled = config.notes?.enabled !== false;
  const document = await loadKnowledgeBaseRegistry(runtime.piwinRoot);
  const folders = await Promise.all(
    document.folders.map((record) =>
      summarizeBase(runtime, rag, {
        id: folderRecordId(record),
        kind: 'folder',
        name: record.name,
        folderPath: record.folderPath,
        ...(record.lastUsedAt ? { lastUsedAt: record.lastUsedAt } : {}),
        createdAt: record.createdAt,
      }),
    ),
  );
  const bases = [...folders];
  if (notesEnabled) {
    bases.unshift(
      await summarizeBase(runtime, rag, {
        id: NOTES_KNOWLEDGE_BASE_ID,
        kind: 'notes',
        name: NOTES_KNOWLEDGE_BASE_NAME,
        folderPath: getNotesRoot(getPiwinRoot(runtime.piwinRoot)),
      }),
    );
  }
  return sortKnowledgeBases(bases);
}

export async function addFolderKnowledgeBase(
  runtime: KnowledgeBaseRuntime,
  folderPath: string,
  name?: string,
): Promise<KnowledgeBaseSummary> {
  const trimmed = folderPath.trim();
  if (!trimmed) {
    throw new KnowledgeBaseCommandError('folderPath is required');
  }
  const canonical = await canonicalizeFolderPath(trimmed);
  if (!canonical) {
    throw new KnowledgeBaseCommandError(`Folder not found: ${trimmed}`);
  }
  const info = await stat(canonical);
  if (!info.isDirectory()) {
    throw new KnowledgeBaseCommandError(`Not a directory: ${trimmed}`);
  }
  await recoverKnowledgeBaseRegistry(runtime.piwinRoot);
  const document = await loadKnowledgeBaseRegistry(runtime.piwinRoot);
  const existing = findFolderRecord(document, canonical);
  const reAddedKey = folderKey(canonical);
  document.removed = document.removed.filter((item) => item.folderKey !== reAddedKey);
  if (existing) {
    await saveKnowledgeBaseRegistry(runtime.piwinRoot, document);
    return summarizeFolderBase(runtime, await runtime.getFolderRag(), existing);
  }
  const now = new Date().toISOString();
  const record: KnowledgeBaseRegistryRecord = {
    name: name?.trim() || defaultFolderBaseName(canonical),
    folderPath: canonical,
    createdAt: now,
  };
  document.folders.push(record);
  await saveKnowledgeBaseRegistry(runtime.piwinRoot, document);
  return summarizeFolderBase(runtime, await runtime.getFolderRag(), record);
}

export async function renameKnowledgeBase(
  runtime: KnowledgeBaseRuntime,
  baseId: string,
  name: string,
): Promise<KnowledgeBaseSummary> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new KnowledgeBaseCommandError('name is required');
  }
  const parsed = parseKnowledgeBaseId(baseId);
  if (!parsed) {
    throw new KnowledgeBaseCommandError(`Unknown knowledge base: ${baseId}`);
  }
  if (parsed.kind === 'notes') {
    throw new KnowledgeBaseCommandError('the notes knowledge base cannot be renamed');
  }
  await recoverKnowledgeBaseRegistry(runtime.piwinRoot);
  const document = await loadKnowledgeBaseRegistry(runtime.piwinRoot);
  const record = findFolderRecordById(document, baseId);
  if (!record) {
    throw new KnowledgeBaseCommandError(`Unknown knowledge base: ${baseId}`);
  }
  record.name = trimmed;
  await saveKnowledgeBaseRegistry(runtime.piwinRoot, document);
  return summarizeFolderBase(runtime, await runtime.getFolderRag(), record);
}

export async function removeKnowledgeBase(
  runtime: KnowledgeBaseRuntime,
  baseId: string,
  deleteIndex: boolean,
): Promise<void> {
  const parsed = parseKnowledgeBaseId(baseId);
  if (!parsed) {
    throw new KnowledgeBaseCommandError(`Unknown knowledge base: ${baseId}`);
  }
  if (parsed.kind === 'notes') {
    throw new KnowledgeBaseCommandError('the notes knowledge base cannot be removed');
  }
  await recoverKnowledgeBaseRegistry(runtime.piwinRoot);
  const document = await loadKnowledgeBaseRegistry(runtime.piwinRoot);
  const record = findFolderRecordById(document, baseId);
  if (!record) {
    throw new KnowledgeBaseCommandError(`Unknown knowledge base: ${baseId}`);
  }
  if (deleteIndex) {
    await deleteFolderIndex(runtime, record.folderPath);
  } else {
    const tombstoneKey = folderKey(record.folderPath);
    document.removed = document.removed.filter((item) => item.folderKey !== tombstoneKey);
    document.removed.push({ folderKey: tombstoneKey, removedAt: new Date().toISOString() });
  }
  document.folders = document.folders.filter((item) => item !== record);
  await saveKnowledgeBaseRegistry(runtime.piwinRoot, document);
}

export async function touchKnowledgeBases(
  runtime: KnowledgeBaseRuntime,
  baseIds: readonly string[],
): Promise<void> {
  const now = new Date().toISOString();
  const document = await loadKnowledgeBaseRegistry(runtime.piwinRoot);
  let changed = false;
  for (const baseId of baseIds) {
    const record = findFolderRecordById(document, baseId);
    if (!record) continue;
    record.lastUsedAt = now;
    changed = true;
  }
  if (changed) {
    await saveKnowledgeBaseRegistry(runtime.piwinRoot, document);
  }
}

export async function assertKnownKnowledgeBaseIds(
  runtime: KnowledgeBaseRuntime,
  baseIds: readonly string[],
): Promise<void> {
  const bases = await listKnowledgeBaseSummaries(runtime);
  const known = new Set(bases.map((base) => base.id));
  for (const baseId of baseIds) {
    if (!known.has(baseId)) {
      throw new KnowledgeBaseCommandError(`Unknown knowledge base: ${baseId}`);
    }
  }
}

export async function readMountedKnowledgeBaseNames(
  piwinRoot: string | undefined,
  sessionId: string,
  knowledgeBaseIds: readonly string[] | undefined,
): Promise<string[]> {
  if (!knowledgeBaseIds || knowledgeBaseIds.length === 0) return [];
  const document = await loadKnowledgeBaseRegistry(piwinRoot);
  const names: string[] = [];
  for (const baseId of knowledgeBaseIds) {
    if (baseId === NOTES_KNOWLEDGE_BASE_ID) {
      names.push(NOTES_KNOWLEDGE_BASE_NAME);
      continue;
    }
    const record = findFolderRecordById(document, baseId);
    names.push(record?.name ?? baseId);
  }
  return names;
}

export class KnowledgeBaseCommandError extends Error {
  override readonly name = 'KnowledgeBaseCommandError';
}

type SummarizableBase = {
  id: string;
  kind: KnowledgeBaseKind;
  name: string;
  folderPath: string;
  lastUsedAt?: string;
  createdAt?: string;
};

async function summarizeFolderBase(
  runtime: KnowledgeBaseRuntime,
  rag: FolderRag,
  record: KnowledgeBaseRegistryRecord,
): Promise<KnowledgeBaseSummary> {
  return summarizeBase(runtime, rag, {
    id: folderRecordId(record),
    kind: 'folder',
    name: record.name,
    folderPath: record.folderPath,
    ...(record.lastUsedAt ? { lastUsedAt: record.lastUsedAt } : {}),
    createdAt: record.createdAt,
  });
}

async function summarizeBase(
  runtime: KnowledgeBaseRuntime,
  rag: FolderRag,
  base: SummarizableBase,
): Promise<KnowledgeBaseSummary> {
  if (base.kind === 'notes') {
    await mkdir(base.folderPath, { recursive: true });
  }
  const pathExists = await folderPathExists(base.folderPath);
  const indexing = runtime.isIndexing?.(folderKey(base.folderPath)) === true;
  const documents =
    pathExists && (indexing || (await rag.isIndexed(base.folderPath)))
      ? await rag.listDocuments(base.folderPath)
      : [];
  const derived = deriveFolderKnowledgeBaseState({
    pathExists,
    indexing,
    hasEmbeddingProvider: rag.hasEmbeddingProvider,
    documents,
  });
  if (base.kind === 'notes' && derived.state === 'not-indexed') {
    // Notes has no manual ingest step, so "zero notes yet" must stay
    // distinguishable from "folder with unpicked files" — the desktop copy
    // for 'empty' ("ask the agent to take notes") vs 'not-indexed' ("pick
    // files to ingest") depends on this.
    derived.state = 'empty';
  }
  const summary: KnowledgeBaseSummary = {
    id: base.id,
    kind: base.kind,
    name: base.name,
    folderPath: base.folderPath,
    state: derived.state,
    degraded: derived.degraded,
    documentCount: derived.documentCount,
  };
  if (base.createdAt !== undefined) {
    summary.createdAt = base.createdAt;
  }
  if (derived.failedDocumentCount > 0) {
    summary.failedDocumentCount = derived.failedDocumentCount;
  }
  if (derived.chunkCount > 0) {
    summary.chunkCount = derived.chunkCount;
  }
  if (derived.lastIndexedAt !== undefined) {
    summary.lastIndexedAt = derived.lastIndexedAt;
  }
  if (base.lastUsedAt !== undefined) {
    summary.lastUsedAt = base.lastUsedAt;
  }
  return summary;
}

async function folderPathExists(folderPath: string): Promise<boolean> {
  const canonical = await canonicalizeFolderPath(folderPath);
  if (!canonical) return false;
  const info = await stat(canonical);
  return info.isDirectory();
}

async function deleteFolderIndex(
  runtime: KnowledgeBaseRuntime,
  folderPath: string,
): Promise<void> {
  const rag = await runtime.getFolderRag();
  await rag.forgetFolder(folderPath);
  if (!runtime.getCardStore) return;
  const store = await runtime.getCardStore();
  const canonical = (await canonicalizeFolderPath(folderPath)) ?? folderPath;
  await store.deleteBySourceFolder(canonical);
}

function sortKnowledgeBases(bases: KnowledgeBaseSummary[]): KnowledgeBaseSummary[] {
  return [...bases].sort((left, right) => {
    if (left.kind === 'notes' && right.kind !== 'notes') return -1;
    if (right.kind === 'notes' && left.kind !== 'notes') return 1;
    const leftUsed = left.lastUsedAt ?? '';
    const rightUsed = right.lastUsedAt ?? '';
    if (leftUsed !== rightUsed) return rightUsed.localeCompare(leftUsed);
    return left.name.localeCompare(right.name);
  });
}


