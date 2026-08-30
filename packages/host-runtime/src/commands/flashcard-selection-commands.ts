/**
 * Host IPC handlers for in-card flashcard tutor completions.
 *
 * Context is injected from the composition root; this module must not import
 * HostRuntime. CardStore is the face truth — Desktop's face/selection is
 * re-checked against stored item text.
 */
import type {
  FlashcardItem,
  FlashcardSelectionExplainInput,
  FlashcardSelectionExplanation,
  FlashcardTutorFace,
  FlashcardTutorIntent,
  HostCommand,
  HostResponse,
  ModelRef,
  PiwinConfig,
} from '@piwin/contracts';
import { itemToDisplayCard, type CardStore } from '@piwin/flashcards';
import { resolveFlashcardSelectionCompletionModel } from '../completion-model-resolution.js';
import {
  explainFlashcardSelection,
  FlashcardSelectionExplainerError,
  type FlashcardSelectionExplainerDependencies,
} from '../flashcard-selection-explainer.js';
import {
  assembleFlashcardSelectionPrompt,
  FLASHCARD_SELECTION_MAX_CHARS,
  FLASHCARD_SELECTION_MIN_CHARS,
  visibleCharCount,
} from '../flashcard-selection-prompt.js';
import { fail, ok } from '../response-helpers.js';

export const FLASHCARD_SELECTION_ERROR = {
  invalid: 'flashcard-selection-invalid',
  notFound: 'flashcard-not-found',
  modelUnavailable: 'flashcard-selection-model-unavailable',
  providerFailed: 'flashcard-selection-provider-failed',
  cancelled: 'flashcard-selection-cancelled',
} as const;

export type FlashcardSelectionErrorCode =
  (typeof FLASHCARD_SELECTION_ERROR)[keyof typeof FLASHCARD_SELECTION_ERROR];

export type FlashcardSelectionCommandContext = {
  getCardStore: () => Promise<CardStore>;
  loadConfig: () => Promise<PiwinConfig>;
  resolveSessionModel: (sessionId: string) => ModelRef | undefined;
  completion?: FlashcardSelectionExplainerDependencies;
};

type InFlightExplanation = {
  itemId: string;
  abortController: AbortController;
};

export class FlashcardSelectionExplanationRegistry {
  private readonly inflight = new Map<string, InFlightExplanation>();

  get(explanationId: string): InFlightExplanation | undefined {
    return this.inflight.get(explanationId);
  }

  /** Registers a new explanation. Returns undefined when the id is already in flight. */
  register(explanationId: string, itemId: string): AbortController | undefined {
    if (this.inflight.has(explanationId)) return undefined;
    const abortController = new AbortController();
    this.inflight.set(explanationId, { itemId, abortController });
    return abortController;
  }

  abort(explanationId: string): boolean {
    const existing = this.inflight.get(explanationId);
    if (!existing) return false;
    existing.abortController.abort();
    return true;
  }

  complete(explanationId: string): void {
    this.inflight.delete(explanationId);
  }

  abortAll(): void {
    for (const entry of this.inflight.values()) {
      entry.abortController.abort();
    }
    this.inflight.clear();
  }
}

const COMMAND_TYPES = new Set<HostCommand['type']>([
  'flashcards/explain-selection',
  'flashcards/cancel-explanation',
]);

export function isFlashcardSelectionCommand(command: HostCommand): boolean {
  return COMMAND_TYPES.has(command.type);
}

export async function handleFlashcardSelectionCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: FlashcardSelectionCommandContext | undefined,
  registry: FlashcardSelectionExplanationRegistry | undefined,
): Promise<HostResponse | null> {
  if (!isFlashcardSelectionCommand(command)) return null;
  if (!context || !registry) {
    return failCode(
      requestId,
      command.type,
      FLASHCARD_SELECTION_ERROR.invalid,
      'flashcard tutor is not available in this host mode',
    );
  }
  if (command.type === 'flashcards/cancel-explanation') {
    return handleFlashcardCancelExplanation(command, requestId, registry);
  }
  if (command.type === 'flashcards/explain-selection') {
    return handleFlashcardExplainSelection(command, requestId, context, registry);
  }
  return null;
}

export function handleFlashcardCancelExplanation(
  command: Extract<HostCommand, { type: 'flashcards/cancel-explanation' }>,
  requestId: string | undefined,
  registry: FlashcardSelectionExplanationRegistry,
): HostResponse {
  const explanationId = command.explanationId.trim();
  if (!explanationId) {
    return failCode(
      requestId,
      'flashcards/cancel-explanation',
      FLASHCARD_SELECTION_ERROR.invalid,
    );
  }
  const cancelled = registry.abort(explanationId);
  return ok(requestId, 'flashcards/cancel-explanation', { cancelled });
}

