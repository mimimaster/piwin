# Flashcard models (basic + cloze) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add closed `basic` + `cloze` models so one cloze item yields one FSRS review card per ordinal, without a marketplace or a second notes library.

**Architecture:** Disk truth is `FlashcardItem` (`cards/<id>.md`). `expandItemToReviewCards()` derives `FlashcardReviewCard`s. FSRS lives at `review/<id>.json` (basic) or `review/<id>--cN.json` (cloze). Host tools write/list items; queue/rate/export/artifact use review cards. Shells do not parse `{{cN::}}`.

**Tech Stack:** TypeScript strict, `@piwin/contracts`, `@piwin/flashcards`, host-runtime tools/IPC, `@piwin/doc-rag`, Desktop `FlashcardView`, CLI.

**Spec:** `docs/superpowers/specs/2026-08-18-flashcard-models-basic-cloze-design.md`

## Global Constraints

- `model` is `basic` | `cloze`. Existing `cardType` (`fact`/`definition`) is unchanged.
- Cloze identity is the ordinal, not `sequenceId`/`position`.
- `MAX_CLOZE_ORDINALS = 8`. Batch cap still counts items (default 40).
- No rewrite of existing `cards/*.md`. Missing `model` decodes as `basic`.
- Delete is whole-item (strip `:cN` first).
- Hints in `{{cN::answer::hint}}` are parsed and discarded.
- Desktop/CLI must not parse cloze markers; they consume projected review cards.
- Do not commit unrelated dirty-tree files.

## File map

| File | Role |
|------|------|
| `packages/contracts/src/flashcards.ts` | `FlashcardModel`, `FlashcardItem`, `FlashcardReviewCard`, create input |
| `packages/contracts/src/doc-rag-v2.ts` | `GeneratedFlashcard` accepts cloze drafts |
| `packages/flashcards/src/cloze.ts` | parse, strip, project, expand, cardId helpers |
| `packages/flashcards/src/card-codec.ts` | `## Text` + `model` frontmatter |
| `packages/flashcards/src/card-store.ts` | item write, review paths, delete suffix, rate gate |
| `packages/flashcards/src/queue.ts` | queue on review cards; sort new by createdAt then ordinal |
| `packages/flashcards/src/artifact-template.ts` | `cardId` not item `id` |
| `packages/flashcards/src/anki-export.ts` | export review cards |
| `packages/host-runtime/src/flashcard-tools.ts` | model/text args; list preview |
| `packages/host-runtime/src/commands/knowledge-commands.ts` | queue/export expand |
| `packages/doc-rag/src/generation/*` | cloze drafts + quality rules |
| `skills/generate-flashcards/SKILL.md` | model guidance |
| Desktop `FlashcardView` + extractors | bind `cardId` |
| CLI review/list | review cards / item preview |
| `docs/adr/0054-flashcard-item-review-card.md` | ADR |

---

### Task 1: Contracts

**Files:**
- Modify: `packages/contracts/src/flashcards.ts`
- Modify: `packages/contracts/src/doc-rag-v2.ts` (`GeneratedFlashcard`)
- Modify: `packages/contracts/src/doc-card-surface.ts` (review cards)

**Produces:**
```ts
export type FlashcardModel = 'basic' | 'cloze';
export type FlashcardItem = { id: string; model: FlashcardModel; deck: string; front?: string; back?: string; text?: string; /* attribution… */ };
export type FlashcardReviewCard = { cardId: string; itemId: string; model: FlashcardModel; ordinal: number; deck: string; front: string; back: string; createdAt: string; /* attribution copy */ };
export type FlashcardCreateInput = { model?: FlashcardModel; front?: string; back?: string; text?: string; /* attribution… */ };
export type ReviewQueueItem = { card: FlashcardReviewCard; state: ReviewState; isNew: boolean };
/** @deprecated Use FlashcardItem or FlashcardReviewCard. */
export type FlashcardRecord = FlashcardItem;
```

`FlashcardCreateInput.front` is no longer required at the type level; runtime validates basic vs cloze.

- [ ] Replace types in `flashcards.ts`
- [ ] Make `GeneratedFlashcard.front`/`back` optional; add `model?` and `text?`
- [ ] `pnpm --filter @piwin/contracts typecheck` (call sites may fail until later tasks; keep contracts package itself green)

