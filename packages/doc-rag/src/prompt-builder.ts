/**
 * Pure prompt builder for Doc Cards generation (spec §9.1 step 5).
 *
 * The host does NOT intercept hidden generation metadata on session/prompt.
 * The app (desktop/CLI) calls this pure function with retrieved chunks +
 * params + quality rules, then sends the resulting text via session/prompt.
 */
import type { RetrievedChunk } from '@piwin/contracts';

export type BuildFlashcardGenerationPromptInput = {
  folderPath: string;
  chunks: RetrievedChunk[];
  topic?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  count?: 'fewer' | 'standard' | 'more';
  /** Always supplied by caller — the FLASHCARD_QUALITY_RULES constant. */
  qualityRules: string;
};

const COUNT_GUIDANCE: Record<NonNullable<BuildFlashcardGenerationPromptInput['count']>, string> = {
  fewer: 'Generate a focused set (around 5 cards).',
  standard: 'Generate a standard set (around 10 cards).',
  more: 'Generate a larger set (up to 20 cards).',
};

const DIFFICULTY_GUIDANCE: Record<NonNullable<BuildFlashcardGenerationPromptInput['difficulty']>, string> = {
  easy: 'Target difficulty: easy (terms / definitions).',
  medium: 'Target difficulty: medium (concepts / mechanisms).',
  hard: 'Target difficulty: hard (application / analysis / trade-offs).',
};

export function buildFlashcardGenerationPrompt(input: BuildFlashcardGenerationPromptInput): string {
  const { folderPath, chunks, topic, difficulty, count, qualityRules } = input;
  const lines: string[] = [];

  lines.push(`Generate flashcards from the following retrieved passages.`);
  lines.push('');
  lines.push(`Source folder: ${folderPath}`);
  if (topic) {
    lines.push(`Topic focus: ${topic}`);
  }
  if (difficulty) {
    lines.push(DIFFICULTY_GUIDANCE[difficulty]);
  }
  if (count) {
    lines.push(COUNT_GUIDANCE[count]);
  }
  lines.push('');
  lines.push('<retrieved_passages>');
  for (const [index, chunk] of chunks.entries()) {
    lines.push(`  <passage index="${index + 1}" location="${chunk.filePath}:${chunk.startLine}-${chunk.endLine}">`);
    lines.push(chunk.content);
    lines.push(`  </passage>`);
  }
  lines.push('</retrieved_passages>');
  lines.push('');
  lines.push(qualityRules);
  lines.push('');
  lines.push('Fill `sourceFolder`, `sourceFile`, `sourceLine`, and `sourceExcerpt`');
  lines.push('for every card, using the passage the card is derived from.');
  lines.push('`sourceFile` is the relative path as shown above; `sourceLine` is');
  lines.push('the 1-based start line of the passage.');
  return lines.join('\n');
}
