import { describe, expect, it, vi } from 'vitest';
import { buildDoccardPointerMessage, openDoccardReviewSession } from './doccards-review-session.js';

describe('doccard review session', () => {
  it('opens a general session with docCardSequence ids only', async () => {
    const appended: Array<Record<string, unknown>> = [];
    const createSession = vi.fn(async () => ({ id: 'sess-1' }));
    const bindSession = vi.fn(async () => undefined);
    const getTranscriptStore = vi.fn(async () => ({
      appendMessage: async (input: Record<string, unknown>) => {
        appended.push(input);
        return { appended: true };
      },
    }));
    const result = await openDoccardReviewSession({
      workspaceName: 'Notes',
      topic: '间隔重复',
      sequenceId: 'seq_gen_1',
      generationId: 'gen_1',
      cardIds: ['card-a', 'card-b'],
      createSession: createSession as never,
      bindSession: bindSession as never,
      getTranscriptStore: getTranscriptStore as never,
    });
    expect(result.sessionId).toBe('sess-1');
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { kind: 'general' },
        sessionName: 'Doc cards: Notes',
        presentation: expect.objectContaining({
          kind: 'doccard-sequence',
          sequenceId: 'seq_gen_1',
          cardIds: ['card-a', 'card-b'],
        }),
      }),
    );
    const pointer = appended[0];
    expect(JSON.stringify(pointer?.metadata)).not.toMatch(/What is|"front"|"back"/);
    expect(pointer).toMatchObject({
      role: 'assistant',
      metadata: {
        docCardSequence: {
          sequenceId: 'seq_gen_1',
          cardIds: ['card-a', 'card-b'],
        },
      },
    });
  });

  it('does not persist card front/back in the pointer text', () => {
    const pointer = buildDoccardPointerMessage({
      workspaceName: 'Notes',
      topic: 'srs',
      sequenceId: 'seq_1',
      generationId: 'gen_1',
      cardIds: ['card-1'],
    });
    expect(pointer.text).toContain('Generated 1 cards from Notes');
    expect(pointer.docCardSequence).toEqual({
      sequenceId: 'seq_1',
      generationId: 'gen_1',
      workspaceName: 'Notes',
      cardIds: ['card-1'],
    });
  });
});
