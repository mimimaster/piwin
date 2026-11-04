import type {
  FlashcardCreateInput,
  FlashcardDraftResult,
  FlashcardDraftScope,
  HostCommand,
  HostResponse,
} from '@piwin/contracts';

export async function requestFlashcardDrafts(
  request: (command: HostCommand) => Promise<HostResponse>,
  scope: FlashcardDraftScope,
): Promise<{ ok: true; result: FlashcardDraftResult } | { ok: false; error: string }> {
  const response = await request({ type: 'flashcards/draft-from-scope', scope });
  if (!response.success) {
    return { ok: false, error: response.error };
  }
  const result = response.data as FlashcardDraftResult | undefined;
  if (!result || !Array.isArray(result.drafts)) {
    return { ok: false, error: 'Draft returned no cards' };
  }
  return { ok: true, result };
}

export async function saveFlashcardDrafts(
  request: (command: HostCommand) => Promise<HostResponse>,
  cards: readonly FlashcardCreateInput[],
): Promise<{ ok: true; created: number; skipped: number } | { ok: false; error: string }> {
  if (cards.length === 0) {
    return { ok: false, error: 'Select at least one card to save' };
  }
  const response = await request({
    type: 'flashcards/batch-create',
    input: { cards: [...cards] },
  });
  if (!response.success) {
    return { ok: false, error: response.error };
  }
  const data = response.data as { created?: unknown[]; skipped?: unknown[] } | undefined;
  return {
    ok: true,
    created: data?.created?.length ?? 0,
    skipped: data?.skipped?.length ?? 0,
  };
}

export function draftPreview(card: FlashcardCreateInput): string {
  if (card.model === 'cloze') return (card.text ?? '').trim();
  return (card.front ?? '').trim();
}
