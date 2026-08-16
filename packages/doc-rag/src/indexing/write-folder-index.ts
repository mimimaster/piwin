import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SharedEmbeddingProvider } from '@piwin/contracts';
import { chunkParsedDocument } from '../chunking/chunk-service.js';
import { fileExtension } from '../parsers/extensions.js';
import type { ParserRegistry } from '../parsers/registry.js';
import { documentIdFor, folderKey } from '../paths.js';
import type { DocIndexStore, IndexedChunk } from './doc-index-store.js';

export async function writeParsedFolderIndex(input: {
  canonicalPath: string;
  relativePaths: string[];
  registry: ParserRegistry;
  store: DocIndexStore;
  embedding?: SharedEmbeddingProvider;
  signal?: AbortSignal;
}): Promise<number> {
  const key = folderKey(input.canonicalPath);
  let written = 0;
  for (const relativePath of input.relativePaths) {
    if (input.signal?.aborted) break;
    const parser = input.registry.findParser({
      relativePath,
      extension: fileExtension(relativePath),
    });
    if (!parser) continue;
    const content = await readFile(join(input.canonicalPath, relativePath), 'utf8');
    const documentId = documentIdFor(key, relativePath);
    const parsed = await parser.parse({
      relativePath,
      extension: fileExtension(relativePath),
      content,
      documentId,
    });
    const chunks = await chunkParsedDocument({
      parsed,
      folderKey: key,
    });
    const indexed: IndexedChunk[] = [];
    if (input.embedding && chunks.length > 0) {
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
    written += indexed.length;
  }
  return written;
}
