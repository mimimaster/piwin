---
name: generate-flashcards
description: Generate flashcards from notes or open knowledge via flashcard_batch_create. Folder/docs go through Doc Cards generate, not this tool path.
version: 3
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
- Returned `artifactHtml` rendered verbatim in an `html` fence when present.
- Quality: one atomic concept; front is a question that does not leak the answer; back 1–3 sentences; difficulty matches ask (easy/medium/hard); stay on topic.

## Stop when
- Folder set looks wrong/huge — confirm before indexing.
- Card cannot be grounded in a retrieved passage — drop it or use open mode without invented attribution.
- Tools/index unavailable — say what failed.

## Constraints
- Never invent source attribution.
- Host may skip near-duplicate fronts; that is non-fatal.

## Verify
- Spot-check that sourced cards match passage text; batch create result reflects created vs skipped.
