/**
 * Doc RAG contracts — folder-scoped document indexing & retrieval for
 * flashcard generation. See docs/specs/doc-flashcards.md.
 *
 * Invariants: the sqlite index under `~/.piwin/doc-rag/` is a rebuildable
 * cache; cards are the truth. Supported file types come from the active
 * chunker (`supportedExtensions`), never a hardcoded list.
 */

/** A chunk of a document, produced by a `DocChunker`. */
export type DocChunk = {
  /** Path relative to the folder root (posix, no `..`). */
  filePath: string;
  content: string;
  /** 1-based inclusive start line. */
  startLine: number;
  /** 1-based inclusive end line. */
  endLine: number;
  language: string;
};

/** Splits file content into `DocChunk` units. Implementations live in `@piwin/doc-rag`. */
export type DocChunker = {
  /** Extensions this chunker can process. Dynamic — queried at runtime. */
  readonly supportedExtensions: readonly string[];
  /** Chunk a file's content into `DocChunk` units. */
  chunk(filePath: string, content: string): DocChunk[];
};

/** File discovered by scanning a folder. */
export type ScannedDocFile = {
  relativePath: string;
  sizeBytes: number;
  language: string;
};

/** Options for `FolderRag.retrieve` / `doccards/retrieve`. */
export type RetrieveOptions = {
  /** Default 10. */
  limit?: number;
  /**
   * Relative paths; when non-empty, only chunks from these files are
   * eligible. An empty array is an error (caller must omit to mean "all").
   */
  fileAllowlist?: string[];
  /** Default 24_000 — token-budget proxy; truncates by whole chunks. */
  maxTotalChars?: number;
  signal?: AbortSignal;
};

/** A retrieved chunk with ranking metadata. */
export type RetrievedChunk = DocChunk & {
  score: number;
  snippet: string;
};

/** Options for `FolderRag.indexFolder` / `doccards/index-folder`. */
export type IndexFolderOptions = {
  /** If set, only chunk these relative paths. Empty array is an error. */
  includeFiles?: string[];
  signal?: AbortSignal;
};

/** Result of `doccards/index-folder`. */
export type IndexFolderResult = {
  indexed: number;
  chunks: number;
  /** True ⇒ FTS-only (no embedding provider configured). */
  degraded: boolean;
  skipped: number;
  warnings: string[];
};

/** Result of `doccards/retrieve`. */
export type RetrieveResult = {
  chunks: RetrievedChunk[];
  /** Canonical absolute path of the folder (for sourceFolder attribution). */
  canonicalPath: string;
  degraded: boolean;
};

/** Result of `doccards/scan-folder`. */
export type ScanFolderResult = {
  /** Currently supported files (checkbox candidates). */
  files: ScannedDocFile[];
  /** Visible-but-unusable types (PDF without MinerU, Office without Unstructured). */
  unsupported?: import('./doc-rag-v2.js').ScannedFileV2[];
  supportedExtensions: string[];
};

/** Result of `doccards/list-by-folder`. */
export type ListByFolderResult = {
  records: import('./flashcards.js').FlashcardRecord[];
  folderExists: boolean;
  canonicalPath: string;
};

/** Result of `doccards/open-source`. */
export type OpenSourceResult = {
  opened: boolean;
  /** Absolute path the host resolved (only after host-side validation). */
  path?: string;
};

/** Generation parameters used by the app to assemble the prompt. Not an IPC command. */
export type FlashcardGenerationParams = {
  folderPath?: string;
  fileSelection?: string[];
  topic?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  count?: 'fewer' | 'standard' | 'more';
};
