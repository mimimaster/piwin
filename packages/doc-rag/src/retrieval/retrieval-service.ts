import type { ContextPack, SharedEmbeddingProvider, SharedReranker } from '@piwin/contracts';
import { documentIdFor } from '../paths.js';
import type { DocIndexStore } from '../indexing/doc-index-store.js';
import { assembleContextPack } from './context-pack.js';
import { expandNeighbors } from './neighbor-expander.js';
import { applyReranker } from './reranker-adapter.js';

export type RetrieveV2Input = {
  store: DocIndexStore;
  folderKey: string;
  query: string;
  fileAllowlist?: string[];
  limit?: number;
  embedding?: SharedEmbeddingProvider;
  reranker?: SharedReranker;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type RetrieveV2Result = {
  pack: ContextPack;
  retrievalMode: 'hybrid' | 'fts_only';
};

export async function retrieveV2(input: RetrieveV2Input): Promise<RetrieveV2Result> {
  const documentIds = input.fileAllowlist?.map((relativePath) =>
    documentIdFor(input.folderKey, relativePath),
  );
  const limit = input.limit ?? 10;
  let retrievalMode: 'hybrid' | 'fts_only' = 'fts_only';
  let degraded = !input.embedding;
  let hits;
  if (input.embedding) {
    try {
      const vector = await input.embedding.embedQuery(input.query, input.signal);
      hits = await input.store.hybridSearch({
        text: input.query,
        vector,
        folderKey: input.folderKey,
        ...(documentIds ? { documentIds } : {}),
        limit: limit * 3,
      });
      retrievalMode = 'hybrid';
    } catch {
      hits = await input.store.ftsSearch({
        text: input.query,
        folderKey: input.folderKey,
        ...(documentIds ? { documentIds } : {}),
        limit: limit * 3,
      });
      degraded = true;
    }
  } else {
    hits = await input.store.ftsSearch({
      text: input.query,
      folderKey: input.folderKey,
      ...(documentIds ? { documentIds } : {}),
      limit: limit * 3,
    });
  }

  const reranked = await applyReranker(input.reranker, input.query, hits, limit, input.signal);
  if (reranked.degraded) degraded = true;

  const neighborIds = reranked.hits.flatMap((hit) =>
    [hit.chunk.previousChunkId, hit.chunk.nextChunkId].filter(
      (id): id is string => typeof id === 'string' && id.length > 0,
    ),
  );
  const extras = await input.store.getChunksByIds(neighborIds);
  const byId = new Map(reranked.hits.map((hit) => [hit.chunk.chunkId, hit.chunk]));
  for (const chunk of extras) byId.set(chunk.chunkId, chunk);

  const sources = expandNeighbors({ hits: reranked.hits, byId });
  const pack = assembleContextPack({
    query: input.query,
    folderKey: input.folderKey,
    retrievalMode,
    degraded,
    sources,
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
  });
  return { pack, retrievalMode };
}
