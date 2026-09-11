/**
 * Folder RAG orchestration: scan → ingest → retrieve.
 *
 * Index writes LanceDB only. Legacy sqlite / recursive chunker stay unused
 * on this path.
 */
import { writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  ContextPack,
  EmbeddingProvider,
  IndexFolderOptions,
  IndexFolderResult,
  RetrieveOptions,
  RetrievedChunk,
  ScanFolderResult,
  SharedReranker,
} from '@piwin/contracts';
import type { FolderRag } from './doc-rag-types.js';
export type { FolderRag };
import { createParserRegistry, type ParserRegistry } from './parsers/registry.js';
import { scanFolderFiles } from './scanner.js';
import { adaptNotesEmbedding } from './embedding-adapter.js';
import type { DocIndexStore } from './indexing/doc-index-store.js';
import { openLanceDocIndex } from './indexing/lancedb-index.js';
import { ingestSelectedFiles, type IngestFileResult } from './indexing/ingestion-service.js';
import { openFolderStateStore, type FolderStateStore } from './indexing/state-store.js';
import {
  canonicalizeFolderPath,
  canonicalizeFolderPathSync,
  documentIdFor,
  folderKey,
  getDocRagRoot,
  getLanceDbPath,
  getStateStorePath,
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
  embeddingProvider?: EmbeddingProvider;
  reranker?: SharedReranker;
  /** Default `~/.piwin`. */
  piwinRoot?: string;
  parserRegistry?: ParserRegistry;
};

