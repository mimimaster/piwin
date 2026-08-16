/**
 * Folder RAG orchestration: scan → chunk → index → retrieve.
 *
 * Spec §8.1, §9.1. The FolderRag instance owns one chunker + optional
 * embedding provider and can serve multiple folders (each gets its own
 * sqlite cache under `~/.piwin/doc-rag/<folder-key>/`).
 */
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  DocChunk,
  DocChunker,
  EmbeddingProvider,
  IndexFolderOptions,
  IndexFolderResult,
  RetrieveOptions,
  RetrievedChunk,
  ScanFolderResult,
} from '@piwin/contracts';
import type { FolderRag } from './doc-rag-types.js';
export type { FolderRag };
import { createDefaultChunker } from './chunker.js';
import { createParserRegistry, type ParserRegistry } from './parsers/registry.js';
import { scanFolderFiles } from './scanner.js';
import { adaptNotesEmbedding } from './embedding-adapter.js';
import { openDocIndex } from './doc-index.js';
import type { DocIndex } from './doc-index.js';
import type { DocIndexStore } from './indexing/doc-index-store.js';
import { openLanceDocIndex } from './indexing/lancedb-index.js';
import { writeParsedFolderIndex } from './indexing/write-folder-index.js';
import {
  canonicalizeFolderPath,
  folderKey,
  getDocIndexPath,
  getLanceDbPath,
  getSourcePathSidecar,
  isSafeRelativePath,
  isPathConfined,
} from './paths.js';
import { retrieveV2 } from './retrieval/retrieval-service.js';
import {
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
} from './limits.js';

export type CreateFolderRagOptions = {
  chunker?: DocChunker;
  embeddingProvider?: EmbeddingProvider;
  /** Default `~/.piwin`. */
  piwinRoot?: string;
  parserRegistry?: ParserRegistry;
};

