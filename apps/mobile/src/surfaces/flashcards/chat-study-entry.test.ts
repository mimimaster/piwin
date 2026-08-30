// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { FlashcardDisplayPayload, HostCommand, HostResponse } from '@piwin/contracts';
import {
  enterStudyFromChatDisplay,
  flashcardStudyScopeFromDisplay,
} from './chat-study-entry.js';
import { loadMobileStudyReturnContext } from './study-return-context.js';

const CARD: FlashcardDisplayPayload = {
  cards: [
    {
      cardId: 'card-1',
      itemId: 'item-os',
      model: 'basic',
      ordinal: 1,
      deck: 'OS',
      front: 'Q',
      back: 'A',
      createdAt: '2026-08-30T00:00:00.000Z',
      sequenceId: 'seq_os',
    },
  ],
};

describe('chat study entry', () => {
  it('prefers sequenceId then itemId', () => {
    expect(flashcardStudyScopeFromDisplay(CARD)).toEqual({
      kind: 'sequence',
      sequenceId: 'seq_os',
    });
    const first = CARD.cards[0];
    expect(first).toBeDefined();
    if (!first) return;
    const { sequenceId: _sequenceId, ...withoutSequence } = first;
    expect(
      flashcardStudyScopeFromDisplay({
        cards: [{ ...withoutSequence, itemId: 'item-os' }],
      }),
    ).toEqual({ kind: 'item', itemId: 'item-os' });
  });

  it('starts a Host round before navigating, and records chat as the return source', async () => {
    const request = vi.fn(async (command: HostCommand): Promise<HostResponse> => {
      expect(command.type).toBe('flashcards/study/start');
      return {
        type: 'response',
        command: command.type,
        success: true,
        data: {
          round: {
            roundId: 'round-chat',
            schemaVersion: 1,
            mode: 'sequence',
            scope: { kind: 'sequence', sequenceId: 'seq_os' },
            status: 'active',
            revision: 0,
            controlEpoch: 1,
            controllerIdentity: 'mobile',
            createdAt: '2026-08-30T00:00:00.000Z',
            updatedAt: '2026-08-30T00:00:00.000Z',
            currentEntryId: 'entry-1',
            face: 'question',
            lastAdvanceOperationId: null,
          },
          counts: { total: 1, processed: 0, invalidated: 0, remaining: 1 },
          canUndo: false,
          access: { hasControl: true, controllerIdentity: 'mobile', controlEpoch: 1 },
        },
      };
    });
    const result = await enterStudyFromChatDisplay({
      request,
      payload: CARD,
      hasStudyCapability: () => true,
    });
    expect(result).toEqual({ ok: true, roundId: 'round-chat' });
    expect(window.location.hash).toBe('#flashcards/study/round-chat');
    expect(loadMobileStudyReturnContext()?.source).toBe('chat');
  });

  it('refuses to open when Host lacks study capability', async () => {
    const result = await enterStudyFromChatDisplay({
      request: vi.fn(),
      payload: CARD,
      hasStudyCapability: () => false,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('host-too-old');
  });
});
