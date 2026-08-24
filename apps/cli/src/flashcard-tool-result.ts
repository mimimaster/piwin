import {
  formatFlashcardDisplayText,
  parseFlashcardDisplayPayload,
  type ToolPresentation,
} from '@piwin/contracts';

/** CLI degradation: structured Q/A text. Never HTML, never Desktop renderer. */
export function formatCliFlashcardToolResult(
  presentation: ToolPresentation | undefined,
  outputText?: string,
): string | null {
  const payload =
    parseFlashcardDisplayPayload(presentation?.flashcard) ??
    parseFlashcardDisplayPayload(presentation?.output?.text) ??
    parseFlashcardDisplayPayload(outputText);
  if (!payload || payload.cards.length === 0) return null;
  return formatFlashcardDisplayText(payload);
}
