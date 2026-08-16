import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { SharedEmbeddingProvider } from '@piwin/contracts';
import { chunkParsedDocument } from '../chunking/chunk-service.js';
import { fileExtension } from '../parsers/extensions.js';
import type { ParserRegistry } from '../parsers/registry.js';
import { documentIdFor, folderKey } from '../paths.js';
import type { DocIndexStore, IndexedChunk } from './doc-index-store.js';
import type { FolderStateStore } from './state-store.js';

export type IngestFileResult = {
  relativePath: string;
  documentId: string;
  status: 'READY' | 'FAILED' | 'SKIPPED';
  chunkCount: number;
  error?: string;
};

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function ingestionConfigHash(input: {
  parserId: string;
  parserVersion: string;
  chunkerId: string;
  embeddingKey: string;
}): string {
  return createHash('sha256')
    .update(`${input.parserId}@${input.parserVersion}|${input.chunkerId}|${input.embeddingKey}`)
    .digest('hex');
}

export async function ingestSelectedFiles(input: {
  canonicalPath: string;
  relativePaths: string[];
  registry: ParserRegistry;
  store: DocIndexStore;
  state: FolderStateStore;
  embedding?: SharedEmbeddingProvider;
  signal?: AbortSignal;
}): Promise<IngestFileResult[]> {
  if (input.relativePaths.length === 0) {
    throw new Error('NO_SUPPORTED_FILES');
  }
  const key = folderKey(input.canonicalPath);
  const embeddingKey = input.embedding
    ? `${input.embedding.modelId}@${input.embedding.dimension ?? 0}`
    : 'none';
  const results: IngestFileResult[] = [];

  for (const relativePath of input.relativePaths) {
    if (input.signal?.aborted) break;
    const extension = fileExtension(relativePath);
    const parser = input.registry.findParser({ relativePath, extension });
    const documentId = documentIdFor(key, relativePath);
    if (!parser) {
      results.push({ relativePath, documentId, status: 'FAILED', chunkCount: 0, error: 'UNSUPPORTED_FILE_TYPE' });
      continue;
    }
    const absolute = join(input.canonicalPath, relativePath);
    const content = await readFile(absolute, 'utf8');
    const fileHash = hashContent(content);
    const configHash = ingestionConfigHash({
      parserId: parser.id,
      parserVersion: parser.version,
      chunkerId: parser.id === 'code-v1' ? 'legacy-code-v1' : 'structure-recursive-v1',
      embeddingKey,
    });
    const existing = input.state.get(documentId);
    const hasChunks = await input.store.hasDocument(documentId);
    if (
      existing?.status === 'READY' &&
      existing.fileHash === fileHash &&
      existing.configHash === configHash &&
      hasChunks
    ) {
      results.push({ relativePath, documentId, status: 'SKIPPED', chunkCount: existing.chunkCount });
      continue;
    }

    const fileSize = (await stat(absolute)).size;
    try {
      const parsed = await parser.parse({ relativePath, extension, content, documentId });
      const chunks = await chunkParsedDocument({ parsed, folderKey: key });
      if (chunks.length === 0) {
        input.state.upsert({
          documentId,
          folderKey: key,
          relativePath,
          extension,
          fileSize,
          fileHash,
          configHash,
          status: 'FAILED',
          chunkCount: 0,
          lastErrorCode: 'PARSER_FAILED',
          lastErrorMessage: '0 valid chunks',
        });
        results.push({ relativePath, documentId, status: 'FAILED', chunkCount: 0, error: '0 valid chunks' });
        continue;
      }
      await input.store.deleteByDocumentId(documentId);
      const indexed: IndexedChunk[] = [];
      if (input.embedding) {
        const vectors = await input.embedding.embedDocuments(
          chunks.map((chunk) => chunk.content),
          input.signal,
        );
        for (const [index, chunk] of chunks.entries()) {
          const vector = vectors[index];
          indexed.push(vector ? { ...chunk, vector } : chunk);
        }
      } else {
        indexed.push(...chunks);
      }
      await input.store.upsertChunks(indexed);
      input.state.upsert({
        documentId,
        folderKey: key,
        relativePath,
        extension,
        fileSize,
        fileHash,
        configHash,
        status: 'READY',
        chunkCount: indexed.length,
        indexedAt: new Date().toISOString(),
      });
      results.push({ relativePath, documentId, status: 'READY', chunkCount: indexed.length });
    } catch (error) {
      input.state.upsert({
        documentId,
        folderKey: key,
        relativePath,
        extension,
        fileSize,
        fileHash,
        configHash,
        status: 'FAILED',
        chunkCount: 0,
        lastErrorCode: 'PARSER_FAILED',
        lastErrorMessage: error instanceof Error ? error.message : String(error),
      });
      results.push({
        relativePath,
        documentId,
        status: 'FAILED',
        chunkCount: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
