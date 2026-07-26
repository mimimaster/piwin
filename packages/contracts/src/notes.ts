/**
 * Notes library contracts (local-first RAG).
 * See docs/adr/0018-notes-flashcards-local-rag.md and
 * docs/specs/notes-flashcards-rag.md.
 *
 * Invariant: markdown files under `~/.piwin/notes/` are the source of truth;
 * any sqlite index is a rebuildable cache.
 */

/** Persisted note (markdown + frontmatter projection). */
export type NoteRecord = {
  id: string;
  /** Top-level folder grouping under the notes root. */
  collection: string;
  title: string;
  /** Markdown body without frontmatter. */
  content: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  /** Relative path under the notes root. */
  relativePath: string;
  /** sha256 of the raw file; drives lazy index reconcile and card staleness. */
  contentHash: string;
};

export type NoteWriteInput = {
  collection?: string;
  title: string;
  content: string;
  tags?: string[];
};

export type NoteUpdateInput = {
  id: string;
  title?: string;
  content?: string;
  tags?: string[];
};

/** Retrieval channel selection. `auto` = hybrid when embeddings exist, else fts. */
export type NoteSearchMode = 'auto' | 'fts' | 'vector' | 'hybrid';

export type NoteSearchQuery = {
  query: string;
  collection?: string;
  tags?: string[];
  /** Default 10. */
  limit?: number;
  /** Default 'auto'. */
  mode?: NoteSearchMode;
};

export type NoteSearchHit = {
  note: NoteRecord;
  /** Fused (RRF) score, or single-channel score when only one channel ran. */
  score: number;
  snippet: string;
  /** Which retrievers surfaced this hit. */
  channels: Array<'fts' | 'vector'>;
  /** Per-channel 1-based ranks; feeds eval and debug UI. */
  rank: { fts?: number; vector?: number; reranked?: number };
};

/**
 * Pluggable embedding backend. Implementations live in `@piwin/notes`;
 * config selects one. Absent provider means FTS-only operation.
 */
export type EmbeddingProvider = {
  readonly id: string;
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
};

/** Optional second-stage reranker over fused hits. */
export type RerankProvider = {
  readonly id: string;
  rerank(
    query: string,
    hits: NoteSearchHit[],
    signal?: AbortSignal,
  ): Promise<NoteSearchHit[]>;
};

/** One golden query for recall evaluation (user-owned). */
export type RecallEvalCase = {
  query: string;
  expectedNoteIds: string[];
  note?: string;
};

export type RecallEvalReport = {
  runAt: string;
  mode: NoteSearchMode;
  k: number;
  cases: number;
  /** Fraction of cases with at least one expected id in top k. */
  recallAtK: number;
  /** Mean reciprocal rank of the first expected hit. */
  mrr: number;
  perCase: Array<{
    query: string;
    /** 1-based rank of first expected hit, null when missed. */
    hitRank: number | null;
    topIds: string[];
  }>;
};

export type NotesEmbeddingConfig = {
  provider: 'openai-compatible' | 'ollama';
  baseUrl: string;
  model: string;
  /** Env var name holding the API key (mirrors ModelProviderConfig.apiKeyEnv). */
  apiKeyEnv?: string;
  /** Keychain reference, never an inline secret. */
  apiKeyRef?: string;
  dimensions?: number;
};

export type NotesConfig = {
  /** Default true. */
  enabled?: boolean;
  /** Absent = FTS-only mode. */
  embedding?: NotesEmbeddingConfig;
  /** Default off; requires a configured session model. */
  rerank?: { provider: 'llm'; enabled?: boolean };
  search?: {
    defaultMode?: NoteSearchMode;
    /** RRF constant; default 60. */
    rrfK?: number;
  };
};
