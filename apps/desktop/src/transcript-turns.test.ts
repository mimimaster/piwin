import { describe, expect, it } from 'vitest';
import type { ChatMessageUi } from './chat-reducer';
import {
  groupTranscriptTurns,
  indexTranscriptTurnsByMessageId,
  projectTranscriptTurnWorkDetails,
} from './transcript-turns';

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

  it('projects one work-details message for Assistant lifecycles sharing a run', () => {
    const firstAssistant = {
      ...message('assistant-1a', 'assistant'),
      runId: 'run-1',
      thinking: 'inspect',
      tools: [{ toolCallId: 'tool-1', toolName: 'bash', status: 'done' as const, output: 'ok' }],
    };
    const secondAssistant = {
      ...message('assistant-1b', 'assistant'),
      runId: 'run-1',
      thinking: 'edit',
      status: 'streaming' as const,
      tools: [
        { toolCallId: 'tool-2', toolName: 'write_file', status: 'running' as const, output: '' },
      ],
    };
    const turn = groupTranscriptTurns([
      message('user-1', 'user'),
      firstAssistant,
      secondAssistant,
    ])[0];
    if (!turn) throw new Error('expected one transcript turn');

    const workDetails = projectTranscriptTurnWorkDetails(turn);

    expect(workDetails).toHaveLength(1);
    expect(workDetails[0]?.ownerMessageId).toBe('assistant-1a');
    expect(workDetails[0]?.message).toMatchObject({
      runId: 'run-1',
      thinking: 'inspect\n\nedit',
      status: 'streaming',
    });
    expect(workDetails[0]?.message.tools.map((tool) => tool.toolCallId)).toEqual([
      'tool-1',
      'tool-2',
    ]);
  });

  it('keeps legacy Assistant messages without run identity independent', () => {
    const turn = groupTranscriptTurns([
      message('user-1', 'user'),
      message('assistant-1a', 'assistant'),
      message('assistant-1b', 'assistant'),
    ])[0];
    if (!turn) throw new Error('expected one transcript turn');

    expect(projectTranscriptTurnWorkDetails(turn).map((item) => item.ownerMessageId)).toEqual([
      'assistant-1a',
      'assistant-1b',
    ]);
  });
});
