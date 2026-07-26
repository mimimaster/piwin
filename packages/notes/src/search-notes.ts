import type {
  EmbeddingProvider,
  NoteSearchHit,
  NoteSearchQuery,
  RerankProvider,
} from '@piwin/contracts';
import { fuseHybridHits } from './hybrid-search.js';
import type { NoteIndex } from './note-index.js';

const CHANNEL_FETCH_LIMIT = 50;

export type SearchNotesOptions = {
  /** Absent = FTS-only ('auto' resolves to fts). */
  embeddingProvider?: EmbeddingProvider;
  /** Optional second-stage reranker over fused hits (default off). */
  rerankProvider?: RerankProvider;
  /** RRF constant; default 60. */
  rrfK?: number;
  signal?: AbortSignal;
  /** Boundary logger for degraded-search diagnostics (default console.warn). */
  onWarning?: (message: string) => void;
};

/**
 * Search entry point: lazy reconcile, then mode-resolved retrieval.
 * - auto  → hybrid when provider available, else fts
 * - hybrid/vector without provider → fts (degrade, never fail)
 * - vector/hybrid provider errors → fts fallback, logged at boundary
 */
export async function searchNotes(
  index: NoteIndex,
  query: NoteSearchQuery,
  options?: SearchNotesOptions,
): Promise<NoteSearchHit[]> {
  await index.reconcile();

  const provider = options?.embeddingProvider;
  const requested = query.mode ?? 'auto';
  const mode = resolveMode(requested, provider !== undefined);
  const limit = query.limit && query.limit > 0 ? Math.floor(query.limit) : 10;

  if (mode === 'fts') {
    return applyRerank(index.searchFts(query), query.query, options);
  }

  // vector / hybrid — provider is defined per resolveMode contract.
  if (!provider) {
    return applyRerank(index.searchFts(query), query.query, options);
  }
  const channelQuery = { ...query, limit: CHANNEL_FETCH_LIMIT };
  try {
    if (mode === 'vector') {
      const hits = await index.searchVector(channelQuery, provider, options?.signal);
      return applyRerank(hits.slice(0, limit), query.query, options);
    }
    const [ftsHits, vectorHits] = [
      index.searchFts(channelQuery),
      await index.searchVector(channelQuery, provider, options?.signal),
    ];
    const fused = fuseHybridHits(
      { fts: ftsHits, vector: vectorHits },
      { limit, ...(options?.rrfK !== undefined ? { rrfK: options.rrfK } : {}) },
    );
    return applyRerank(fused, query.query, options);
  } catch (error) {
    if (options?.signal?.aborted) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    (options?.onWarning ?? console.warn)(
      `[piwin/notes] ${mode} search degraded to fts: ${message}`,
    );
    return index.searchFts(query);
  }
}

/** Rerank is provider-internal-failure-safe; it returns input order on error. */
async function applyRerank(
  hits: NoteSearchHit[],
  query: string,
  options: SearchNotesOptions | undefined,
): Promise<NoteSearchHit[]> {
  const rerank = options?.rerankProvider;
  if (!rerank || hits.length < 2) {
    return hits;
  }
  return rerank.rerank(query, hits, options?.signal);
}

function resolveMode(
  requested: NonNullable<NoteSearchQuery['mode']>,
  hasProvider: boolean,
): 'fts' | 'vector' | 'hybrid' {
  if (requested === 'auto') {
    return hasProvider ? 'hybrid' : 'fts';
  }
  if ((requested === 'vector' || requested === 'hybrid') && !hasProvider) {
    return 'fts';
  }
  return requested;
}
