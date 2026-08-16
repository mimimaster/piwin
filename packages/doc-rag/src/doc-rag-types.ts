/**
 * Package-local types for `@piwin/doc-rag`.
 * Contract-level types live in `@piwin/contracts`; this file only adds the
 * `FolderRag` orchestrator surface that ties them together.
 */
import type {
  DocumentManifest,
  IndexFolderOptions,
  IndexFolderResult,
  RetrieveOptions,
  RetrievedChunk,
  ScanFolderResult,
} from '@piwin/contracts';

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
  listDocuments(folderPath: string): Promise<DocumentManifest[]>;
  isIndexed(folderPath: string): Promise<boolean>;
  close(): void;
};
