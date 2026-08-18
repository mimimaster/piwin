# Spec — Notes RAG library · Flashcards · Hybrid retrieval

| Field | Value |
|-------|-------|
| Status | **Draft for review** |
| Date | 2026-07-26 |
| Depends on | [ADR 0018](../adr/0018-notes-flashcards-local-rag.md), PermissionPolicy, memory package patterns |
| Packages | `contracts`, `@piwin/notes` (new), `@piwin/flashcards` (new), `agent-host`, desktop, cli |

## 1. Goals

1. **Notes library**: local-first markdown note store with full-text + optional
   semantic retrieval, exposed to the agent as tools (RAG).
2. **Flashcards**: agent-generated Q/A cards from notes, collected into a card
   library with FSRS spaced-repetition scheduling.
3. **Hybrid retrieval**: FTS5 + vector search fused via RRF, optional
   rerank stage. Vector path activates only when an embedding provider is
   configured; zero-config FTS-only mode must remain fully functional.
4. **Retrieval observability**: built-in recall evaluation against a local
   golden query set (`recall@k`, `mrr`), runnable from CLI and Settings.

## 2. Non-goals

- WYSIWYG note editor (v1 uses plain markdown editing; external editors are
  first-class citizens).
- Real-time file watching (lazy reconcile only).
- Chunk-level retrieval (v1 unit = whole note; chunking is a vector-phase
  upgrade, revisit when notes exceed ~2k tokens median).
- Cloud sync, sharing, collaborative decks.
- Bundled local embedding model (ONNX). Providers are external
  (OpenAI-compatible endpoint or Ollama); may revisit later.

## 3. Invariants (binding)

1. **Plain text is truth, sqlite is cache.** Notes, cards, and review state
   live as markdown/JSON under `~/.piwin/`. Every `*.sqlite3` file is a
   rebuildable index; deleting it must lose zero user data.
2. **Lazy reconcile.** Before serving a search, compare file `mtime` + content
   hash against index rows; re-index changed/new, purge deleted. No watchers.
3. **External edits are expected.** Users may edit notes with vim/Obsidian or
   `git pull` into the notes dir; the system must converge on next search.
4. **No embedding requirement.** Every feature (search, card generation,
   review) works with FTS only. Vector/rerank are additive enhancements.
5. **Review state is user data, not cache** — stored as plain files, never
   only in sqlite.
6. **Path safety**: all note/card paths must resolve under their configured
   roots (same traversal policy as media/memory).

## 4. Storage layout

```text
~/.piwin/notes/
  <collection>/<slug>.md          # frontmatter: id, title, tags, createdAt, updatedAt
  .index/notes-index.sqlite3      # FTS5 + vectors + eval runs (cache, rebuildable)
~/.piwin/flashcards/
  cards/<card-id>.md              # frontmatter: id, sourceNoteId, sourceHash, deck, createdAt
                                  # body: ## Front / ## Back (+ source snapshot excerpt)
  review/<card-id>.json           # FSRS state for a basic item (cardId === itemId)
  review/<item-id>--c<n>.json     # FSRS state for cloze ordinal n (cardId === itemId:cN)
  decks.json                      # deck names/order
~/.piwin/notes/.eval/golden.jsonl # recall eval set: {query, expectedNoteIds[], note?}
```

## 5. Contracts (`packages/contracts/src/notes.ts`, `flashcards.ts`)

```ts
// notes.ts
export type NoteRecord = {
  id: string;
  collection: string;
  title: string;
  content: string;          // markdown body (no frontmatter)
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  relativePath: string;     // under ~/.piwin/notes/
  contentHash: string;      // sha256 of raw file, drives reconcile
};

export type NoteSearchQuery = {
  query: string;
  collection?: string;
  tags?: string[];
  limit?: number;           // default 10
  mode?: 'auto' | 'fts' | 'vector' | 'hybrid';  // default 'auto'
};

export type NoteSearchHit = {
  note: NoteRecord;
  score: number;            // fused score (RRF) or single-channel score
  snippet: string;
  channels: Array<'fts' | 'vector'>;  // which retrievers surfaced this hit
  rank: { fts?: number; vector?: number; reranked?: number };
};

/** Pluggable embedding. Implementations live in @piwin/notes; config selects one. */
export type EmbeddingProvider = {
  readonly id: string;              // e.g. 'openai-compatible', 'ollama'
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
};

export type RerankProvider = {
  readonly id: string;              // 'llm' (session model) | future: 'cohere-like'
  rerank(query: string, hits: NoteSearchHit[], signal?: AbortSignal): Promise<NoteSearchHit[]>;
};

// Retrieval evaluation
export type RecallEvalCase = { query: string; expectedNoteIds: string[]; note?: string };
export type RecallEvalReport = {
  runAt: string;
  mode: NoteSearchQuery['mode'];
  k: number;
  cases: number;
  recallAtK: number;        // fraction of cases with >=1 expected id in top k
  mrr: number;
  perCase: Array<{ query: string; hitRank: number | null; topIds: string[] }>;
};

// flashcards.ts
export type FlashcardRecord = {
  id: string;
  deck: string;
  front: string;
  back: string;
  sourceNoteId?: string;
  sourceHash?: string;      // note contentHash at generation time (staleness badge)
  sourceExcerpt?: string;   // snapshot; card survives note edits/deletion
  createdAt: string;
};

export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';
export type ReviewState = {
  cardId: string;
  due: string;
  stability: number;
  difficulty: number;
  reps: number;
  lapses: number;
  lastReviewedAt?: string;
};
```

