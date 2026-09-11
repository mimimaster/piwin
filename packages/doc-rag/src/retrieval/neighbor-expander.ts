import type { ContextPackSource } from '@piwin/contracts';
import type { IndexedChunk, RetrievalHit } from '../indexing/doc-index-store.js';

export function expandNeighbors(input: {
  hits: RetrievalHit[];
  byId: Map<string, IndexedChunk>;
}): ContextPackSource[] {
  const sources: ContextPackSource[] = [];
  const seen = new Set<string>();

  const push = (chunk: IndexedChunk, retrievedBy: ContextPackSource['retrievedBy'], score?: number): void => {
    if (seen.has(chunk.chunkId)) return;
    seen.add(chunk.chunkId);
    sources.push({
      chunkId: chunk.chunkId,
      documentId: chunk.documentId,
      relativePath: chunk.relativePath,
      ...(chunk.headingPath ? { headingPath: chunk.headingPath } : {}),
      ...(typeof chunk.startLine === 'number' ? { startLine: chunk.startLine } : {}),
      ...(typeof chunk.endLine === 'number' ? { endLine: chunk.endLine } : {}),
      text: chunk.content,
      ...(score !== undefined ? { retrievalScore: score } : {}),
      retrievedBy,
      ...(chunk.metadata ? { metadata: chunk.metadata } : {}),
    });
  };

  for (const hit of input.hits) {
    push(hit.chunk, hit.retrievedBy, hit.score);
    const previous = hit.chunk.previousChunkId
      ? input.byId.get(hit.chunk.previousChunkId)
      : undefined;
    const next = hit.chunk.nextChunkId ? input.byId.get(hit.chunk.nextChunkId) : undefined;
    if (previous && previous.documentId === hit.chunk.documentId) {
      push(previous, 'neighbor');
    }
    if (next && next.documentId === hit.chunk.documentId) {
      push(next, 'neighbor');
    }
  }

  return sources.sort((left, right) => {
    if (left.documentId !== right.documentId) return left.documentId.localeCompare(right.documentId);
    return (left.startLine ?? 0) - (right.startLine ?? 0);
  });
}
