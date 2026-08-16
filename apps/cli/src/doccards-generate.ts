/**
 * Legacy prompt assembly for `--legacy-print-prompt`.
 * Default generate writes CardStore via doccards/generate (P4).
 */
import {
  buildFlashcardGenerationPrompt,
  FLASHCARD_QUALITY_RULES,
  type FolderRag,
} from '@piwin/doc-rag';

export type AssembleDoccardsGeneratePromptInput = {
  rag: FolderRag;
  folderPath: string;
  topic?: string;
  limit?: number;
  fileAllowlist?: string[];
  difficulty?: 'easy' | 'medium' | 'hard';
  count?: 'fewer' | 'standard' | 'more';
};

export async function assembleDoccardsGeneratePrompt(
  input: AssembleDoccardsGeneratePromptInput,
): Promise<string> {
  const fileAllowlist = input.fileAllowlist;
  const topic = input.topic?.trim() ?? '';
  const query = topic || input.folderPath.split(/[\\/]/).pop() || input.folderPath;
  const chunks = await input.rag.retrieve(input.folderPath, query, {
    limit: input.limit ?? 10,
    ...(fileAllowlist?.length ? { fileAllowlist } : {}),
  });
  if (chunks.length === 0) {
    throw new Error('No passages retrieved; index the folder first or try a different topic.');
  }
  return buildFlashcardGenerationPrompt({
    folderPath: input.folderPath,
    chunks,
    ...(topic ? { topic } : {}),
    difficulty: input.difficulty ?? 'medium',
    count: input.count ?? 'standard',
    qualityRules: FLASHCARD_QUALITY_RULES,
  });
}
