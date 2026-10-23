import { describe, expect, it } from 'vitest';
import type { ChatMessageUi } from './chat-reducer.js';
import { resolveCompactionAnchorMessageId } from './compaction-anchor.js';

function message(id: string, overrides: Partial<ChatMessageUi> = {}): ChatMessageUi {
  return {
    id,
    role: 'assistant',
    text: '',
    thinking: '',
    tools: [],
    attachments: [],
    status: 'done',
    ...overrides,
  };
}

describe('resolveCompactionAnchorMessageId', () => {
  it('anchors to the last message when it already has content', () => {
    expect(
      resolveCompactionAnchorMessageId([
        message('user-1', { role: 'user', text: 'go' }),
        message('assistant-1', { text: 'working' }),
      ]),
    ).toBe('assistant-1');
  });

  it('skips the empty streaming placeholder the post-compaction reply will fill', () => {
    expect(
      resolveCompactionAnchorMessageId([
        message('user-1', { role: 'user', text: 'go' }),
        message('assistant-1', { text: 'working' }),
        message('assistant-2', { status: 'streaming' }),
      ]),
    ).toBe('assistant-1');
  });

  it('anchors to the user message when the run has produced nothing yet', () => {
    expect(
      resolveCompactionAnchorMessageId([
        message('user-1', { role: 'user', text: 'go' }),
        message('assistant-1', { status: 'streaming' }),
      ]),
    ).toBe('user-1');
  });

  it('returns null for an empty transcript', () => {
    expect(resolveCompactionAnchorMessageId([])).toBeNull();
  });
});
