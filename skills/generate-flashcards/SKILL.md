---
name: generate-flashcards
description: Generate a flashcard batch from a document folder, notes, or open knowledge using retrieval + flashcard_batch_create.
version: 2
---

# Generate Flashcards

## Goal
One batch of high-quality flashcards the user can study, correctly sourced when material comes from folder/notes.

## Done means
- Source mode chosen: **folder** (`doccards/scan-folder` → `doccards/index-folder` → `doccards/retrieve`), **notes** (`note_search`), or **open** (general/web, no source fields).
- Existing cards checked with `flashcard_list` to reduce duplicates.
- Single `flashcard_batch_create` call with the full array (not per-card create).
- Folder cards carry real `sourceFolder` / `sourceFile` / `sourceLine` / `sourceExcerpt` from retrieval; notes cards carry `sourceNoteId` + `sourceExcerpt`; open cards omit source fields.
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