---

### Task 2: Cloze parse + expand (TDD)

**Files:**
- Create: `packages/flashcards/src/cloze.ts`
- Create: `packages/flashcards/src/cloze.test.ts`
- Modify: `packages/flashcards/src/index.ts`

**Produces:**
```ts
export const MAX_CLOZE_ORDINALS = 8;
export const CLOZE_BLANK = '[…]';
export function parseClozeMarkers(text: string): Array<{ ordinal: number; answer: string }>;
export function listClozeOrdinals(text: string): number[];
export function isValidClozeText(text: string): boolean;
export function stripClozeMarkers(text: string): string;
export function projectCloze(text: string, ordinal: number): { front: string; back: string };
export function expandItemToReviewCards(item: FlashcardItem): FlashcardReviewCard[];
export function reviewCardId(itemId: string, ordinal: number, model: FlashcardModel): string;
export function parseReviewCardId(cardId: string): { itemId: string; ordinal: number };
export function reviewStateFileName(cardId: string): string;
export function itemPreviewText(item: FlashcardItem): string;
```

- [ ] Write failing tests for golden `线粒体是{{c1::细胞}}的{{c2::能量工厂}}。`, hints, same-ordinal twice, `c1`+`c3`, empty answer, >8 ordinals, basic expand, `abc:c1` parse, `--c1.json` filename
- [ ] Implement `cloze.ts` until green
- [ ] Commit flashcard cloze helpers only

---

### Task 3: Codec

**Files:** `card-codec.ts`, `card-codec.test.ts`

- [ ] Fail: legacy md decodes `model: 'basic'`; cloze `## Text` round-trips; hint-bearing text preserved on disk
- [ ] Encode writes `model`; cloze uses `## Text` not Front/Back
- [ ] Commit

---

### Task 4: Store + queue

**Files:** `card-store.ts`, `card-store.test.ts`, `queue.ts`, `scheduler.test.ts` if it builds queue fixtures

- [ ] Fail: cloze create writes one md + `review/<id>--c1.json` + `--c2.json`; delete `id:c1` removes item + both reviews; rate unknown ordinal errors; wording change keeps `c1` state; removed `c2` not queued; 2-ordinal item = 2 new queue cards
- [ ] Dedup uses `itemPreviewText`
- [ ] `loadReviewStates` / `rate` / `getReviewState` key by review `cardId`
- [ ] Commit

---

### Task 5: Artifact + export

**Files:** `artifact-template.ts`, `artifact-template.test.ts`, `anki-export.ts`

- [ ] Artifact uses `card.cardId`; batch of expanded cloze has `abc:c1`
- [ ] TSV: 2 data rows for a 2-ordinal item
- [ ] Commit

---

### Task 6: Host tools + IPC

**Files:** `flashcard-tools.ts`, `knowledge-commands.ts`, their tests

- [ ] Parse `model`/`text`; list returns items with preview, not exploded cards
- [ ] `queue`/`export` expand first
- [ ] Delete strips `:cN`
- [ ] Commit

---

### Task 7: Doc-rag + skill

**Files:** `flashcard-schema.ts`, `flashcard-qa.ts`, `generation-service.ts`, `quality-rules.ts`, both `generate-flashcards/SKILL.md`

- [ ] Accept cloze drafts; drop invalid cloze; `toFlashcardCreateInputs` maps `model: 'cloze'`
- [ ] Quality rules version bump + cloze guidance
- [ ] Commit

---

### Task 8: Desktop + CLI

**Files:** `FlashcardView.tsx`, extractors, `DocCardSequenceView.tsx`, `FlashcardsPanel.tsx`, CLI review/list

- [ ] Study UIs take `FlashcardReviewCard` and rate `cardId`
- [ ] Library list shows `itemPreviewText`
- [ ] Expand items from tool output via `@piwin/flashcards`, do not parse markers in the app
- [ ] Commit

---

### Task 9: ADR + spec patches

**Files:** `docs/adr/0054-flashcard-item-review-card.md`, notes-flashcards-rag + doc-flashcards storage/I/O notes

- [ ] Write ADR; patch layout docs
- [ ] Commit