export function createFolderRag(options: CreateFolderRagOptions = {}): FolderRag {
  const chunker = options.chunker ?? createDefaultChunker();
  const embeddingProvider = options.embeddingProvider;
  const piwinRoot = options.piwinRoot;
  const parserRegistry = options.parserRegistry ?? createParserRegistry();
  // Open index lazily per folder; cache by canonical path.
  const indexCache = new Map<string, DocIndex>();
  const lanceCache = new Map<string, DocIndexStore>();
  // Serialize write access per canonical folder key to avoid concurrent
  // indexing corrupting the sqlite cache.
  const indexLocks = new Map<string, Promise<void>>();

  async function withIndexLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = indexLocks.get(key) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    indexLocks.set(key, current);
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async function getIndex(canonicalPath: string): Promise<DocIndex> {
    const cached = indexCache.get(canonicalPath);
    if (cached) return cached;
    const indexPath = getDocIndexPath(canonicalPath, piwinRoot);
    const index = await openDocIndex(indexPath);
    indexCache.set(canonicalPath, index);
    // Persist the .source-path sidecar for cleanup/debug.
    try {
      await writeFile(getSourcePathSidecar(canonicalPath, piwinRoot), canonicalPath, 'utf8');
    } catch {
      // Non-fatal — sidecar is a debug aid.
    }
    return index;
  }

  async function getLance(canonicalPath: string): Promise<DocIndexStore> {
    const cached = lanceCache.get(canonicalPath);
    if (cached) return cached;
    const store = await openLanceDocIndex(getLanceDbPath(canonicalPath, piwinRoot));
    lanceCache.set(canonicalPath, store);
    try {
      await writeFile(getSourcePathSidecar(canonicalPath, piwinRoot), canonicalPath, 'utf8');
    } catch {
      // sidecar is a debug aid
    }
    return store;
  }

  async function scanFolder(folderPath: string): Promise<ScanFolderResult> {
    return scanFolderFiles(folderPath, { registry: parserRegistry });
  }

  async function indexFolder(
    folderPath: string,
    indexOptions?: IndexFolderOptions,
  ): Promise<IndexFolderResult> {
    const canonical = await canonicalizeFolderPath(folderPath);
    if (!canonical) {
      throw new Error(`Folder not found: ${folderPath}`);
    }
    const includeFiles = indexOptions?.includeFiles;
    if (includeFiles && includeFiles.length === 0) {
      throw new Error('includeFiles must be omitted or non-empty');
    }
    return withIndexLock(canonical, async () => {
      const scanned = await scanFolder(canonical);
      let files = scanned.files;
      if (includeFiles) {
        const include = new Set(includeFiles);
        files = files.filter((file) => include.has(file.relativePath));
      }
      const warnings: string[] = [];
      let totalBytes = 0;
      let skipped = 0;
      const chunks: DocChunk[] = [];
      const acceptedPaths: string[] = [];
      let indexed = 0;
      for (const file of files) {
        if (indexed >= DEFAULT_MAX_FILES) {
          warnings.push(`Reached max files (${DEFAULT_MAX_FILES}); stopping.`);
          break;
        }
        if (file.sizeBytes > DEFAULT_MAX_FILE_BYTES) {
          skipped += 1;
          warnings.push(`Skipped (too large): ${file.relativePath}`);
          continue;
        }
        if (totalBytes + file.sizeBytes > DEFAULT_MAX_TOTAL_BYTES) {
          warnings.push(`Reached total byte limit (${DEFAULT_MAX_TOTAL_BYTES}); stopping.`);
          break;
        }
        const absolute = join(canonical, file.relativePath);
        try {
          const content = await readFile(absolute, 'utf8');
          const fileChunks = chunker.chunk(file.relativePath, content);
          chunks.push(...fileChunks);
          acceptedPaths.push(file.relativePath);
          totalBytes += file.sizeBytes;
          indexed += 1;
          if (indexOptions?.signal?.aborted) {
            warnings.push('Aborted by signal.');
            break;
          }
        } catch (error) {
          skipped += 1;
          warnings.push(`Skipped (read error): ${file.relativePath}: ${(error as Error).message}`);
        }
      }
      const index = await getIndex(canonical);
      await index.indexChunks(chunks);
      const lance = await getLance(canonical);
      await writeParsedFolderIndex({
        canonicalPath: canonical,
        relativePaths: acceptedPaths,
        registry: parserRegistry,
        store: lance,
        ...(embeddingProvider ? { embedding: adaptNotesEmbedding(embeddingProvider) } : {}),
        ...(indexOptions?.signal ? { signal: indexOptions.signal } : {}),
      });
      return {
        indexed,
        chunks: chunks.length,
        degraded: !embeddingProvider,
        skipped,
        warnings,
      };
    });
  }

  async function retrieve(
    folderPath: string,
    query: string,
    retrieveOptions?: RetrieveOptions,
  ): Promise<RetrievedChunk[]> {
    const canonical = await canonicalizeFolderPath(folderPath);
    if (!canonical) {
      throw new Error(`Folder not found: ${folderPath}`);
    }
    const fileAllowlist = retrieveOptions?.fileAllowlist;
    if (fileAllowlist && fileAllowlist.length === 0) {
      throw new Error('fileAllowlist must be omitted or non-empty');
    }
    if (fileAllowlist) {
      for (const relative of fileAllowlist) {
        if (!isSafeRelativePath(relative)) {
          throw new Error(`Invalid fileAllowlist entry: ${relative}`);
        }
        if (!(await isPathConfined(canonical, relative))) {
          throw new Error(`fileAllowlist entry outside folder: ${relative}`);
        }
      }
    }
    const lance = await getLance(canonical);
    const result = await retrieveV2({
      store: lance,
      folderKey: folderKey(canonical),
      query,
      ...(fileAllowlist ? { fileAllowlist } : {}),
      ...(retrieveOptions?.limit !== undefined ? { limit: retrieveOptions.limit } : {}),
      ...(embeddingProvider ? { embedding: adaptNotesEmbedding(embeddingProvider) } : {}),
      ...(retrieveOptions?.signal ? { signal: retrieveOptions.signal } : {}),
    });
    return result.pack.sources.map((source) => ({
      filePath: source.relativePath,
      content: source.text,
      startLine: source.startLine ?? 1,
      endLine: source.endLine ?? source.startLine ?? 1,
      language: '',
      score: source.retrievalScore ?? 0,
      snippet: source.text.slice(0, 200),
    }));
  }

  async function isIndexed(folderPath: string): Promise<boolean> {
    const canonical = await canonicalizeFolderPath(folderPath);
    if (!canonical) return false;
    try {
      await readFile(getSourcePathSidecar(canonical, piwinRoot), 'utf8');
      return true;
    } catch {
      return false;
    }
  }

  return {
    get hasEmbeddingProvider() {
      return embeddingProvider !== undefined;
    },
    scanFolder,
    indexFolder,
    retrieve,
    isIndexed,
    close: () => {
      for (const index of indexCache.values()) {
        index.close();
      }
      indexCache.clear();
      for (const store of lanceCache.values()) {
        void store.close();
      }
      lanceCache.clear();
      indexLocks.clear();
    },
  };
}
