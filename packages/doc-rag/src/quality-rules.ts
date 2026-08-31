/**
 * FLASHCARD_QUALITY_RULES — always embedded in the Doc Cards generation
 * prompt (spec §9.4). Keep aligned with skills/generate-flashcards.
 */
export const FLASHCARD_QUALITY_RULES = `<flashcard_generation_policy version="2">
# Flashcard Quality & Generation Rules

## Models & Formats
- basic: front is a question covering one atomic concept (does not reveal the answer); back is 1-3 concise sentences.
- cloze: Source passage hiding a key term, name, or formula inside {{c1::answer}} markers. Put related blanks on the same item as {{c1::answer}} / {{c2::answer}}.

## Source Modes & Grounding
- Folder/docs: Ground every card strictly in the provided passages; fill sourceFolder, sourceFile, sourceLine, sourceExcerpt. No external assumptions.
- Notes: Fill sourceNoteId + sourceExcerpt.
- Open: Omit source fields.

## Batch Invocation
- Call flashcard_batch_create with the full array of cards in a single tool call (do not create cards one by one).
- Call flashcard_list first when applicable to reduce duplicates.
- Never output markdown/HTML card fences; cards are rendered natively by the client.
</flashcard_generation_policy>`;
