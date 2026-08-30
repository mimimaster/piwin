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
- CLI parity is mandatory (`piwin notes …`, `piwin cards …`, and `piwin study`
  for Host-owned rounds), consistent with repo rules on host/CLI consistency.
- Host-owned study rounds, the operation log, and additive
  `ReviewState.revision` are recorded in
  [ADR 0066](./0066-host-owned-flashcard-study-rounds.md). They do not replace
  this CardStore layout. ADR 0066 is implemented in tree with verification
  incomplete (not Accepted).

## Appendix: Doc Cards (folder RAG → flashcard generation)

**Status**: Accepted (v3, 2026-07-28). Extends this ADR without superseding it.
See `docs/specs/doc-flashcards.md` for the full functional spec.

### What changed

A new `@piwin/doc-rag` package adds folder-scoped document indexing and RAG
retrieval, powering a "Doc Cards" generation flow: the user points at a
folder, the host indexes it (FTS5 + optional vector), retrieves passages
by topic, and the agent generates flashcards via `flashcard_batch_create`
with source attribution (`sourceFolder`, `sourceFile`, `sourceLine`,
`sourceExcerpt`).

### Architecture decisions

1. **New package `@piwin/doc-rag`** — mirrors `@piwin/notes`' RAG
   infrastructure (chunker, FTS5+vector index, RRF fusion) but is
   folder-scoped rather than notes-scoped. Reuses `@piwin/notes`'
   `tokenizeForIndex`, `buildMatchExpression`, `cosineSimilarity`, and
   `createEmbeddingProvider` (shared embedding config). The sqlite index
   lives under `~/.piwin/doc-rag/<folder-key>/doc-index.sqlite3` — a
   rebuildable cache, not user data.

2. **File types are dynamic** — the chunker's `supportedExtensions` is
   queried at runtime; no hardcoded file-type list in apps or contracts.
   This is the same invariant as notes (P5): the chunker owns the list.

3. **`node:sqlite` containment is preserved** — `doc-index.ts` is the only
   module in `@piwin/doc-rag` that imports `node:sqlite`, mirroring the
   per-package rule established in §3 of this ADR.

4. **Tool profiles by ExecutionMode** (spec §10.2):
   - `chat` (knowledge profile): flashcards + read-only notes + optional web.
     This replaces the prior "chat → no host tools" behavior.
   - `agent` (coding profile): web/mcp/plan/process/memory/notes CRUD, no
     flashcards (unless `config.flashcards.agentModeTools` escape hatch).
   - `agent-debug` (debug profile): coding ∪ flashcards.

5. **`flashcard_batch_create`** — a new host tool for batch generation.
   Returns `{ created, skipped, artifactHtml }` where `artifactHtml` is a
   multi-card stack. Duplicates are skipped (partial success), not fatal.

6. **Source attribution on cards** — `FlashcardRecord` gained
   `sourceFolder`, `sourceFile`, `sourceLine` fields. The artifact template
   shows a subtle indicator on sourced cards; clicking it reveals a
   popover with the excerpt and path. An "Open file" button posts
   `flashcard/open-source` → `doccards/open-source` IPC, which validates
   confinement and resolves the absolute path.

7. **`generate-flashcards` bundled skill** — installed once via
   `ensureBundledSkillsInstalled` (same mechanism as other bundled skills).
   The skill body documents the folder/notes/open flows and is
   snapshot-tested against `FLASHCARD_QUALITY_RULES` to stay in sync.

8. **CLI parity** — `piwin doccards scan|index|retrieve|list|generate|rebind|forget`
   mirrors the desktop Doc Cards panel. `generate` prints the prompt for
   the user to paste into a chat session (CLI has no agent loop).

### Consequences (additive)

- The Knowledge Center gains a fourth tab ("Doc Cards" / "文档卡片").
- `config.flashcards.agentModeTools` is a one-release escape hatch for
  existing agent-mode flashcard users; it will be removed in a later
  release (spec §10.3).
- `config.flashcards.maxBatchSize` (default 40) bounds batch generation.
- Desktop opens source files via `@tauri-apps/plugin-shell` `open()`.
- The product identity widens further: "agent shell with a personal
  knowledge layer" now includes arbitrary document folders, not just notes.

## Appendix: LanceDB for Doc Cards V2 (2026-08-16)

**Decision:** A
**Sidecar Node:** v24.11.1
**Native required:** yes
**Platform prebuilds:** optional `@lancedb/lancedb-{darwin-arm64,linux-x64-gnu,linux-arm64-gnu,linux-x64-musl,linux-arm64-musl,win32-x64-msvc,win32-arm64-msvc}` in `@lancedb/lancedb@0.37.1`. Verified here: darwin-arm64 only (`lancedb.darwin-arm64.node` ≈ 216 MiB). No `darwin-x64` optional package listed.
**CJK FTS:** fail with default `simple`/English tokenizer; **pass** with `Index.fts({ baseTokenizer: "icu", stem: false, removeStopWords: false })`. Do not set `language: "Chinese"` (native panic).
**Packaging impact on ADR 0018 §3:** accepted for Doc Cards V2 only. Sidecar must include the matching platform `.node` and must not pull every optional native package into one bundle. Notes RAG stays on `node:sqlite` + optional brute-force vectors.

Process notes: `docs/notes/2026-08-16-lancedb-sidecar-spike.md`.
