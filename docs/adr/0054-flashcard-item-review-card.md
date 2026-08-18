# ADR 0054: Flashcard item vs review card

## Status

Accepted (2026-08-18)

## Context

ADR 0018 stored one markdown file per FSRS review unit (`front` / `back`). Cloze study needs one editable passage to yield multiple review cards (`{{c1::}}`, `{{c2::}}`) with independent scheduling.

`cardType` already means a knowledge tag (`fact` / `definition`). `sequenceId` / `position` are a RAG playlist, not cloze identity.

## Decision

1. **Item is disk truth.** `cards/<itemId>.md` is a `FlashcardItem` with `model: 'basic' | 'cloze'`.
2. **Review cards are derived.** `expandItemToReviewCards()` projects `front` / `back`. FSRS keys off `cardId` (`<id>` or `<id>:cN`); files are `review/<id>.json` or `review/<id>--cN.json`.
3. **Cloze ordinal is identity.** Wording edits keep `cN` progress. Removed ordinals leave json on disk and drop out of the queue. Delete is whole-item.
4. **`model` ≠ `cardType`.** `sequenceId` / `position` stay display-only on the item.
5. **Shells do not parse `{{cN::}}`.** Host / `@piwin/flashcards` project before UI.

Old files without `model` decode as `basic`. No rewrite migration.

## Consequences

- Generation tools write items; queue / rate / artifact / export consume review cards.
- v1 models are only `basic` and `cloze`. Marketplace skins and extra models are out of scope.
