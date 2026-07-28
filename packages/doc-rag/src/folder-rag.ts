/**
 * Folder RAG orchestration: scan → chunk → index → retrieve.
 *
 * Spec §8.1, §9.1. The FolderRag instance owns one chunker + optional
 * embedding provider and can serve multiple folders (each gets its own
 * sqlite cache under `~/.piwin/doc-rag/<folder-key>/`).
 */
import { readdir, stat, writeFile, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type {
  DocChunk,
  DocChunker,
  EmbeddingProvider,
  IndexFolderOptions,
  IndexFolderResult,
  RetrieveOptions,
  RetrievedChunk,
  ScanFolderResult,
  ScannedDocFile,
} from '@piwin/contracts';
import type { FolderRag } from './doc-rag-types.js';
export type { FolderRag };
import { createDefaultChunker, isSupportedExtension, detectLanguage } from './chunker.js';
import { openDocIndex } from './doc-index.js';
import type { DocIndex } from './doc-index.js';
import {
  canonicalizeFolderPath,
  getDocIndexPath,
  getSourcePathSidecar,
  isSafeRelativePath,
  isPathConfined,
} from './paths.js';
import {
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_TOTAL_BYTES,
  DEFAULT_MAX_WALK_DEPTH,
  SKIP_DIR_NAMES,
  SKIP_FILE_NAME_PATTERNS,
} from './limits.js';

export type CreateFolderRagOptions = {
  chunker?: DocChunker;
  embeddingProvider?: EmbeddingProvider;
  /** Default `~/.piwin`. */
  piwinRoot?: string;
};

export function createFolderRag(options: CreateFolderRagOptions = {}): FolderRag {
  const chunker = options.chunker ?? createDefaultChunker();
  const embeddingProvider = options.embeddingProvider;
  const piwinRoot = options.piwinRoot;
  // Open index lazily per folder; cache by canonical path.
  const indexCache = new Map<string, DocIndex>();
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

  async function scanFolder(folderPath: string): Promise<ScanFolderResult> {
    const canonical = await canonicalizeFolderPath(folderPath);
    if (!canonical) {
      throw new Error(`Folder not found: ${folderPath}`);
    }
    const files: ScannedDocFile[] = [];
    await walk(canonical, canonical, 0, files);
    return {
      files,
      supportedExtensions: [...chunker.supportedExtensions],
    };
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
    const index = await getIndex(canonical);
    return index.retrieve(query, {
      ...(embeddingProvider ? { embeddingProvider } : {}),
      ...(retrieveOptions?.limit !== undefined ? { limit: retrieveOptions.limit } : {}),
      ...(fileAllowlist ? { fileAllowlist } : {}),
      ...(retrieveOptions?.maxTotalChars !== undefined ? { maxTotalChars: retrieveOptions.maxTotalChars } : {}),
      ...(retrieveOptions?.signal ? { signal: retrieveOptions.signal } : {}),
    });
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
      indexLocks.clear();
    },
  };
}

/** Recursive walk with skip-dir / skip-file / depth / hidden rules. */
async function walk(
  root: string,
  current: string,
  depth: number,
  files: ScannedDocFile[],
): Promise<void> {
  if (depth > DEFAULT_MAX_WALK_DEPTH) return;
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // hidden
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      await walk(root, absolute, depth + 1, files);
    } else if (entry.isFile()) {
      if (SKIP_FILE_NAME_PATTERNS.some((pattern) => pattern.test(entry.name))) continue;
      if (!isSupportedExtension(entry.name)) continue;
      try {
        const stats = await stat(absolute);
        const relativePath = relative(root, absolute).split(sep).join('/');
        files.push({
          relativePath,
          sizeBytes: stats.size,
          language: detectLanguage(relativePath),
        });
      } catch {
        // Skip unreadable files silently at scan.
      }
    }
  }
}
