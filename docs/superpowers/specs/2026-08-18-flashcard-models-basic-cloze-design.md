# Flashcard models: basic + cloze

| Field | Value |
|-------|-------|
| Date | 2026-08-18 |
| Status | Draft for review |
| Depends on | [ADR 0018](../../adr/0018-notes-flashcards-local-rag.md), [doc-flashcards](../../specs/doc-flashcards.md) |
| Packages | `contracts`, `@piwin/flashcards`, `@piwin/host-runtime`, `@piwin/doc-rag`, `@piwin/skills`, desktop, cli |
| ADR follow-up | Short addendum on ADR 0018 (item is truth; review cards are derived) |

---

## 1. Intent

Flashcards today are one markdown file = one FSRS review unit, always `front` / `back`. That is enough for question-answer cards and too weak for cloze: one sentence with two holes should become two review cards that share one editable text.

v1 adds a closed set of **models** (`basic` | `cloze`) and splits **item** (content on disk) from **review card** (derived, scored). This is not a second notes library, not a skin marketplace, and not Anki note-type plugins.

Approved decisions:

| Decision | Choice |
|----------|--------|
| v1 models | `basic` + `cloze` only |
| Multiplicity | One cloze item → one physical card in conversation; one FSRS review card per cloze ordinal |
| Progress identity | Cloze ordinal (`c1`, `c2`). Same ordinal kept across wording edits |
| Persistence | One content file; cards derived at read time |
| Marketplace / skins | Out of scope |
| `~/.piwin/notes/` | Untouched |
| Existing `cardType` (`fact` / `definition`) | Stays a knowledge tag, not a model |
| `sequenceId` / `position` | RAG playlist on the **item**, not cloze identity |

---

## 2. Goals & Non-Goals

### Goals

1. Users can study cloze cards generated from notes, folders, or open knowledge.
2. One cloze passage with `{{c1::}}` / `{{c2::}}` yields independent FSRS states.
3. Existing `cards/<id>.md` + `review/<id>.json` keep working with no rewrite script.
4. Conversation / artifact preview is one flip card per item (`itemToDisplayCard`). Desktop review queue, CLI review, and TSV export consume per-ordinal `front` / `back`.
5. Agent tools still do `flashcard_list` → `flashcard_batch_create`; schema grows, path does not.

### Non-Goals

- Marketplace, community templates, or card skins.
- `typed` / `image` / audio models.
- Visual cloze editor.
- Deleting a single cloze ordinal while keeping the item.
- Anki “hide all extra clozes”, cloze hints as a product feature, or Anki cloze TSV export.
- Changing the notes library, Doc Cards index, or FSRS algorithm.
- Open model plugins (arbitrary HTML/JS templates).

---

## 3. Terminology (do not collide)

| Name | Meaning | Not |
|------|---------|-----|
| **Item** | Durable flashcard content (`cards/<itemId>.md`) | Not `~/.piwin/notes/` |
| **Review card** | Derived study unit with its own FSRS file | Not a second markdown file |
| **Model** | `basic` \| `cloze` | Not `cardType` |
| **`cardType`** | Optional RAG tag (`fact`, `definition`, …) | Not the model |
| **Cloze ordinal** | `c1`, `c2`, … parsed from the item text | Not `position` |
| **`sequenceId` / `position`** | Display order of a generation batch | Not FSRS identity |

---

## 4. Architecture

```text
Agent / Doc Cards / CLI
        │  create/list/delete items
        ▼
┌───────────────────────┐
│ FlashcardItem (disk)  │  cards/<itemId>.md
│  model + body         │
└───────────┬───────────┘
            │ expandItemsToReviewCards()
            ▼
┌───────────────────────┐
│ FlashcardReviewCard   │  front/back projected
│  cardId = id or id:cN │
└───────────┬───────────┘
            │
            ▼
   review/<safeCardId>.json     queue / rate / artifact / UI
```

`@piwin/flashcards` owns parse, encode, expand, store, queue, artifact, export. Host tools and IPC stay thin. Apps never read `cards/` themselves.

---

## 5. Contracts

### 5.1 Item

```ts
export type FlashcardModel = 'basic' | 'cloze';

export type FlashcardItem = {
  id: string;
  model: FlashcardModel; // default 'basic' when omitted on disk
  deck: string;
  /** basic only; required when model === 'basic' */
  front?: string;
  /** basic only; required when model === 'basic' */
  back?: string;
  /** cloze only; required when model === 'cloze' */
  text?: string;
  // existing attribution + RAG fields unchanged:
  sourceNoteId?: string;
  sourceHash?: string;
  sourceExcerpt?: string;
  sourceFolder?: string;
  sourceFile?: string;
  sourceLine?: number;
  tags?: string[];
  createdAt: string;
  sequenceId?: string;
  position?: number;
  cardType?: string;
  relationFromPrevious?: string;
  knowledgePointIds?: string[];
  sourceChunkIds?: string[];
  generationId?: string;
  sourceDocumentIds?: string[];
};
```

