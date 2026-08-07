/**
 * FLASHCARD_QUALITY_RULES — always embedded in the Doc Cards generation
 * prompt (spec §9.4). Keep aligned with skills/generate-flashcards.
 */
export const FLASHCARD_QUALITY_RULES = `# Flashcard quality

## Success
A batch of study-ready cards: one atomic concept each; front is a question that does not leak the answer; back is 1–3 concise sentences; difficulty matches the ask.

## Source modes
- **Folder/docs**: ground every card in provided passages; fill sourceFolder, sourceFile, sourceLine, sourceExcerpt. No outside knowledge for sourced cards.
- **Notes**: fill sourceNoteId + sourceExcerpt.
- **Open**: no source fields.

## Output
One flashcard_batch_create with the full array (not per-card create).

## Stop
Skip off-topic material. Never invent source attribution. Prefer flashcard_list first to reduce duplicate fronts (store may also skip near-duplicates).
`;
