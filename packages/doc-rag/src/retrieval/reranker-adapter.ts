import type { SharedReranker } from '@piwin/contracts';
import type { RetrievalHit } from '../indexing/doc-index-store.js';

export type RerankOutcome = {
  hits: RetrievalHit[];
  degraded: boolean;
  skipped: boolean;
};

export async function applyReranker(
  reranker: SharedReranker | undefined,
  query: string,
  hits: RetrievalHit[],
  topK: number,
  signal?: AbortSignal,
): Promise<RerankOutcome> {
  if (!reranker || hits.length === 0) {
    return { hits: hits.slice(0, topK), degraded: false, skipped: !reranker };
  }
  try {
    const ranked = await reranker.rerank(
      {
        query,
        documents: hits.map((hit) => ({ id: hit.chunk.chunkId, text: hit.chunk.content })),
        topK,
      },
      signal,
    );
    const byId = new Map(hits.map((hit) => [hit.chunk.chunkId, hit]));
    const next: RetrievalHit[] = [];
    for (const item of ranked) {
      const hit = byId.get(item.id);
      if (hit) next.push({ ...hit, score: item.score });
    }
    return { hits: next.slice(0, topK), degraded: false, skipped: false };
  } catch {
    return { hits: hits.slice(0, topK), degraded: true, skipped: false };
  }
}