Invariants:

- `model === 'basic'` ↔ non-empty `front` and `back`.
- `model === 'cloze'` ↔ non-empty `text` with at least one valid cloze marker and ≤ 8 distinct ordinals.

### 5.2 Review card (projection)

```ts
export type FlashcardReviewCard = {
  cardId: string;       // basic: item.id; cloze: `${item.id}:c${n}`
  itemId: string;
  model: FlashcardModel;
  ordinal: number;      // always 1 for basic
  deck: string;
  front: string;        // projected
  back: string;         // projected
  tags?: string[];
  createdAt: string;
  sequenceId?: string;
  position?: number;    // copied from item (playlist)
  // attribution copied from item for source popover / open-file
  sourceNoteId?: string;
  sourceExcerpt?: string;
  sourceFolder?: string;
  sourceFile?: string;
  sourceLine?: number;
};
```

`ReviewQueueItem.card` becomes `FlashcardReviewCard`. `ReviewState.cardId` stores the review card id.

### 5.3 Create input

Discriminated on `model` (default `'basic'`):

```ts
export type FlashcardCreateInput =
  | {
      model?: 'basic';
      front: string;
      back: string;
      deck?: string;
      /* attribution… */
    }
  | {
      model: 'cloze';
      text: string;
      deck?: string;
      /* attribution… */
    };
```

`FlashcardBatchCreateInput.cards` is `FlashcardCreateInput[]`. Name stays `cards` so existing tool callers keep working; values are items.

`FlashcardBatchCreateResult`:

- `created: FlashcardItem[]`
- `skipped: FlashcardBatchSkip[]` — `front` remains the preview string (basic front, or cloze text with markers stripped)
- `artifactHtml` built from **expanded review cards** of `created` only

### 5.4 `FlashcardRecord`

Replace call sites with `FlashcardItem` or `FlashcardReviewCard`. Do not leave `FlashcardRecord` as a third overlapping shape. A deprecated type alias is allowed for one release only if it unblocks a mechanical rename; new code must not use it.

### 5.5 Ids and files

Item ids stay `sanitizeCardId`: `^[a-zA-Z0-9._-]+$` (no colon).

| Kind | `cardId` | Review file |
|------|----------|-------------|
| basic | `<itemId>` | `review/<itemId>.json` |
| cloze | `<itemId>:c<n>` | `review/<itemId>--c<n>.json` |

Parse review filenames from the right: `^(.+)--c(\d+)\.json$`. Colon is the API separator because it cannot appear in `itemId`. `--c` is the filename separator so an item id that happens to contain `-c1` does not collide.

---

## 6. Cloze syntax and projection

### 6.1 Markers

Anki-compatible minimum:

```
{{c<N>::<answer>}}
{{c<N>::<answer>::<hint>}}
```

- `N` is a positive integer (`1`…), no leading `+`.
- `<answer>` is non-empty after trim.
- `::hint` is parsed and **discarded** in v1 (not shown, not stored separately).
- Same `N` may appear more than once → one review card with multiple blanks.
- Ordinals need not be contiguous (`c1` + `c3` is two cards; there is no `c2`).
- More than 8 distinct ordinals → item is invalid.

Suggested parse regex (implementations may refine if tests stay equivalent):

```text
\{\{c(\d+)::((?:(?!\}\}|::).)+)(?:::(?:(?!\}\}).)*)?\}\}
```

Unmatched `{{` / `}}` stay literal text.

### 6.2 Projection (Anki default: hide only this ordinal)

Source: `线粒体是{{c1::细胞}}的{{c2::能量工厂}}。`

| cardId | front | back |
|--------|-------|------|
| `id:c1` | `线粒体是[…]的能量工厂。` | `线粒体是**细胞**的能量工厂。` |
| `id:c2` | `线粒体是细胞的[…]。` | `线粒体是细胞的**能量工厂**。` |

Rules:

- Current ordinal → `[…]` on front; `**answer**` on back.
- Other ordinals → visible answer text on both sides.
- Surrounding text is copied as-is (markdown allowed).
- basic projection: `front` / `back` unchanged; `ordinal = 1`; `cardId = item.id`.

Expand is a pure function: `expandItemToReviewCards(item): FlashcardReviewCard[]`. Invalid items return `[]` (store skips them the same way unreadable files are skipped today).

### 6.3 Edit / identity policy

When an item file changes and the store next expands it:

