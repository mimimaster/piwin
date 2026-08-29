/**
 * Bounded structured completion for in-card flashcard tutor text.
 */
import type { ModelProviderConfig } from '@piwin/contracts';
import {
  completeStructuredText,
  StructuredCompletionError,
  type StructuredCompletionDependencies,
} from './structured-completion.js';
import { clipVisibleText, visibleCharCount } from './flashcard-selection-prompt.js';

export const FLASHCARD_SELECTION_TIMEOUT_MS = 20_000;
export const FLASHCARD_SELECTION_MAX_OUTPUT_TOKENS = 512;
export const FLASHCARD_SELECTION_MAX_OUTPUT_CHARS = 1200;
const TEMPERATURE = 0.2;

export type FlashcardSelectionExplainerRequest = {
  provider: ModelProviderConfig;
  modelId: string;
  systemPrompt: string;
  userPrompt: string;
  signal: AbortSignal;
};

export type FlashcardSelectionExplainerResult = {
  markdown: string;
};

export type FlashcardSelectionExplainerDependencies = StructuredCompletionDependencies;

export type FlashcardSelectionExplainerErrorCode =
  | 'flashcard-selection-cancelled'
  | 'flashcard-selection-provider-failed'
  | 'flashcard-selection-model-unavailable';

export class FlashcardSelectionExplainerError extends Error {
  readonly code: FlashcardSelectionExplainerErrorCode;

  constructor(code: FlashcardSelectionExplainerErrorCode, message: string) {
    super(message);
    this.name = code;
    this.code = code;
  }
}

export async function explainFlashcardSelection(
  request: FlashcardSelectionExplainerRequest,
  dependencies: FlashcardSelectionExplainerDependencies = {},
): Promise<FlashcardSelectionExplainerResult> {
  if (request.signal.aborted) {
    throw new FlashcardSelectionExplainerError(
      'flashcard-selection-cancelled',
      'Flashcard tutor request was cancelled',
    );
  }
  try {
    const result = await completeStructuredText(
      {
        provider: request.provider,
        modelId: request.modelId,
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
        maxOutputTokens: FLASHCARD_SELECTION_MAX_OUTPUT_TOKENS,
        temperature: TEMPERATURE,
        signal: request.signal,
        timeoutMs: FLASHCARD_SELECTION_TIMEOUT_MS,
        label: 'Flashcard tutor',
      },
      dependencies,
    );
    if (request.signal.aborted) {
      throw new FlashcardSelectionExplainerError(
        'flashcard-selection-cancelled',
        'Flashcard tutor request was cancelled',
      );
    }
    return { markdown: sanitizeTutorMarkdown(result.text) };
  } catch (error) {
    throw toExplainerError(error, request.signal);
  }
}

function sanitizeTutorMarkdown(raw: string): string {
  const text = raw.replace(/\0/g, '').trim();
  if (text.length === 0) {
    throw new FlashcardSelectionExplainerError(
      'flashcard-selection-provider-failed',
      'Flashcard tutor returned no text',
    );
  }
  if (visibleCharCount(text) <= FLASHCARD_SELECTION_MAX_OUTPUT_CHARS) {
    return text;
  }
  return clipVisibleText(text, FLASHCARD_SELECTION_MAX_OUTPUT_CHARS);
}

function toExplainerError(
  error: unknown,
  signal: AbortSignal,
): FlashcardSelectionExplainerError {
  if (error instanceof FlashcardSelectionExplainerError) return error;
  if (signal.aborted) {
    return new FlashcardSelectionExplainerError(
      'flashcard-selection-cancelled',
      'Flashcard tutor request was cancelled',
    );
  }
  if (error instanceof StructuredCompletionError) {
    if (error.code === 'cancelled') {
      return new FlashcardSelectionExplainerError(
        'flashcard-selection-cancelled',
        'Flashcard tutor request was cancelled',
      );
    }
    if (error.code === 'missing-credentials') {
      return new FlashcardSelectionExplainerError(
        'flashcard-selection-model-unavailable',
        'Flashcard tutor model is unavailable',
      );
    }
    return new FlashcardSelectionExplainerError(
      'flashcard-selection-provider-failed',
      sanitizeExplainerMessage(error.message),
    );
  }
  return new FlashcardSelectionExplainerError(
    'flashcard-selection-provider-failed',
    'Flashcard tutor request failed',
  );
}

function sanitizeExplainerMessage(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return 'Flashcard tutor request failed';
  // Bound the message and drop anything that looks like a secret bearer token.
  return trimmed.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 240);
}
