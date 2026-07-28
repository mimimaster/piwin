---
name: generate-flashcards
description: Generate a batch of flashcards from a document folder, notes, or open knowledge using RAG retrieval and flashcard_batch_create.
---

# Generate Flashcards

Generate flashcards from one of three sources:

1. **Folder/docs** — the user points at a folder; you retrieve passages via the
   `doccards/*` host commands and generate sourced cards.
2. **Notes** — the user asks for cards from their notes library; you use
   `note_search` to retrieve passages and generate sourced cards.
3. **Open** — no source folder; you generate cards from general knowledge or
   web search results.

## Folder mode flow

1. Call `doccards/scan-folder` with `{ folderPath }` to list supported files
   and their extensions. Confirm the file set with the user if it looks large
   or unexpected.
2. Call `doccards/index-folder` with `{ folderPath }` (optionally
   `includeFiles: [...]` to narrow). Wait for the result; it reports
   `indexed`, `chunks`, `degraded` (true when no embedding provider is
   configured — FTS-only retrieval still works).
3. Ask the user for a topic focus (optional), difficulty (easy/medium/hard),
   and count (fewer/standard/more). Defaults: no topic, medium, standard.
4. Build a retrieval query from the topic (or the folder name if no topic).
   Call `doccards/retrieve` with `{ folderPath, query, limit: 10 }`.
5. Call `flashcard_list` with `{ sourceFolder: <canonicalPath> }` to check
   existing cards and avoid duplicate fronts.
6. Call `flashcard_batch_create` ONCE with all cards as an array. Each card
   must carry `sourceFolder`, `sourceFile`, `sourceLine`, and `sourceExcerpt`
   from the passage it is derived from. Output the returned `artifactHtml`
   inside a ```html fence verbatim to render the interactive flip cards.

## Notes mode flow

1. Call `note_search` with the topic as the query.
2. Call `flashcard_list` with `{ sourceNoteId: <noteId> }` for each note you
   plan to draw from.
3. Call `flashcard_batch_create` ONCE. Each card carries `sourceNoteId` and
   `sourceExcerpt`.

## Open mode flow

1. Optionally call `web_search` / `web_fetch` to ground the cards.
2. Call `flashcard_list` for the target deck to avoid duplicates.
3. Call `flashcard_batch_create` ONCE. Do not fill source fields.

## Card quality rules

- One atomic concept per card.
- Front is a question; it must not leak the answer.
- Back is concise: 1–3 sentences, no essay.
- Difficulty: easy = terms / definitions; medium = concepts / mechanisms;
  hard = application / analysis / trade-offs.
- If the user specified a topic, stay on topic; skip unrelated material even
  if present in the retrieved passages.
- Duplicates in a batch are skipped (not fatal); check `flashcard_list` first.

## Source attribution (folder mode)

- `sourceFolder`: the canonical absolute path returned by `doccards/index-folder`.
- `sourceFile`: the relative path as shown in retrieved passages.
- `sourceLine`: the 1-based start line of the passage.
- `sourceExcerpt`: the exact passage the card is derived from (≤ 500 chars).

Never invent source attribution. If a card is not grounded in a retrieved
passage, drop it or move it to open mode (no source fields).