| Change | Review state |
|--------|----------------|
| Wording changes, `cN` still present | Keep `review/<id>--cN.json` |
| New ordinal `cM` | Create initial state if missing |
| Ordinal `cK` removed | Leave json on disk; **do not** enqueue; do not auto-delete |
| Item deleted | Delete the md and every `review/<id>.json` plus `review/<id>--c*.json` |

Renumbering (`c1` → `c2`) is a new card. That is the contract; prompts should tell the model not to renumber.

External edits (vim / git pull) are expected. There is no update HostCommand in v1; reconcile happens on the next list/queue.

---

## 7. Store, queue, tools

### 7.1 Store

`CardStore` grows item-aware methods; names can stay if signatures change in lockstep:

- `create` / `batchCreate` write **items**, then `ensureReviewStates` for each derived card (create missing only, never overwrite).
- `list` returns **items**.
- `listReviewCards` (or `expand` used by queue) returns derived cards.
- `read(itemId)` returns an item.
- `delete(id)` accepts item id **or** review `cardId`; strip a trailing `:c<n>` and delete the whole item.
- `rate(cardId, rating)` rates the review card. Unknown `cardId` (no parent item, or ordinal not in current expand) → error, no file created.
- `getReviewState` / `loadReviewStates` key by `cardId`.
- `deleteBySourceFolder` / `rebindSourceFolder` stay item-scoped.

Dedup in `batchCreate`:

- basic vs basic: existing `frontSimilarity` on `front`.
- cloze vs cloze: `frontSimilarity` on marker-stripped `text`.
- mixed models: compare basic `front` to stripped cloze text (same helper). Threshold unchanged (0.85).

Limits (constants, not config in v1):

- `MAX_CLOZE_ORDINALS = 8`
- `maxBatchSize` default 40 still counts **items**

### 7.2 Queue

`buildReviewQueue` takes review cards + `Map<cardId, ReviewState>`.

- Missing state → skip (same as today). Create path must have inserted initial states.
- `newPerDay` / `maxReviewsPerDay` count **review cards**. One cloze item with two ordinals is two new cards.
- Deck filter uses `card.deck`.
- Sort: due by `due`; new by `createdAt` then `ordinal`.

Display order for a generation sequence (knowledge-center flip-through, batch artifact): `item.position` ascending, then `ordinal` ascending.

### 7.3 Host tools

Keep the four tool names.

| Tool | Change |
|------|--------|
| `flashcard_create` | Accept `model` + (`front`/`back` \| `text`). Validate before write. |
| `flashcard_batch_create` | Same per element. Partial success unchanged. |
| `flashcard_list` | Items only. Preview field: basic `front`, or stripped cloze `text`. Include `id`, `model`, `deck`, source ids. Do **not** explode cloze ordinals. |
| `flashcard_delete` | Item delete; `:cN` suffix stripped. |

IPC commands (`flashcards/create`, `batch-create`, `list`, `delete`, `queue`, `rate`, `export`, `decks`) follow the same split: write/list/delete = items; queue/rate/export = review cards.

**cardId resolution:** any command or artifact action that receives a `cardId` (`flashcards/rate`, `flashcard/open-source`, `flashcard_delete`) parses `itemId` by stripping a trailing `:c<digits>`. Source file / excerpt always come from the item. Desktop and CLI must not parse `{{cN::}}` themselves.

**What the shells see:** study surfaces (queue, chat artifact, Doc Cards sequence, CLI review) receive `FlashcardReviewCard` already projected by host-runtime / `@piwin/flashcards`. Library/admin list receives items. If a generate pipeline persists a card array on a session, persist **items** and expand at read time on the host before the shell renders.

### 7.4 Generation prompts

Update together (keep them aligned; today they are snapshot-tested against each other):

- `skills/generate-flashcards/SKILL.md` (and CLI copy)
- `FLASHCARD_QUALITY_RULES` (bump `version` in the meta header)
- `packages/doc-rag` draft schema / `GeneratedFlashcard` / `toFlashcardCreateInputs`

Model guidance:

- Question, comparison, explanation → `basic`.
- Hide a term / name / formula inside a source sentence → `cloze`, related blanks on the **same** item.
- Never invent source attribution (existing rule).
- Do not renumber cloze ordinals on regeneration of the same fact.

`GeneratedFlashcard` becomes a discriminated draft (`model` + fields) before `toFlashcardCreateInputs`. Invalid cloze drafts are dropped in parse (same as missing front/back today).

---

## 8. Rendering and export

Both renderers keep flip + ratings `again|hard|good|easy`. They receive `FlashcardReviewCard`.

- Desktop `FlashcardView` / `FlashcardStackView`: bind `card.cardId` (not `card.id`) into `flashcard/rate` and `flashcard/open-source`. Optional badge `cloze · cN`.
- Artifact HTML: `data-card-id` and rate payload use `cardId`. Batch artifact is one flip unit per review card.
- CLI review: print projected front/back; rate by `cardId`.
- Knowledge-center / `DocCardSequenceView`: iterate review cards, ordered as in §7.2.