export async function handleFlashcardExplainSelection(
  command: Extract<HostCommand, { type: 'flashcards/explain-selection' }>,
  requestId: string | undefined,
  context: FlashcardSelectionCommandContext,
  registry: FlashcardSelectionExplanationRegistry,
): Promise<HostResponse> {
  const input = command.input;
  const parsed = parseExplainInput(input);
  if ('error' in parsed) {
    return failCode(requestId, 'flashcards/explain-selection', parsed.error);
  }

  let item: FlashcardItem;
  try {
    const store = await context.getCardStore();
    item = await store.read(parsed.itemId);
  } catch (error) {
    const code = isMissingCardError(error)
      ? FLASHCARD_SELECTION_ERROR.notFound
      : FLASHCARD_SELECTION_ERROR.providerFailed;
    return failCode(requestId, 'flashcards/explain-selection', code);
  }

  const faces = visibleFaces(item);
  if (!faces) {
    return failCode(
      requestId,
      'flashcards/explain-selection',
      FLASHCARD_SELECTION_ERROR.invalid,
    );
  }
  const faceText = parsed.face === 'front' ? faces.front : faces.back;
  if (!selectionOccursInFace(faceText, parsed.selectedText)) {
    return failCode(
      requestId,
      'flashcards/explain-selection',
      FLASHCARD_SELECTION_ERROR.invalid,
    );
  }

  const config = await context.loadConfig();
  const modelRequest = {
    config,
    resolveSessionModel: context.resolveSessionModel,
    ...(input.model ? { model: input.model } : {}),
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
  };
  const resolved = resolveFlashcardSelectionCompletionModel(modelRequest);
  if ('error' in resolved) {
    return failCode(requestId, 'flashcards/explain-selection', resolved.error);
  }

  const abortController = registry.register(parsed.explanationId, parsed.itemId);
  if (!abortController) {
    return failCode(
      requestId,
      'flashcards/explain-selection',
      FLASHCARD_SELECTION_ERROR.invalid,
    );
  }

  const prompt = assembleFlashcardSelectionPrompt({
    face: parsed.face,
    intent: parsed.intent,
    locale: parsed.locale,
    selectedText: parsed.selectedText,
    front: faces.front,
    back: faces.back,
  });

  try {
    const result = await explainFlashcardSelection(
      {
        provider: resolved.provider,
        modelId: resolved.model.modelId,
        systemPrompt: prompt.systemPrompt,
        userPrompt: prompt.userPrompt,
        signal: abortController.signal,
      },
      context.completion ?? {},
    );
    if (abortController.signal.aborted) {
      return failCode(
        requestId,
        'flashcards/explain-selection',
        FLASHCARD_SELECTION_ERROR.cancelled,
      );
    }
    const payload: FlashcardSelectionExplanation = {
      explanationId: parsed.explanationId,
      itemId: parsed.itemId,
      selectedText: parsed.selectedText,
      intent: parsed.intent,
      markdown: result.markdown,
    };
    return ok(requestId, 'flashcards/explain-selection', payload);
  } catch (error) {
    if (error instanceof FlashcardSelectionExplainerError) {
      return failCode(requestId, 'flashcards/explain-selection', error.code);
    }
    if (abortController.signal.aborted) {
      return failCode(
        requestId,
        'flashcards/explain-selection',
        FLASHCARD_SELECTION_ERROR.cancelled,
      );
    }
    return failCode(
      requestId,
      'flashcards/explain-selection',
      FLASHCARD_SELECTION_ERROR.providerFailed,
    );
  } finally {
    registry.complete(parsed.explanationId);
  }
}

type ParsedExplainInput = {
  explanationId: string;
  itemId: string;
  face: FlashcardTutorFace;
  selectedText: string;
  intent: FlashcardTutorIntent;
  locale: 'en' | 'zh-CN';
};

function parseExplainInput(
  input: FlashcardSelectionExplainInput,
): ParsedExplainInput | { error: FlashcardSelectionErrorCode } {
  const explanationId = input.explanationId.trim();
  const itemId = input.itemId.trim();
  const selectedText = input.selectedText.trim();
  const selectedLength = visibleCharCount(selectedText);
  if (!explanationId || !itemId) {
    return { error: FLASHCARD_SELECTION_ERROR.invalid };
  }
  if (
    selectedLength < FLASHCARD_SELECTION_MIN_CHARS ||
    selectedLength > FLASHCARD_SELECTION_MAX_CHARS
  ) {
    return { error: FLASHCARD_SELECTION_ERROR.invalid };
  }
  if (!isTutorFace(input.face) || !isTutorIntent(input.intent) || !isTutorLocale(input.locale)) {
    return { error: FLASHCARD_SELECTION_ERROR.invalid };
  }
  if (!intentMatchesFace(input.face, input.intent)) {
    return { error: FLASHCARD_SELECTION_ERROR.invalid };
  }
  return {
    explanationId,
    itemId,
    face: input.face,
    selectedText,
    intent: input.intent,
    locale: input.locale,
  };
}

function intentMatchesFace(face: FlashcardTutorFace, intent: FlashcardTutorIntent): boolean {
  if (face === 'front') return intent === 'hint';
  return intent === 'explain' || intent === 'example' || intent === 'simplify';
}

function isTutorFace(value: string): value is FlashcardTutorFace {
  return value === 'front' || value === 'back';
}

function isTutorIntent(value: string): value is FlashcardTutorIntent {
  return value === 'hint' || value === 'explain' || value === 'example' || value === 'simplify';
}

function isTutorLocale(value: string): value is 'en' | 'zh-CN' {
  return value === 'en' || value === 'zh-CN';
}

function visibleFaces(item: FlashcardItem): { front: string; back: string } | undefined {
  const display = itemToDisplayCard(item);
  if (!display) return undefined;
  return { front: display.front, back: display.back };
}

function selectionOccursInFace(faceText: string, selectedText: string): boolean {
  if (faceText.includes(selectedText)) return true;
  const facePlain = visiblePlainText(faceText);
  const selectedPlain = visiblePlainText(selectedText);
  if (facePlain.includes(selectedText)) return true;
  return selectedPlain.length > 0 && facePlain.includes(selectedPlain);
}

/** Strip common emphasis markers so MarkdownView selections can match stored faces. */
function visiblePlainText(text: string): string {
  return text.replace(/\*\*|__|\*/g, '').replace(/\s+/g, ' ').trim();
}

function isMissingCardError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('card not found');
}

function failCode(
  requestId: string | undefined,
  command: string,
  code: FlashcardSelectionErrorCode,
  message?: string,
): HostResponse {
  return fail(requestId, command, message ?? code, { code });
}
