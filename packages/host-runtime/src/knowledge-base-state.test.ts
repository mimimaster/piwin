import { describe, expect, it } from 'vitest';
import {
  deriveFolderKnowledgeBaseState,
  isSearchableKnowledgeBaseState,
} from './knowledge-base-state.js';

describe('deriveFolderKnowledgeBaseState', () => {
  const indexed = {
    status: 'READY' as const,
    indexedAt: '2026-09-01T00:00:00.000Z',
    chunkCount: 4,
  };

  it('marks missing paths before any index state', () => {
    expect(
      deriveFolderKnowledgeBaseState({
        pathExists: false,
        indexing: true,
        hasEmbeddingProvider: true,
        documents: [indexed],
      }),
    ).toMatchObject({ state: 'missing', documentCount: 1, degraded: false });
  });

  it('marks indexing when a job is running', () => {
    expect(
      deriveFolderKnowledgeBaseState({
        pathExists: true,
        indexing: true,
        hasEmbeddingProvider: false,
        documents: [indexed],
      }),
    ).toMatchObject({ state: 'indexing', degraded: true, chunkCount: 4 });
  });

  it('marks partial when any document failed', () => {
    const derived = deriveFolderKnowledgeBaseState({
      pathExists: true,
      indexing: false,
      hasEmbeddingProvider: true,
      documents: [
        indexed,
        { status: 'FAILED', indexedAt: '2026-09-02T00:00:00.000Z', chunkCount: 0 },
      ],
    });
    expect(derived.state).toBe('partial');
    expect(derived.failedDocumentCount).toBe(1);
    expect(derived.lastIndexedAt).toBe('2026-09-02T00:00:00.000Z');
  });

  it('marks ready when every indexed document is READY', () => {
    expect(
      deriveFolderKnowledgeBaseState({
        pathExists: true,
        indexing: false,
        hasEmbeddingProvider: true,
        documents: [indexed],
      }).state,
    ).toBe('ready');
  });

  it('marks not-indexed when no READY documents exist', () => {
    expect(
      deriveFolderKnowledgeBaseState({
        pathExists: true,
        indexing: false,
        hasEmbeddingProvider: true,
        documents: [{ status: 'DISCOVERED' }],
      }),
    ).toMatchObject({ state: 'not-indexed', documentCount: 0, chunkCount: 0 });
  });
});

describe('isSearchableKnowledgeBaseState', () => {
  it('allows ready and partial only', () => {
    expect(isSearchableKnowledgeBaseState('ready')).toBe(true);
    expect(isSearchableKnowledgeBaseState('partial')).toBe(true);
    expect(isSearchableKnowledgeBaseState('indexing')).toBe(false);
    expect(isSearchableKnowledgeBaseState('empty')).toBe(false);
  });
});
