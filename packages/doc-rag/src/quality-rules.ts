/**
 * FLASHCARD_QUALITY_RULES — always embedded in the Doc Cards generation
 * prompt (spec §9.4). The bundled skill body should stay in sync with this
 * constant (snapshot test); skill discovery alone is not relied on.
 */
export const FLASHCARD_QUALITY_RULES = `# Flashcard quality rules

## Source types

1. **Folder/docs (RAG-sourced)**: the prompt includes retrieved passages from
   the user's folder, each with a file path and line range. Ground every card
   in these passages. Fill \`sourceFolder\`, \`sourceFile\`, \`sourceLine\`, and
   \`sourceExcerpt\` (the exact passage the card is derived from). Do not use
   knowledge outside the provided passages for sourced cards.

2. **Notes**: the prompt references notes from the library. Fill
   \`sourceNoteId\` and \`sourceExcerpt\`.

3. **Open**: no source passages provided. Do not fill source fields. The card
   stands on general knowledge or web search results.

## Output

Call \`flashcard_batch_create\` once with all cards as an array. Do not call
\`flashcard_create\` individually for batch generation.

## Card quality

- One atomic concept per card.
- Front is a question; it must not leak the answer.
- Back is concise: 1–3 sentences, no essay.
- Difficulty: easy = terms / definitions; medium = concepts / mechanisms;
  hard = application / analysis / trade-offs.
- If the user specified a topic, stay on topic; skip unrelated material even
  if present in the retrieved passages.

## Dedup

Call \`flashcard_list\` before \`flashcard_batch_create\` to check existing
cards and avoid duplicate fronts. The store also rejects near-duplicates by
trigram similarity; duplicates in a batch are skipped (not fatal).`;
