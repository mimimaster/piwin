---
name: generate-flashcards
description: "Create study flashcards from notes or open knowledge via flashcard_batch_create; folders and documents go through Doc Cards generate instead. Use when the user asks to make flashcards, 记忆卡片 / 抽认卡, Anki-style or cloze cards, or wants material turned into something to memorize."
version: 4
---

# Generate Flashcards

## Goal
One batch of high-quality flashcards the user can study, correctly sourced when material comes from notes. Folder/docs use the Doc Cards pipeline.

## Done means
- Source mode chosen:
  - **folder**: tell the user to Index then Generate (`doccards/generate`). Do **not** call `flashcard_batch_create` for a folder.
  - **notes**: `note_search` → `flashcard_list` → `flashcard_batch_create` with `sourceNoteId` + `sourceExcerpt`.
  - **open**: `flashcard_list` → `flashcard_batch_create` without source fields.
- Existing cards checked with `flashcard_list` to reduce duplicates.
- Chat/open/notes: single `flashcard_batch_create` with the full array (not per-card create).
- Folder cards in the store already have `sourceFolder` / `sourceFile` / `sourceLine` / `sourceExcerpt` from `doccards/generate`; notes cards carry `sourceNoteId` + `sourceExcerpt`; open cards omit source fields.
- Structured `display` cards from the tool result are shown by the product UI. Do not emit HTML fences for the cards.
- Quality: one atomic concept. Use `model: "basic"` for questions (front does not leak the answer; back 1–3 sentences). Use `model: "cloze"` to hide a term/name/formula inside a source sentence with `{{c1::answer}}`; related blanks stay on the same item. Do not renumber cloze ordinals. Difficulty matches ask (easy/medium/hard); stay on topic.

## Stop when
- Folder set looks wrong/huge — confirm before indexing.
- Card cannot be grounded in a retrieved passage — drop it or use open mode without invented attribution.
- Tools/index unavailable — say what failed.

## Constraints
- Never invent source attribution.
- Host may skip near-duplicate fronts; that is non-fatal.

## Verify
- Spot-check that sourced cards match passage text; batch create result reflects created vs skipped.
