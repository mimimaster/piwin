/**
 * Derived knowledge-base state. Pure: no IO, never persisted.
 */
import type { DocumentIndexStatus, KnowledgeBaseState } from '@piwin/contracts';

export type FolderDocumentStateInput = {
  status: DocumentIndexStatus;
  indexedAt?: string;
  chunkCount?: number;
};

export type FolderKnowledgeBaseStateInput = {
  pathExists: boolean;
  indexing: boolean;
  hasEmbeddingProvider: boolean;
  documents: readonly FolderDocumentStateInput[];
};

export type DerivedFolderKnowledgeBaseState = {
  state: KnowledgeBaseState;
  degraded: boolean;
  documentCount: number;
  failedDocumentCount: number;
  chunkCount: number;
  lastIndexedAt?: string;
};

export type NotesKnowledgeBaseStateInput = {
  noteCount: number;
  hasEmbeddingProvider: boolean;
};

export type DerivedNotesKnowledgeBaseState = {
  state: 'empty' | 'ready';
  degraded: boolean;
  documentCount: number;
};

export function deriveFolderKnowledgeBaseState(
  input: FolderKnowledgeBaseStateInput,
): DerivedFolderKnowledgeBaseState {
  const readyCount = input.documents.filter((document) => document.status === 'READY').length;
  const failedDocumentCount = input.documents.filter(
    (document) => document.status === 'FAILED',
  ).length;
  const chunkCount = input.documents.reduce(
    (sum, document) => sum + (document.chunkCount ?? 0),
    0,
  );
  let lastIndexedAt: string | undefined;
  for (const document of input.documents) {
    if (!document.indexedAt) continue;
    if (!lastIndexedAt || document.indexedAt > lastIndexedAt) {
      lastIndexedAt = document.indexedAt;
    }
  }

  let state: KnowledgeBaseState;
  if (!input.pathExists) {
    state = 'missing';
  } else if (input.indexing) {
    state = 'indexing';
  } else if (failedDocumentCount > 0) {
    state = 'partial';
  } else if (readyCount > 0) {
    state = 'ready';
  } else {
    state = 'not-indexed';
  }

  const derived: DerivedFolderKnowledgeBaseState = {
    state,
    degraded: !input.hasEmbeddingProvider,
    documentCount: readyCount,
    failedDocumentCount,
    chunkCount,
  };
  if (lastIndexedAt !== undefined) {
    derived.lastIndexedAt = lastIndexedAt;
  }
  return derived;
}

export function deriveNotesKnowledgeBaseState(
  input: NotesKnowledgeBaseStateInput,
): DerivedNotesKnowledgeBaseState {
  return {
    state: input.noteCount > 0 ? 'ready' : 'empty',
    degraded: !input.hasEmbeddingProvider,
    documentCount: input.noteCount,
  };
}

export function isSearchableKnowledgeBaseState(state: KnowledgeBaseState): boolean {
  return state === 'ready' || state === 'partial';
}
