import {
  isFlashcardCreateToolName,
  parseFlashcardDisplayPayload,
  type ToolPresentation,
} from '@piwin/contracts';

/** Attach structured flashcard display from untruncated tool output. */
export function attachFlashcardPresentation(
  presentation: ToolPresentation,
  input: { toolName: string; routedToolName?: string; outputText?: string },
): ToolPresentation {
  if (
    !isFlashcardCreateToolName(input.toolName) &&
    !isFlashcardCreateToolName(input.routedToolName)
  ) {
    return presentation;
  }
  const flashcard = parseFlashcardDisplayPayload(input.outputText);
  if (!flashcard) return presentation;
  return { ...presentation, flashcard };
}