Config (`config.ts` additions):

```ts
notes?: {
  enabled?: boolean;                       // default true
  embedding?: {
    provider: 'openai-compatible' | 'ollama';
    baseUrl: string;
    model: string;
    apiKeyRef?: string;                    // env/keychain ref, never inline secret
    dimensions?: number;
  };
  rerank?: { provider: 'llm'; enabled?: boolean };  // default off
  search?: { defaultMode?: 'auto' | 'fts' | 'vector' | 'hybrid'; rrfK?: number };
};
flashcards?: { enabled?: boolean; newPerDay?: number; maxReviewsPerDay?: number };
```

## 6. `@piwin/notes` package

### 6.1 Modules

| File | Responsibility |
|------|----------------|
| `note-store.ts` | CRUD over markdown files, frontmatter codec, slug/id rules |
| `note-index.ts` | **only module touching `node:sqlite`**; FTS5 tables, vector table, reconcile, rebuild |
| `tokenize.ts` | `Intl.Segmenter('zh', word)` pre-tokenization (pure, unit-tested) |
| `fts-search.ts` | FTS5 query building + scoring (bm25) |
| `vector-search.ts` | brute-force cosine over stored Float32 vectors (see 6.4) |
| `hybrid-search.ts` | RRF fusion + optional rerank orchestration (pure given channel results) |
| `embedding/openai-compatible.ts`, `embedding/ollama.ts` | providers |
| `rerank/llm-rerank.ts` | listwise rerank via session model (top N≤20 → ordered ids) |
| `recall-eval.ts` | golden set runner, `RecallEvalReport` |

### 6.2 Index schema (cache)

```sql
CREATE TABLE note_meta(
  id TEXT PRIMARY KEY, path TEXT, mtime INTEGER, hash TEXT,
  emb_model TEXT, emb_dim INTEGER          -- null until embedded
);
CREATE VIRTUAL TABLE note_fts USING fts5(id UNINDEXED, title, body, tags);
  -- title/body/tags stored pre-tokenized (space-joined Intl.Segmenter output)
CREATE TABLE note_vec(id TEXT PRIMARY KEY, embedding BLOB);  -- Float32Array bytes
```

- `node:sqlite` (`DatabaseSync`) — verified FTS5 + CJK pre-tokenized snippets on
  Node 24. Experimental-API risk contained inside `note-index.ts`.
- Reconcile: scan dir → compare `(mtime, hash)` → upsert FTS row (re-tokenize),
  drop stale vector row (re-embed lazily), delete rows for missing files.
- Embedding model change detection: `emb_model`/`emb_dim` mismatch ⇒ vector rows
  invalid ⇒ background re-embed on next search; FTS serves meanwhile.

### 6.3 Hybrid retrieval pipeline

```text
query
  ├─ FTS5: tokenize(query) → MATCH, bm25 ranking, top 50
  └─ vector (if provider configured): embed(query) → cosine top 50
       ↓
RRF fusion: score(d) = Σ 1/(rrfK + rank_channel(d)), rrfK default 60
       ↓
optional rerank (config off by default): top ≤20 → RerankProvider → final order
       ↓
top `limit` hits with channels + per-channel ranks (feeds eval + debug UI)
```

- `mode: 'auto'` = hybrid when embeddings available, else fts.
- Abort: embedding/rerank calls take `AbortSignal`; FTS fallback on
  provider error (log at boundary, never fail the search).

### 6.4 Vector store decision

v1 stores embeddings as BLOBs and does brute-force cosine in TS. For personal
scale (≤10k notes × ≤1536 dims) this is <50ms and avoids native `sqlite-vec`.
Revisit with benchmarks if collections exceed ~20k notes.

### 6.5 Recall evaluation

- Golden set: `~/.piwin/notes/.eval/golden.jsonl`, user-editable; UI affordance
  "pin this search result as expected answer" appends a case.
