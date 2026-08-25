import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { projectTranscriptMessagesForUi } from './transcript-ui-projection.js';

describe('projectTranscriptMessagesForUi', () => {
  it('strips heavy tool output and presentation.output while keeping head fields', () => {
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        text: 'done',
        createdAt: '2026-07-24T00:00:00.000Z',
        status: 'done',
        thinking: 'plan',
        tools: [
          {
            toolCallId: 't1',
            toolName: 'bash',
            status: 'done',
            output: 'x'.repeat(50_000),
            presentation: {
              kind: 'shell',
              title: 'bash',
              routedToolName: 'image_gen',
              actionVerb: 'Ran command',
              command: 'ls',
              summary: 'ls',
              changedPaths: ['a.ts'],
              output: { text: 'y'.repeat(80_000), truncated: true },
            },
          },
        ],
      },
    ];

    const slim = projectTranscriptMessagesForUi(messages);
    const tool = slim[0]?.tools?.[0];
    expect(tool?.output).toBe('');
    expect(tool?.presentation?.command).toBe('ls');
    expect(tool?.presentation?.routedToolName).toBe('image_gen');
    expect(tool?.presentation?.changedPaths).toEqual(['a.ts']);
    expect(tool?.presentation?.output).toBeUndefined();
    expect(slim[0]?.thinking).toBe('plan');
    expect(slim[0]?.text).toBe('done');

    const fullSize = JSON.stringify(messages).length;
    const slimSize = JSON.stringify(slim).length;
    expect(slimSize).toBeLessThan(fullSize / 10);
  });

  it('keeps Health card fields when slimming UI hydrate', () => {
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        text: 'done',
        createdAt: '2026-08-23T00:00:00.000Z',
        status: 'done',
        tools: [
          {
            toolCallId: 't1',
            toolName: 'health_read_context',
            status: 'done',
            output: 'secret health series',
            presentation: {
              kind: 'health',
              title: 'health_read_context',
              sensitivity: 'health',
              health: {
                metrics: ['steps'],
                periodLabel: '今天',
                status: 'completed',
              },
              output: { text: 'secret health series' },
            },
          },
        ],
      },
    ];
    const tool = projectTranscriptMessagesForUi(messages)[0]?.tools?.[0];
    expect(tool?.output).toBe('');
    expect(tool?.presentation?.output).toBeUndefined();
    expect(tool?.presentation?.sensitivity).toBe('health');
    expect(tool?.presentation?.health).toEqual({
      metrics: ['steps'],
      periodLabel: '今天',
      status: 'completed',
    });
  });

  it('leaves messages without tools unchanged by reference shape', () => {
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'u1',
        role: 'user',
        text: 'hi',
        createdAt: '2026-07-24T00:00:00.000Z',
        status: 'done',
      },
    ];
    const slim = projectTranscriptMessagesForUi(messages);
    expect(slim[0]).toBe(messages[0]);
  });

  it('preserves tool output, presentation.output, and flashcard display for flashcard_create tools', () => {
    const flashcardPayload = JSON.stringify({
      card: { id: 'card-1', front: 'Q', back: 'A' },
      display: {
        cards: [
          {
            cardId: 'card-1',
            itemId: 'card-1',
            model: 'basic',
            ordinal: 1,
            deck: 'default',
            front: 'Q',
            back: 'A',
            createdAt: '2026-08-24T00:00:00.000Z',
          },
        ],
      },
    });
    const messages: SessionTranscriptMessage[] = [
      {
        id: 'a2',
        role: 'assistant',
        text: 'card created',
        createdAt: '2026-07-24T00:00:00.000Z',
        status: 'done',
        tools: [
          {
            toolCallId: 't2',
            toolName: 'piwin_toolbox',
            status: 'done',
            output: flashcardPayload,
            presentation: {
              kind: 'other',
              title: 'flashcard_create',
              routedToolName: 'flashcard_create',
              output: { text: flashcardPayload, truncated: false },
              flashcard: {
                cards: [
                  {
                    cardId: 'card-1',
                    itemId: 'card-1',
                    model: 'basic',
                    ordinal: 1,
                    deck: 'default',
                    front: 'Q',
                    back: 'A',
                    createdAt: '2026-08-24T00:00:00.000Z',
                  },
                ],
              },
            },
          },
        ],
      },
    ];
    const slim = projectTranscriptMessagesForUi(messages);
    const tool = slim[0]?.tools?.[0];
    expect(tool?.output).toBe(flashcardPayload);
    expect(tool?.presentation?.output?.text).toBe(flashcardPayload);
    expect(tool?.presentation?.flashcard?.cards[0]?.front).toBe('Q');
    expect(flashcardPayload).not.toContain('artifactHtml');
  });
});
