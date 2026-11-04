import { describe, expect, it, vi } from 'vitest';
import type { HostCommand, HostResponse } from '@piwin/contracts';
import { requestFlashcardDrafts, saveFlashcardDrafts } from './knowledge-card-draft.js';

describe('knowledge-card-draft', () => {
  it('does not write while requesting drafts', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'flashcards/draft-from-scope') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: {
            drafts: [{ front: 'Q', back: 'A', wikiSlug: 'fsrs' }],
            counts: { basic: 1, cloze: 0 },
          },
        };
      }
      return { type: 'response', command: command.type, success: false, error: 'no' };
    });
    const result = await requestFlashcardDrafts(request, {
      kind: 'selection',
      text: 'Spaced repetition',
      wikiSlug: 'fsrs',
    });
    expect(result.ok).toBe(true);
    expect(request.mock.calls.map((call) => call[0].type)).toEqual(['flashcards/draft-from-scope']);
  });

  it('saves only the chosen drafts', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      if (command.type === 'flashcards/batch-create') {
        return {
          type: 'response',
          command: command.type,
          success: true,
          data: { created: [{ id: '1' }], skipped: [] },
        };
      }
      return { type: 'response', command: command.type, success: false, error: 'no' };
    });
    const saved = await saveFlashcardDrafts(request, [{ front: 'Q', back: 'A' }]);
    expect(saved).toEqual({ ok: true, created: 1, skipped: 0 });
  });
});
