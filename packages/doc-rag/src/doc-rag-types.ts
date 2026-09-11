/**
 * Package-local types for `@piwin/doc-rag`.
 * Contract-level types live in `@piwin/contracts`; this file only adds the
 * `FolderRag` orchestrator surface that ties them together.
 */
import type {
  ContextPack,
  DocumentManifest,
  IndexFolderOptions,
  IndexFolderResult,
  RetrieveOptions,
  RetrievedChunk,
  ScanFolderResult,
} from '@piwin/contracts';
import type { IngestFileResult } from './indexing/ingestion-service.js';

/** Document row from the folder state store, including chunk counts. */
export type FolderDocumentRecord = DocumentManifest & { chunkCount: number };

/** Folder RAG orchestrator surface (spec §8.1). Lives in this package. */
export type FolderRag = {
  /** True when an embedding provider was supplied at creation time. */
  readonly hasEmbeddingProvider: boolean;
  scanFolder(folderPath: string): Promise<ScanFolderResult>;
  indexFolder(folderPath: string, options?: IndexFolderOptions): Promise<IndexFolderResult>;
  retrieve(
    folderPath: string,
    query: string,
    options?: RetrieveOptions,
  ): Promise<RetrievedChunk[]>;
  retrievePack(
    folderPath: string,
    query: string,
    options?: RetrieveOptions,
  ): Promise<ContextPack>;
  listDocuments(folderPath: string): Promise<FolderDocumentRecord[]>;
  isIndexed(folderPath: string): Promise<boolean>;
  /** Parse, embed, and upsert a single file. Serialized with `indexFolder` via the per-folder lock. */
  ingestFile(folderPath: string, relativePath: string): Promise<IngestFileResult>;
  /** Drop one document's chunks and state row. No-op if the folder is already gone. */
  forgetFile(folderPath: string, relativePath: string): Promise<void>;
  /** Close cached stores and delete `doc-rag/<folderKey>/`. */
  forgetFolder(folderPath: string): Promise<void>;
  close(): void;
};