- Runner executes each case per mode (`fts` / `vector` / `hybrid`, whichever
  available) → `RecallEvalReport`; stored in index db (last 20 runs) for trend.
- Surfaces: `piwin notes eval [--k 5]` (table output) and Settings → Notes →
  Retrieval quality (report + history sparkline).
- Purpose: lets user verify whether configuring embedding/rerank actually
  improves their retrieval before paying for it.

## 7. `@piwin/flashcards` package

| File | Responsibility |
|------|----------------|
| `card-store.ts` | card markdown CRUD, deck registry |
| `review-store.ts` | ReviewState JSON persistence |
| `scheduler.ts` | FSRS via `ts-fsrs` (MIT): `rate(state, rating, now) → next state` (pure) |
| `queue.ts` | due-card queue: due first, then new (capped by `newPerDay`) (pure) |
| `dedup.ts` | near-duplicate front-text check (normalized trigram overlap) (pure) |
| `anki-export.ts` | TSV export (front/back/deck/tags) for Anki import |

- **Generation is agent-driven, not a pipeline**: the `flashcard_create` tool is
  called by the model during a "generate cards from …" conversation. Host
  passes existing deck fronts for the source note so the model avoids
  duplicates; `dedup.ts` is the safety net (reject ≥0.85 similarity within deck).
- Cards snapshot `sourceExcerpt` + `sourceHash`; note edits never cascade.
  UI shows "source updated" badge when hashes diverge.
- Review UI: desktop panel with due count entry point; keyboard-first
  (space = reveal, 1–4 = rating). CLI: `piwin cards review` interactive loop.

## 8. Host wiring (`@piwin/agent-host`)

Tools (registered when `notes.enabled` / `flashcards.enabled`):

| Tool | Permission |
|------|------------|
| `note_search`, `note_read`, `note_list` | allow |
| `note_write`, `note_update`, `note_delete` | ask (same policy tier as memory writes) |
| `flashcard_create`, `flashcard_list` | allow |
| `flashcard_delete` | ask |

IPC HostCommands: `notes/*`, `flashcards/*` (search, crud, eval/run,
review/next, review/rate, decks, export). Events: none beyond command replies
(no watcher ⇒ no push updates).

## 9. Apps

- **Desktop**: Notes panel (collection tree, markdown view/edit, search box with
  channel badges on hits); Flashcards panel (decks, due queue, review flow);
  Settings → Notes (embedding provider form + "test connection", rerank toggle,
  rebuild index button, eval report).
- **CLI**: `piwin notes add|list|search|eval|reindex`, `piwin cards
  generate|list|review|export`. CLI parity is mandatory (no desktop-only
  behavior except review keyboard UX).

## 10. Testing requirements

| Area | Tests |
|------|-------|
| tokenize / hybrid RRF / scheduler / queue / dedup / codecs | unit (pure) |
| note-index reconcile | tmp-dir integration: external edit, delete, hash drift, index-file deletion |
| embedding providers | fixture-based (mock fetch), abort + error-fallback paths |
| recall-eval | golden fixtures with known ranks → exact recall/mrr values |
| path traversal | reject cases for notes + cards roots |
| tool wiring | host integration: tools absent when disabled |

## 11. New dependencies

| Dep | Why | License |
|-----|-----|---------|
| `ts-fsrs` | FSRS scheduling, de-facto standard | MIT |

(`node:sqlite`, `Intl.Segmenter`, `fetch` are stdlib — no other additions.
`sqlite-vec` / ONNX embedding explicitly deferred.)

## 12. Acceptance

1. Fresh install, zero config: create notes, FTS search with CJK queries,
   generate cards via chat, review with FSRS — all offline.
2. Configure Ollama embedding in Settings → hybrid mode activates; eval report
   shows per-mode recall@k on user golden set.
3. Delete `notes-index.sqlite3` → next search rebuilds; zero data loss
   (including review history).
4. Edit a note in vim → next search returns updated content; derived cards
   show stale badge but remain reviewable.
5. Embedding endpoint down → search degrades to FTS, logged, no user-facing error.
6. `piwin cards export` produces a TSV that Anki imports cleanly.

## 13. Slices

S0 ADR + contracts → S1 note-store + tokenize + FTS index/reconcile →
S2 host tools + CLI notes → S3 embedding providers + vector + hybrid RRF →
S4 recall eval (CLI first) → S5 flashcards pkg + tools + CLI review →
S6 desktop Notes panel → S7 desktop Flashcards + review UX →
S8 rerank + eval UI + Anki export.

Each slice lands typecheck-green with tests; S1–S2 already ship a usable
FTS-only product.
