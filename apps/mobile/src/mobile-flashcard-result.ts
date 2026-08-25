import {
  formatFlashcardDisplayText,
  parseFlashcardDisplayPayload,
  type FlashcardDisplayPayload,
} from '@piwin/contracts';
import type { MobileToolCall } from './mobile-transcript.js';

export function resolveMobileFlashcardDisplay(
  tool: Pick<MobileToolCall, 'output' | 'presentation'>,
): FlashcardDisplayPayload | null {
  return (
    parseFlashcardDisplayPayload(tool.presentation?.flashcard) ??
    parseFlashcardDisplayPayload(tool.output)
  );
}

/** Mobile degradation: structured Q/A text. Not Desktop FlashcardView. */
export function formatMobileFlashcardResult(payload: FlashcardDisplayPayload): string {
  return formatFlashcardDisplayText(payload);
}
