import { describe, expect, it } from 'vitest';
import type { ChatMessageUi } from './chat-reducer';
import {
  groupTranscriptTurns,
  indexTranscriptTurnsByMessageId,
  registerTranscriptTurnIds,
  reuseUnchangedTranscriptTurns,
  turnUserMessageId,
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

  it('returns the user prompt that opened the turn, not a later user', () => {
    const turns = groupTranscriptTurns([
      message('user-1', 'user'),
      message('assistant-1', 'assistant'),
      message('user-2', 'user'),
      message('assistant-2', 'assistant'),
    ]);
    const firstTurn = turns[0];
    const secondTurn = turns[1];
    if (!firstTurn || !secondTurn) {
      throw new Error('expected two turns');
    }
    expect(turnUserMessageId(firstTurn)).toBe('user-1');
    expect(turnUserMessageId(secondTurn)).toBe('user-2');
  });
});

describe('stable turn ids across history paging', () => {
  const ids = (turns: ReturnType<typeof groupTranscriptTurns>): string[] =>
    turns.map((turn) => turn.id);

  it('keeps a headless tail turn\'s id when an older page prepends its head and prompt', () => {
    const tail = groupTranscriptTurns([message('a50', 'assistant'), message('a51', 'assistant')]);
    const paged = groupTranscriptTurns(
      [
        message('u0', 'user'),
        message('a01', 'assistant'),
        message('a50', 'assistant'),
        message('a51', 'assistant'),
      ],
      registerTranscriptTurnIds(tail),
    );
    expect(ids(paged)).toEqual(ids(tail));
    expect(paged[0]?.items).toHaveLength(4);
  });

  it('keeps the id when the head of a turn is evicted', () => {
    const full = groupTranscriptTurns([
      message('u1', 'user'),
      message('a1', 'assistant'),
      message('a2', 'assistant'),
    ]);
    const trimmed = groupTranscriptTurns(
      [message('a2', 'assistant')],
      registerTranscriptTurnIds(full),
    );
    expect(ids(trimmed)).toEqual(['turn-u1']);
  });

  it('gives a turn opened by a new prompt a fresh id and leaves earlier turns alone', () => {
    const before = groupTranscriptTurns([message('u1', 'user'), message('a1', 'assistant')]);
    const after = groupTranscriptTurns(
      [message('u1', 'user'), message('a1', 'assistant'), message('u2', 'user')],
      registerTranscriptTurnIds(before),
    );
    expect(ids(after)).toEqual(['turn-u1', 'turn-u2']);
  });

  it('never hands one id to two turns when a window split a turn', () => {
    const merged = groupTranscriptTurns([
      message('a1', 'assistant'),
      message('a2', 'assistant'),
    ]);
    const split = groupTranscriptTurns(
      [message('a1', 'assistant'), message('u2', 'user'), message('a2', 'assistant')],
      registerTranscriptTurnIds(merged),
    );
    expect(new Set(ids(split)).size).toBe(split.length);
    expect(split[0]?.id).toBe('turn-a1');
  });

  it('is idempotent: regrouping the same messages against its own registry changes nothing', () => {
    const messages = [message('a1', 'assistant'), message('u1', 'user'), message('a2', 'assistant')];
    const first = groupTranscriptTurns(messages);
    const second = groupTranscriptTurns(messages, registerTranscriptTurnIds(first));
    expect(ids(second)).toEqual(ids(first));
  });

  it('keeps the object of every turn a token did not touch', () => {
    const history = [message('user-1', 'user'), message('assistant-1', 'assistant')];
    const prompt = message('user-2', 'user');
    const reply = message('assistant-2', 'assistant');
    const before = groupTranscriptTurns([...history, prompt, reply]);
    const after = reuseUnchangedTranscriptTurns(
      before,
      groupTranscriptTurns([...history, prompt, { ...reply, text: 'more' }]),
    );

    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[1]?.items[1]?.message.text).toBe('more');
  });

  it('does not reuse a turn whose rows shifted position', () => {
    const turnMessages = [message('user-2', 'user'), message('assistant-2', 'assistant')];
    const before = groupTranscriptTurns(turnMessages);
    const after = reuseUnchangedTranscriptTurns(
      before,
      groupTranscriptTurns([message('user-1', 'user'), ...turnMessages]),
    );

    expect(after[1]?.id).toBe(before[0]?.id);
    expect(after[1]).not.toBe(before[0]);
    expect(after[1]?.items[0]?.messageIndex).toBe(1);
  });
});
