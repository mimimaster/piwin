import type {
  EmbeddingProvider,
  NoteSearchHit,
  NoteSearchQuery,
} from '@piwin/contracts';
import { fuseHybridHits } from './hybrid-search.js';
import type { NoteIndex } from './note-index.js';

const CHANNEL_FETCH_LIMIT = 50;

export type SearchNotesOptions = {
  /** Absent = FTS-only ('auto' resolves to fts). */
  embeddingProvider?: EmbeddingProvider;
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
    return index.searchFts(query);
  }

  // vector / hybrid — provider is defined per resolveMode contract.
  if (!provider) {
    return index.searchFts(query);
  }
  const channelQuery = { ...query, limit: CHANNEL_FETCH_LIMIT };
  try {
    if (mode === 'vector') {
      const hits = await index.searchVector(channelQuery, provider, options?.signal);
      return hits.slice(0, limit);
    }
    const [ftsHits, vectorHits] = [
      index.searchFts(channelQuery),
      await index.searchVector(channelQuery, provider, options?.signal),
    ];
    return fuseHybridHits(
      { fts: ftsHits, vector: vectorHits },
      { limit, ...(options?.rrfK !== undefined ? { rrfK: options.rrfK } : {}) },
    );
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
