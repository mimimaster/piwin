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
});
