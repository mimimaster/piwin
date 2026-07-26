# ADR 0018: Notes Library, Flashcards, and Local-First RAG

## Status

Proposed (2026-07-26)

## Context

piwin started as a private coding-agent shell and is now positioned as an
**open-source, local-first agent tool**. We want to add:

1. A **notes library** the agent can retrieve from (RAG).
2. **Flashcards** generated from notes via the agent, collected into a card
   library with spaced-repetition review.

This extends the product beyond pure coding-agent workflows, so the boundary
must be stated: notes/flashcards are the **user-visible extension of the
memory system** — a personal knowledge base the agent reads and writes, plus
review material distilled from it. It is not a general PKM/Anki replacement.

Constraints that drive the design:

- **Local-first, zero-config default.** An open-source user without any API
  key or local model must get a fully working product. We cannot require an
  embedding model, a database server, or a network connection.
- **Chinese (CJK) retrieval must work.** sqlite FTS5's `unicode61` tokenizer
  treats consecutive CJK as a single token, making Chinese search unusable
  out of the box. `trigram` requires ≥3-char queries (kills two-char Chinese
  words); jieba-style native extensions add cross-platform build burden.
- **Native modules are a packaging liability.** The desktop app runs the host
  as a Node sidecar (ADR 0006/0017); every native `.node` binary must be
  distributed per platform/arch. `better-sqlite3` and `sqlite-vec` fall in
  this category.
- **Users will edit files behind our back.** Notes are plain markdown; vim,
  Obsidian, and `git pull` are expected write paths. Any index can go stale
  at any time.
- Repo rules: contracts-first, one-way dependency graph, pure logic
  unit-tested, no UI→FS access, secrets as refs only.

## Decision

### 1. Product boundary

Two new application packages, `@piwin/notes` and `@piwin/flashcards`, above
`agent-host`, following the memory-package pattern. The agent interacts
through host tools (`note_*`, `flashcard_*`); apps consume public APIs and IPC
commands only. Full spec: `docs/specs/notes-flashcards-rag.md`.

### 2. Plain text is truth; sqlite is a disposable cache (invariant)

- Notes: markdown + frontmatter under `~/.piwin/notes/`.
- Cards: markdown under `~/.piwin/flashcards/cards/`.
- **Review state (FSRS scheduling) is user data**, stored as JSON files —
  never only in sqlite.
- All `*.sqlite3` files are rebuildable indexes. Deleting them must lose zero
  user data. Every index schema change is handled by rebuild, not migration.

### 3. sqlite via `node:sqlite`, not `better-sqlite3`

Node's built-in `DatabaseSync` (Node ≥ 22; repo runs 24+) ships FTS5 and
needs no native packaging. Verified on Node 24: FTS5 virtual tables, MATCH,
bm25, snippets, and CJK pre-tokenized content all work. The API is marked
experimental, so **exactly one module per package may import `node:sqlite`**
(`note-index.ts`); everything else depends on its interface. If the API
breaks or better-sqlite3 becomes necessary, one file changes.

### 4. CJK search via `Intl.Segmenter` pre-tokenization

Text is segmented with `Intl.Segmenter('zh', { granularity: 'word' })`
(V8/ICU dictionary segmentation, stdlib, pure function) and stored
space-joined in FTS5 with the default `unicode61` tokenizer. Queries get the
same treatment. A `Tokenizer` seam is kept so a jieba-class tokenizer can be
swapped in later without index-schema changes (rebuild required).

### 5. Retrieval: FTS-first, embedding as optional enhancement, RRF hybrid

```
NoteSearch
  ├─ FTS5 (always available, zero config)
  └─ vector (only when notes.embedding configured)
        → RRF fusion → optional LLM rerank (default off)
```

- `EmbeddingProvider` is a contracts interface; v1 implementations:
  `openai-compatible` and `ollama`. No bundled ONNX model (packaging cost);
  revisit later.
- Vectors are stored as BLOBs with brute-force cosine in TS — no `sqlite-vec`
  native dependency. Personal scale (≤10k notes) stays well under 50ms;
  revisit with benchmarks beyond ~20k notes.
- Embedding failure degrades to FTS silently (logged at boundary); model
  change invalidates vectors via recorded `emb_model`/`emb_dim` and triggers
  lazy re-embedding.
- Retrieval quality is **measurable, not assumed**: a user-owned golden query
  set drives `recall@k`/MRR reports per mode, so enabling embedding/rerank is
  an evidence-based choice.

### 6. Index consistency: lazy reconcile, no watchers

Before serving a search, scan the notes dir and reconcile `(mtime, hash)`
against index rows (upsert changed, purge deleted). No file watchers — for
personal-scale corpora a scan is milliseconds, and the cache invariant (§2)
makes "delete the index" the universal repair. A manual rebuild command
exists as a fallback surface.

### 7. Flashcards: agent-generated, snapshot-based, FSRS-scheduled

- Generation is a normal agent conversation using the `flashcard_create`
  tool — no bespoke RAG pipeline. Dedup guard: existing deck fronts are
  passed to the model; a trigram-similarity check rejects near-duplicates.
- Cards snapshot the source excerpt + note content hash at creation. **Note
  edits never cascade to cards**; divergence surfaces as a "source updated"
  badge. No bidirectional sync.
- Scheduling uses FSRS via `ts-fsrs` (MIT) — the only new dependency in this
  feature. Scheduler and queue logic are pure functions.
- Cards are exportable to Anki-importable TSV; user data stays portable.

### 7a. Artifact action channel for in-chat review (S5c amendment)

Flip-card flashcards render in chat via the existing HTML-artifact sandbox.
Rating clicks flow back to the product through a new **whitelisted action
message** in the artifact postMessage bridge:

```
sandboxed card HTML → window.piwinArtifact.postAction('flashcard/rate', {cardId, rating})
  → parent (ArtifactFrame): parseArtifactActionMessage (strict validation)
    + event.source + channelId checks (same as height bridge)
  → HostCommand flashcards/rate → FSRS state update
```

Security invariants:

- `ARTIFACT_ACTION_NAMES` is a deliberate whitelist (`flashcard/rate` only in
  v1). Unknown actions are dropped at both the sandbox helper and the parent
  parser.
- Payloads are strictly validated: card ids must match the product id pattern,
  ratings must be one of the four FSRS grades. Malformed input → null, no log
  of attacker-controlled content.
- The action channel grants no new capabilities to model HTML beyond what a
  user click in the product UI could do; `flashcards/rate` is user intent,
  not agent privilege, so it is not permission-gated.
- CSP/sandbox posture is unchanged (`allow-scripts`, no external resources).

`flashcard_create` returns `artifactHtml` (a product-owned flip-card template,
HTML-escaped content, theme variables only) so models embed a working card by
pasting it into a ```html fence — models never hand-write the action wiring.

## Consequences

- Zero-config install ships working CJK full-text search, card generation,
  and review — fully offline. Embedding/rerank are additive.
- No new native modules; desktop packaging burden (ADR 0017) is unchanged.
- `node:sqlite` experimental status is a contained risk (single-module rule).
- Brute-force cosine and whole-note retrieval units are deliberate
  simplifications with stated revisit thresholds (20k notes; 2k-token median
  note length → chunking).
- The product's public identity widens from "coding-agent shell" to "agent
  shell with a personal knowledge layer"; PRD should gain a section framing
  notes/flashcards as the memory system's user-visible surface.
- CLI parity is mandatory (`piwin notes …`, `piwin cards …`), consistent
  with repo rules on host/CLI consistency.
