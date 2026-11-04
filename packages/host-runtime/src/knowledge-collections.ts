/**
 * Topic collections for the knowledge workspace
 * (`<piwinRoot>/knowledge/collections.json`).
 *
 * Read-only until the materials library adds membership, but the on-disk shape
 * is frozen now so that writer never has to migrate existing user data.
 *
 * Invariants:
 * - A missing file is an empty set; a corrupt file is an error, never an empty
 *   overwrite. Collections are user data, not rebuildable index data.
 * - Counts are derived from membership on every read, so a stale count can
 *   never disagree with the members it describes.
 * - Tenant isolation is by `piwinRoot`; there is no global default.
 */
import { readFile } from 'node:fs/promises';
import type {
  KnowledgeCollection,
  KnowledgeCollectionCounts,
  KnowledgeContentId,
} from '@piwin/contracts';
import { getPiwinKnowledgeCollectionsPath, getPiwinRoot } from './paths.js';

export const KNOWLEDGE_COLLECTIONS_VERSION = 1;

export type StoredKnowledgeCollection = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  members: KnowledgeContentId[];
};

export type StoredKnowledgeCollectionsDocument = {
  version: number;
  collections: StoredKnowledgeCollection[];
};

export class KnowledgeCollectionsError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KnowledgeCollectionsError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function parseContentId(value: unknown): KnowledgeContentId | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case 'notes': {
      const noteId = nonEmptyString(value.noteId);
      return noteId ? { kind: 'notes', noteId } : null;
    }
    case 'material': {
      const baseId = nonEmptyString(value.baseId);
      const relativePath = nonEmptyString(value.relativePath);
      return baseId && relativePath ? { kind: 'material', baseId, relativePath } : null;
    }
    case 'wiki': {
      const relativePath = nonEmptyString(value.relativePath);
      return relativePath ? { kind: 'wiki', relativePath } : null;
    }
    case 'card': {
      const itemId = nonEmptyString(value.itemId);
      return itemId ? { kind: 'card', itemId } : null;
    }
    // A newer Host may write kinds this build does not know. Dropping them
    // keeps the counts honest instead of failing the whole listing.
    default:
      return null;
  }
}

function parseCollection(value: unknown): StoredKnowledgeCollection | null {
  if (!isRecord(value)) return null;
  const id = nonEmptyString(value.id);
  const name = nonEmptyString(value.name);
  const createdAt = nonEmptyString(value.createdAt);
  const updatedAt = nonEmptyString(value.updatedAt);
  if (!id || !name || !createdAt || !updatedAt) return null;
  const members: KnowledgeContentId[] = [];
  if (Array.isArray(value.members)) {
    for (const raw of value.members) {
      const id_ = parseContentId(raw);
      if (id_) members.push(id_);
    }
  }
  return { id, name, createdAt, updatedAt, members };
}

function emptyCounts(): KnowledgeCollectionCounts {
  return { notes: 0, materials: 0, wiki: 0, cards: 0 };
}

/** Counts one member once per collection; membership is never duplicated on read. */
export function knowledgeCollectionCounts(
  members: readonly KnowledgeContentId[],
): KnowledgeCollectionCounts {
  const counts = emptyCounts();
  const seen = new Set<string>();
  for (const member of members) {
    const key = contentIdKey(member);
    if (seen.has(key)) continue;
    seen.add(key);
    counts[countKeyOf(member.kind)] += 1;
  }
  return counts;
}

/** `material` / `card` are the identity kinds; the count keys are plural. */
function countKeyOf(kind: KnowledgeContentId['kind']): keyof KnowledgeCollectionCounts {
  switch (kind) {
    case 'notes':
      return 'notes';
    case 'material':
      return 'materials';
    case 'wiki':
      return 'wiki';
    case 'card':
      return 'cards';
  }
}

function contentIdKey(id: KnowledgeContentId): string {
  switch (id.kind) {
    case 'notes':
      return `notes:${id.noteId}`;
    case 'material':
      return `material:${id.baseId}/${id.relativePath}`;
    case 'wiki':
      return `wiki:${id.relativePath}`;
    case 'card':
      return `card:${id.itemId}`;
  }
}

function parseDocument(raw: string, filePath: string): StoredKnowledgeCollectionsDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    throw new KnowledgeCollectionsError(`Knowledge collections file is corrupt: ${filePath}`, {
      cause: error,
    });
  }
  if (!isRecord(parsed)) {
    throw new KnowledgeCollectionsError(`Knowledge collections file is corrupt: ${filePath}`);
  }
  if (parsed.version !== undefined && parsed.version !== KNOWLEDGE_COLLECTIONS_VERSION) {
    throw new KnowledgeCollectionsError(
      `Knowledge collections file has unsupported version ${String(parsed.version)}: ${filePath}`,
    );
  }
  const collections: StoredKnowledgeCollection[] = [];
  if (Array.isArray(parsed.collections)) {
    for (const raw of parsed.collections) {
      const collection = parseCollection(raw);
      if (collection) collections.push(collection);
    }
  }
  return { version: KNOWLEDGE_COLLECTIONS_VERSION, collections };
}

/** Reads the stored document; a never-created file is an empty document. */
export async function readKnowledgeCollections(
  piwinRoot?: string,
): Promise<StoredKnowledgeCollectionsDocument> {
  const filePath = getPiwinKnowledgeCollectionsPath(getPiwinRoot(piwinRoot));
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: KNOWLEDGE_COLLECTIONS_VERSION, collections: [] };
    }
    throw error;
  }
  return parseDocument(raw, filePath);
}

/** Public read model: ids, names, timestamps and derived per-kind counts. */
export async function listKnowledgeCollections(
  piwinRoot?: string,
): Promise<KnowledgeCollection[]> {
  const document = await readKnowledgeCollections(piwinRoot);
  return document.collections
    .map((collection) => ({
      id: collection.id,
      name: collection.name,
      counts: knowledgeCollectionCounts(collection.members),
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}
