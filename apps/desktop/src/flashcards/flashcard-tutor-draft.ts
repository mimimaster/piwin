import type {
  FlashcardAttribution,
  FlashcardCreateInput,
  FlashcardItem,
  HostCommand,
  HostResponse,
} from '@piwin/contracts';

export type FlashcardDraftSource = Pick<
  FlashcardAttribution,
  'tags' | 'sourceNoteId' | 'sourceFolder' | 'sourceFile' | 'sourceLine' | 'sourceExcerpt'
> & {
  deck: string;
};

export type FlashcardDeckOption = { value: string; label: string };

export type TutorBatchCreateOutcome =
  | { kind: 'created' }
  | { kind: 'duplicate'; existing?: FlashcardItem }
  | { kind: 'validation'; detail?: string }
  | { kind: 'failed'; code: string; message: string };

export function defaultTutorFront(locale: 'zh-CN' | 'en', selectedText: string): string {
  const selection = selectedText.trim();
  return locale === 'en' ? `What is “${selection}”?` : `什么是「${selection}」？`;
}

export function pickDraftAttribution(source: FlashcardDraftSource): FlashcardAttribution {
  const attribution: FlashcardAttribution = {};
  if (source.tags && source.tags.length > 0) attribution.tags = [...source.tags];
  if (source.sourceNoteId) attribution.sourceNoteId = source.sourceNoteId;
  if (source.sourceFolder) attribution.sourceFolder = source.sourceFolder;
  if (source.sourceFile) attribution.sourceFile = source.sourceFile;
  if (typeof source.sourceLine === 'number') attribution.sourceLine = source.sourceLine;
  if (source.sourceExcerpt) attribution.sourceExcerpt = source.sourceExcerpt;
  return attribution;
}

export function buildTutorCreateInput(args: {
  locale: 'zh-CN' | 'en';
  selectedText: string;
  explanationMarkdown: string;
  source: FlashcardDraftSource;
}): FlashcardCreateInput {
  const deck = args.source.deck.trim() !== '' ? args.source.deck.trim() : 'General';
  const input: FlashcardCreateInput = {
    model: 'basic',
    front: defaultTutorFront(args.locale, args.selectedText),
    back: args.explanationMarkdown,
    deck,
  };
  assignAttribution(input, pickDraftAttribution(args.source));
  return input;
}

/** User-edited front/back/deck replace defaults; attribution stays on `base`. */
export function applyDraftEdits(
  base: FlashcardCreateInput,
  edits: { front: string; back: string; deck: string },
): FlashcardCreateInput {
  const next: FlashcardCreateInput = {
    model: 'basic',
    front: edits.front,
    back: edits.back,
    deck: edits.deck.trim() !== '' ? edits.deck.trim() : (base.deck ?? 'General'),
  };
  assignAttribution(next, base);
  return next;
}

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim() === '';
}

export function basicDraftMissingFrontOrBack(input: {
  front?: string;
  back?: string;
}): boolean {
  return isBlank(input.front) || isBlank(input.back);
}

export function toBatchCreateCard(input: FlashcardCreateInput): FlashcardCreateInput {
  const front = input.front?.trim() ?? '';
  const back = input.back?.trim() ?? '';
  const deck = input.deck?.trim() ? input.deck.trim() : 'General';
  const card: FlashcardCreateInput = {
    model: 'basic',
    front,
    back,
    deck,
  };
  assignAttribution(card, input);
  return card;
}

export function outcomeFromBatchCreateData(data: unknown): TutorBatchCreateOutcome {
  if (!data || typeof data !== 'object') {
    return {
      kind: 'failed',
      code: 'flashcard-draft-failed',
      message: 'flashcard-draft-failed',
    };
  }
  const record = data as Record<string, unknown>;
  const created = Array.isArray(record.created) ? record.created : [];
  if (created.length > 0) return { kind: 'created' };

  const skipped = Array.isArray(record.skipped) ? record.skipped : [];
  const first = skipped[0];
  if (first && typeof first === 'object') {
    const skip = first as Record<string, unknown>;
    if (skip.reason === 'duplicate') {
      const existing = asExistingItem(skip.existing);
      return existing ? { kind: 'duplicate', existing } : { kind: 'duplicate' };
    }
    if (skip.reason === 'validation') {
      return typeof skip.detail === 'string' && skip.detail
        ? { kind: 'validation', detail: skip.detail }
        : { kind: 'validation' };
    }
  }
  return {
    kind: 'failed',
    code: 'flashcard-draft-failed',
    message: 'flashcard-draft-failed',
  };
}

export async function loadDeckOptions(
  request: (command: HostCommand) => Promise<HostResponse>,
  currentDeck: string,
): Promise<FlashcardDeckOption[]> {
  const fallback = currentDeck.trim() !== '' ? currentDeck.trim() : 'General';
  try {
    const response = await request({ type: 'flashcards/decks' });
    const names: string[] = [];
    if (response.success && response.data && typeof response.data === 'object') {
      const decks = (response.data as { decks?: unknown }).decks;
      if (Array.isArray(decks)) {
        for (const deck of decks) {
          if (typeof deck === 'string' && deck.trim() !== '' && !names.includes(deck)) {
            names.push(deck);
          }
        }
      }
    }
    if (!names.includes(fallback)) names.unshift(fallback);
    return names.map((deck) => ({ value: deck, label: deck }));
  } catch {
    return [{ value: fallback, label: fallback }];
  }
}

function assignAttribution(target: FlashcardCreateInput, source: FlashcardAttribution): void {
  if (source.tags && source.tags.length > 0) target.tags = [...source.tags];
  if (source.sourceNoteId) target.sourceNoteId = source.sourceNoteId;
  if (source.sourceFolder) target.sourceFolder = source.sourceFolder;
  if (source.sourceFile) target.sourceFile = source.sourceFile;
  if (typeof source.sourceLine === 'number') target.sourceLine = source.sourceLine;
  if (source.sourceExcerpt) target.sourceExcerpt = source.sourceExcerpt;
}

function asExistingItem(value: unknown): FlashcardItem | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.trim() === '') return undefined;
  if (typeof record.deck !== 'string' || record.deck.trim() === '') return undefined;
  const item: FlashcardItem = {
    id: record.id,
    model: record.model === 'cloze' ? 'cloze' : 'basic',
    deck: record.deck,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : '',
  };
  if (typeof record.front === 'string') item.front = record.front;
  if (typeof record.back === 'string') item.back = record.back;
  if (typeof record.text === 'string') item.text = record.text;
  return item;
}