No new interaction (typed answer, tap-individual-blank) in v1.

`exportCardsToTsv` exports **review cards** (one TSV row per cloze ordinal). Columns stay `front back deck tags`. No Anki cloze-marker export in v1.

---

## 9. Migration

No directory rename. No batch rewrite.

| On-disk | After this change |
|---------|-------------------|
| Old md without `model`, with `## Front` / `## Back` | Decode as `model: 'basic'` |
| `review/<uuid>.json` | Still the basic review card |
| New cloze md with `model: cloze` and `## Text` | New files only |
| Corrupt / unreadable md | Skip (existing policy) |

`encodeCardMarkdown`:

- basic: write `model: "basic"` on newly encoded files; still emit `## Front` / `## Back`.
- cloze: write `model: "cloze"` and `## Text`.
- Keep existing frontmatter keys (`cardType`, `sequenceId`, …).

Decode must accept old files that omit `model`.

---

## 10. Error handling

| Case | Behavior |
|------|----------|
| cloze `text` has no valid marker | skip `validation` |
| more than 8 ordinals | skip `validation` |
| empty answer in a marker | that marker is invalid; if none remain valid → skip |
| `rate` on unknown `cardId` | error; do not create review json |
| `rate` on orphan ordinal (json exists, marker gone) | error; do not enqueue |
| `delete` empty id | `invalid-input` |
| file escapes `flashcards` root | throw (existing path guard) |

User-facing messages stay at the app/host edge; tools return `ok: false` + `code` as today.

---

## 11. Testing

Required where the package already has a runner.

`@piwin/flashcards`

- codec: legacy basic; new basic with `model`; cloze `## Text`; hint marker ignored.
- parse: same ordinal twice; gaps (`c1`+`c3`); invalid / empty answer; cap at 8.
- project: table in §6.2 as a golden case.
- identity: keep `c1` across wording change; add `c3` creates state; remove `c2` drops from expand, file remains.
- queue: one 2-ordinal cloze item = two new cards under `newPerDay`.
- dedup: stripped-text duplicate skipped.
- delete: `abc:c1` removes item `abc` and both review files.
- artifact: rate payload contains `abc:c1`.
- export: two TSV data rows for a 2-ordinal item.
- legacy fixture still decodes.

`@piwin/host-runtime`

- tools accept cloze create; list does not explode ordinals; delete strips suffix.

`@piwin/doc-rag`

- schema / prompt include `model` + cloze rule; `toFlashcardCreateInputs` maps cloze drafts.

desktop

- `FlashcardView` rates with `cardId`; cloze projection renders `[…]` on the front.

CLI

- review/list still work on a fixture deck that includes one cloze item.

---

## 12. Docs

- Add a short **ADR 0018 addendum** (or `docs/adr/00NN-flashcard-item-review-card.md` if the addendum would bury the original): item markdown is user-data truth; review cards are derived; `model` ≠ `cardType`; cloze ordinal is FSRS identity; `sequenceId` remains display-only.
- Patch [notes-flashcards-rag](../../specs/notes-flashcards-rag.md) storage layout (review file naming).
- Patch [doc-flashcards](../../specs/doc-flashcards.md) generation I/O for `model` / `text`.
- Bump `FLASHCARD_QUALITY_RULES` version and the generate-flashcards skill.

---

## 13. Implementation order (for the later plan)

1. Contracts + expand/parse pure functions + tests.
2. Codec + store review-path + queue.
3. Host tools / IPC.
4. Doc-rag schema + quality rules + skill.
5. Artifact + Desktop `FlashcardView` + CLI + export.
6. ADR / spec patches.

Each step should typecheck and keep old basic cards green.

---

## 14. Decision log

| # | Decision | Why |
|---|----------|-----|
| 1 | Models, not skins, in v1 | Cloze is the high-value study upgrade; marketplace is a second product |
| 2 | Derived cards, not materialized card files | One edit site; matches “markdown is truth” |
| 3 | Identity = cloze ordinal, not `sequenceId`+`position` | Sequence is a generation playlist and reshuffles on regenerate |
| 4 | Do not reuse `cardType` for `basic`/`cloze` | Already means `fact`/`definition` |
| 5 | Do not build a new notes feature | Item ≠ `~/.piwin/notes/` |
| 6 | Hide only the current ordinal | Anki default; sibling answers stay visible as context |
| 7 | Hints parsed and dropped | Avoid a half-built hint UI |
| 8 | Delete is whole-item | Partial delete needs an editor we are not shipping |
| 9 | Zero-rewrite migration | User data already on disk; old files are valid basic items |
