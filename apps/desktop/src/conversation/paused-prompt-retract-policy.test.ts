import { describe, expect, it } from 'vitest';
import type { ChatMessageUi } from './chat-ui-types';
import {
  findPausedPromptRetractCandidate,
  hasOutputAfterPrompt,
  mergeRetractedDraft,
} from './paused-prompt-retract-policy';

function row(id: string, role: ChatMessageUi['role'], extra: Partial<ChatMessageUi> = {}): ChatMessageUi {
  return { id, role, text: '', thinking: '', tools: [], attachments: [], status: 'done', ...extra };
}

const history = [row('u1', 'user', { text: 'old' }), row('a1', 'assistant', { text: 'old reply' })];

describe('findPausedPromptRetractCandidate', () => {
  it('names the live prompt while its reply is still empty', () => {
    const messages = [...history, row('u2', 'user', { text: 'new' }), row('a2', 'assistant', { status: 'streaming' })];
    expect(findPausedPromptRetractCandidate('s1', messages)).toEqual({
      sessionId: 's1',
      userMessageId: 'u2',
    });
  });

  it.each([
    ['text', { text: 'Sure' }],
    ['thinking', { thinking: 'Let me' }],
    ['a tool', { tools: [{ toolCallId: 't', toolName: 'read', status: 'running' as const, output: '' }] }],
  ])('keeps a normal pause once the reply shows %s', (_label, extra) => {
    const messages = [...history, row('u2', 'user'), row('a2', 'assistant', extra)];
    expect(findPausedPromptRetractCandidate('s1', messages)).toBeNull();
  });

  it('never retracts a steer or without a session', () => {
    const steer = row('u2', 'user', {
      instructionDelivery: {
        kind: 'run-intervention',
        instructionId: 'i1',
        status: 'pending',
        targetRunId: 'r1',
        revision: 1,
      },
    });
    expect(findPausedPromptRetractCandidate('s1', [...history, steer])).toBeNull();
    expect(findPausedPromptRetractCandidate(null, [...history, row('u2', 'user')])).toBeNull();
  });
});

describe('hasOutputAfterPrompt', () => {
  it('sees output that arrived after the Pause click', () => {
    expect(hasOutputAfterPrompt([...history, row('u2', 'user')], 'u2')).toBe(false);
    expect(
      hasOutputAfterPrompt([...history, row('u2', 'user'), row('a2', 'assistant', { text: 'x' })], 'u2'),
    ).toBe(true);
  });
});

describe('mergeRetractedDraft', () => {
  const quoted = { kind: 'selection' as const, snapshotText: 'q', label: 'q' };

  it('restores into an empty composer', () => {
    expect(mergeRetractedDraft({ text: 'half question', contextRefs: [quoted] }, { text: '', contextRefs: [] })).toEqual({
      text: 'half question',
      contextRefs: [quoted],
    });
  });

  it('keeps what the user typed meanwhile after the prompt, without duplicating refs', () => {
    expect(
      mergeRetractedDraft({ text: 'half question', contextRefs: [quoted] }, { text: 'and more', contextRefs: [quoted] }),
    ).toEqual({ text: 'half question\n\nand more', contextRefs: [quoted] });
  });
});
