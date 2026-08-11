import { describe, expect, it } from 'vitest';
import type { SessionTranscriptMessage } from '@piwin/contracts';
import { createSessionMessageResponse } from './session-message-response.js';

function messages(count: number): SessionTranscriptMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `m-${index}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `message ${index}`,
    createdAt: new Date(index * 1_000).toISOString(),
    status: 'done',
  }));
}

describe('session mutation response projection', () => {
  it('preserves legacy full responses, supports none, and bounds tail', () => {
    const transcript = messages(100);
    expect(createSessionMessageResponse('session-1', transcript, undefined).messages).toHaveLength(
      100,
    );
    expect(createSessionMessageResponse('session-1', transcript, 'none')).toEqual({});
    const tail = createSessionMessageResponse('session-1', transcript, 'tail');
    expect(tail.messages).toHaveLength(50);
    expect(tail.messages?.[0]?.id).toBe('m-50');
    expect(tail.transcriptPage?.totalCount).toBe(100);
    expect(tail.transcriptPage?.olderCursor).toBeDefined();
  });
});
