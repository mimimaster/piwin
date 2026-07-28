/**
 * Browser-safe re-exports of the flashcard generation prompt builder and
 * quality rules. Desktop uses this subpath to avoid pulling in Node-only
 * modules (sqlite, fs, etc.) from the rest of `@piwin/doc-rag`.
 */
export { buildFlashcardGenerationPrompt } from './prompt-builder.js';
export type { BuildFlashcardGenerationPromptInput } from './prompt-builder.js';
export { FLASHCARD_QUALITY_RULES } from './quality-rules.js';