export function createFolderRag(options: CreateFolderRagOptions = {}): FolderRag {
  const embeddingProvider = options.embeddingProvider;
  const reranker = options.reranker;
  const piwinRoot = options.piwinRoot;
  const parserRegistry = options.parserRegistry ?? createParserRegistry();
  const lanceCache = new Map<string, DocIndexStore>();
  const stateCache = new Map<string, FolderStateStore>();
  // Serialize write access per folder so concurrent Index jobs do not
  // interleave LanceDB upserts.
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

  async function getState(canonicalPath: string): Promise<FolderStateStore> {
    const cached = stateCache.get(canonicalPath);
    if (cached) return cached;
    const store = await openFolderStateStore(getStateStorePath(canonicalPath, piwinRoot));
    stateCache.set(canonicalPath, store);
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
      if (files.length === 0 && includeFiles) {
        throw new Error('NO_SUPPORTED_FILES');
      }
      const warnings: string[] = [];
      let totalBytes = 0;
      let skipped = 0;
      const acceptedPaths: string[] = [];
      for (const file of files) {
        if (acceptedPaths.length >= DEFAULT_MAX_FILES) {
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
          await stat(absolute);
          acceptedPaths.push(file.relativePath);
          totalBytes += file.sizeBytes;
          if (indexOptions?.signal?.aborted) {
            warnings.push('Aborted by signal.');
            break;
          }
        } catch (error) {
          skipped += 1;
          warnings.push(`Skipped (read error): ${file.relativePath}: ${(error as Error).message}`);
        }
      }
      const lance = await getLance(canonical);
      const state = await getState(canonical);
      const ingest =
        acceptedPaths.length > 0
          ? await ingestSelectedFiles({
              canonicalPath: canonical,
              relativePaths: acceptedPaths,
              registry: parserRegistry,
              store: lance,
              state,
              ...(embeddingProvider ? { embedding: adaptNotesEmbedding(embeddingProvider) } : {}),
              ...(indexOptions?.signal ? { signal: indexOptions.signal } : {}),
              ...(indexOptions?.onProgress ? { onProgress: indexOptions.onProgress } : {}),
            })
          : [];
      if (!includeFiles) {
        await removeOrphanDocuments(
          lance,
          state,
          new Set(scanned.files.map((file) => file.relativePath)),
        );
      }
      const failed = ingest.filter((item) => item.status === 'FAILED');
      const skippedIngest = ingest.filter((item) => item.status === 'SKIPPED').length;
      return {
        indexed: ingest.filter((item) => item.status === 'READY' || item.status === 'SKIPPED').length,
        chunks: ingest.reduce((sum, item) => sum + item.chunkCount, 0),
        degraded: !embeddingProvider,
        skipped: skipped + skippedIngest,
        failed: failed.length,
        warnings: [
          ...warnings,
          ...failed.map((item) => `${item.relativePath}: ${item.error ?? 'FAILED'}`),
        ],
      };
    });
  }

  async function retrievePack(
    folderPath: string,
    query: string,
    retrieveOptions?: RetrieveOptions,
  ): Promise<ContextPack> {
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
      ...(reranker ? { reranker } : {}),
      ...(retrieveOptions?.signal ? { signal: retrieveOptions.signal } : {}),
    });
    return result.pack;
  }

  async function retrieve(
    folderPath: string,
    query: string,
    retrieveOptions?: RetrieveOptions,
  ): Promise<RetrievedChunk[]> {
    const pack = await retrievePack(folderPath, query, retrieveOptions);
    return pack.sources.map((source) => ({
      filePath: source.relativePath,
      content: source.text,
      startLine: source.startLine ?? 1,
      endLine: source.endLine ?? source.startLine ?? 1,
      language: '',
      score: source.retrievalScore ?? 0,
      snippet: source.text.slice(0, 200),
    }));
  }

  async function listDocuments(folderPath: string) {
    const canonical = await canonicalizeFolderPath(folderPath);
    if (!canonical) return [];
    const state = await getState(canonical);
    return state.list();
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

  async function assertRelativePath(canonical: string, relativePath: string): Promise<void> {
    if (!isSafeRelativePath(relativePath) || !(await isPathConfined(canonical, relativePath))) {
      throw new Error(`Invalid relative path: ${relativePath}`);
    }
  }

  async function ingestFile(folderPath: string, relativePath: string): Promise<IngestFileResult> {
    const canonical = await canonicalizeFolderPath(folderPath);
    if (!canonical) {
      throw new Error(`Folder not found: ${folderPath}`);
    }
    await assertRelativePath(canonical, relativePath);
    return withIndexLock(canonical, async () => {
      const lance = await getLance(canonical);
      const state = await getState(canonical);
      const ingest = await ingestSelectedFiles({
        canonicalPath: canonical,
        relativePaths: [relativePath],
        registry: parserRegistry,
        store: lance,
        state,
        ...(embeddingProvider ? { embedding: adaptNotesEmbedding(embeddingProvider) } : {}),
      });
      const result = ingest[0];
      if (!result) {
        throw new Error(`ingestFile produced no result for ${relativePath}`);
      }
      return result;
    });
  }

  async function forgetFile(folderPath: string, relativePath: string): Promise<void> {
    const canonical = await canonicalizeFolderPath(folderPath);
    if (!canonical) return;
    await assertRelativePath(canonical, relativePath);
    await withIndexLock(canonical, async () => {
      const lance = await getLance(canonical);
      const state = await getState(canonical);
      const documentId = documentIdFor(folderKey(canonical), relativePath);
      await lance.deleteByDocumentId(documentId);
      state.delete(documentId);
    });
  }

  async function forgetFolder(folderPath: string): Promise<void> {
    const trimmed = folderPath.trim();
    if (!trimmed) {
      throw new Error('folderPath is required');
    }
    const canonical = (await canonicalizeFolderPath(trimmed)) ?? canonicalizeFolderPathSync(trimmed);
    const key = folderKey(canonical);
    const lance = lanceCache.get(canonical);
    if (lance) {
      lanceCache.delete(canonical);
      await lance.close();
    }
    const state = stateCache.get(canonical);
    if (state) {
      stateCache.delete(canonical);
      state.close();
    }
    indexLocks.delete(canonical);
    await rm(resolve(getDocRagRoot(piwinRoot), key), { recursive: true, force: true });
  }

  return {
    get hasEmbeddingProvider() {
      return embeddingProvider !== undefined;
    },
    scanFolder,
    indexFolder,
    retrieve,
    retrievePack,
    listDocuments,
    isIndexed,
    ingestFile,
    forgetFile,
    forgetFolder,
    close: () => {
      for (const store of lanceCache.values()) {
        void store.close();
      }
      lanceCache.clear();
      for (const store of stateCache.values()) {
        store.close();
      }
      stateCache.clear();
      indexLocks.clear();
    },
  };
}

async function removeOrphanDocuments(
  lance: DocIndexStore,
  state: FolderStateStore,
  livePaths: Set<string>,
): Promise<void> {
  for (const row of state.list()) {
    if (livePaths.has(row.relativePath)) continue;
    await lance.deleteByDocumentId(row.documentId);
    state.delete(row.documentId);
  }
}
