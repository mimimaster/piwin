/**
 * FLASHCARD_QUALITY_RULES — always embedded in the Doc Cards generation
 * prompt (spec §9.4). Keep aligned with skills/generate-flashcards.
 */
export const FLASHCARD_QUALITY_RULES = `[piwin-prompt-meta kind="flashcard:quality" version="3" applies="flashcard-batch"]

# Flashcard quality

## Success
A batch of study-ready items. Pick a model per item:
- **basic**: question/comparison/explanation. \`front\` is a question that does not leak the answer; \`back\` is 1–3 concise sentences.
- **cloze**: hide a term, name, or formula inside a source sentence. Put related blanks on the **same** item as \`{{c1::answer}}\` / \`{{c2::answer}}\`. Do not renumber ordinals if regenerating the same fact.

One atomic concept per item; difficulty matches the ask.

## Source modes
- **Folder/docs**: ground every card in provided passages; fill sourceFolder, sourceFile, sourceLine, sourceExcerpt. No outside knowledge for sourced cards.
- **Notes**: fill sourceNoteId + sourceExcerpt.
- **Open**: no source fields.

## Output
One flashcard_batch_create with the full array (not per-card create). Each element sets \`model\` to "basic" or "cloze".

## Stop
Skip off-topic material. Never invent source attribution. Prefer flashcard_list first to reduce duplicates (store may also skip near-duplicates).
`;
