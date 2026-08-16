import type { DocChunkV2 } from '@piwin/contracts';

export type IndexedChunk = DocChunkV2 & {
  vector?: number[];
};

export type HybridQuery = {
  text: string;
  vector?: number[];
  folderKey: string;
  documentIds?: string[];
  limit?: number;
};

export type FtsQuery = {
  text: string;
  folderKey: string;
  documentIds?: string[];
  limit?: number;
};

export type RetrievalHit = {
  chunk: IndexedChunk;
  score: number;
  retrievedBy: 'hybrid' | 'fts';
};

export type DocIndexStore = {
  upsertChunks(chunks: IndexedChunk[]): Promise<void>;
  deleteByDocumentId(documentId: string): Promise<void>;
  hybridSearch(query: HybridQuery): Promise<RetrievalHit[]>;
  ftsSearch(query: FtsQuery): Promise<RetrievalHit[]>;
  getChunksByIds(ids: string[]): Promise<IndexedChunk[]>;
  hasDocument(documentId: string): Promise<boolean>;
  close(): Promise<void>;
};
