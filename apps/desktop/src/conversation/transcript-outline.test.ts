import { describe, expect, it } from 'vitest';
import {
  buildOutlineFromChatMessages,
  buildOutlineFromTranscriptMessages,
  messageAnchorId,
  resolveSessionOutline,
} from './transcript-outline';

describe('transcript-outline', () => {
  it('builds anchors', () => {
    expect(messageAnchorId('abc')).toBe('msg-abc');
  });

  it('builds outline from transcript messages', () => {
    const outline = buildOutlineFromTranscriptMessages([
      {
        id: 'u1',
        role: 'user',
        text: 'hello world',
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'done',
      },
    ]);
    expect(outline).toEqual([
      {
        id: 'u1',
        role: 'user',
        preview: 'hello world',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  it('strips mode wrappers from user transcript previews', () => {
    const outline = buildOutlineFromTranscriptMessages([
      {
        id: 'u1',
        role: 'user',
        text: '[piwin-mode:agent]\nOperating contract\n\n---\nUser:\nhello world',
        createdAt: '2026-01-01T00:00:00.000Z',
        status: 'done',
      },
    ]);
    expect(outline[0]?.preview).toBe('hello world');
  });

  it('prefers provided outline over derivation', () => {
    const resolved = resolveSessionOutline({
      outline: [
        {
          id: 'a',
          role: 'user',
          preview: 'from host',
          createdAt: 't',
        },
      ],
      transcriptMessages: [
        {
          id: 'b',
          role: 'assistant',
          text: 'ignored',
          createdAt: 't2',
          status: 'done',
        },
      ],
    });
    expect(resolved[0]?.preview).toBe('from host');
  });

  it('derives from chat messages when outline missing', () => {
    const outline = buildOutlineFromChatMessages([
      {
        id: 'm1',
        role: 'assistant',
        text: '',
        thinking: '',
        tools: [{ toolCallId: 't1', toolName: 'bash', status: 'done', output: 'ok' }],
        attachments: [],
        status: 'done',
      },
    ]);
    expect(outline[0]?.preview).toContain('1 tool');
  });
});
