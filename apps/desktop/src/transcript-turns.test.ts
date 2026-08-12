import { describe, expect, it } from 'vitest';
import type { ChatMessageUi } from './chat-reducer';
import { groupTranscriptTurns, indexTranscriptTurnsByMessageId } from './transcript-turns';

function message(id: string, role: ChatMessageUi['role']): ChatMessageUi {
  return {
    id,
    role,
    text: id,
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
  };
}

describe('transcript turn grouping', () => {
  it('keeps assistant activity with the preceding user prompt', () => {
    const turns = groupTranscriptTurns([
      message('legacy-assistant', 'assistant'),
      message('user-1', 'user'),
      message('assistant-1a', 'assistant'),
      message('assistant-1b', 'assistant'),
      message('user-2', 'user'),
    ]);

    expect(turns.map((turn) => turn.items.map((item) => item.message.id))).toEqual([
      ['legacy-assistant'],
      ['user-1', 'assistant-1a', 'assistant-1b'],
      ['user-2'],
    ]);
    expect(turns[1]?.lastAssistantMessageId).toBe('assistant-1b');
    expect(turns[2]?.lastAssistantMessageId).toBeNull();
    expect(turns[1]?.items.map((item) => item.messageIndex)).toEqual([1, 2, 3]);
  });

  it('indexes every message to its containing turn', () => {
    const turns = groupTranscriptTurns([
      message('user-1', 'user'),
      message('assistant-1', 'assistant'),
      message('user-2', 'user'),
    ]);

    expect([...indexTranscriptTurnsByMessageId(turns)]).toEqual([
      ['user-1', 0],
      ['assistant-1', 0],
      ['user-2', 1],
    ]);
  });

});
